import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import type { Principal } from "../auth/verify";
import { identityFrom, verifyMemberCode } from "../auth/builtin";
import { HandoffError } from "../domain/errors";
import { base64url } from "../domain/ids";
import { handleOf, tenantOf } from "../domain/tenant";
import { recordEvent } from "../store/events";
import { bytes, esc, interactiveHeaders, problemPage, type Html } from "../console/html";
import {
  ACCOUNT_SESSIONS,
  cookieToken,
  csrfOk,
  endSessions,
  isAdmin,
  loginAllowed,
  redirectSetting,
  sameOrigin,
  sessionFrom,
  startSessions,
  type Session,
} from "../console/session";
import { attachmentResponse } from "./routes";
import { accountLoginPage, accountPage, type Flash } from "./account-page";

type Body = Record<string, string | File | (string | File)[]>;
type AccountVariables = Variables & { session: Session; body: Body };
type C = { env: Env; get: <K extends keyof AccountVariables>(k: K) => AccountVariables[K]; req: { header: (n: string) => string | undefined } };

/** Handoffs per page; "Show older handoffs" continues from the last one. */
const PAGE_SIZE = 20;
const BACK = { site: "Handoff", href: "/account", label: "Back to My account" };
const redirect = (to: string, status = 303): Response => new Response(null, { status, headers: { location: to, "cache-control": "no-store" } });
const str = (body: Body, key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");
const newNonce = (): string => base64url(crypto.getRandomValues(new Uint8Array(16)));
/** Every page here carries the small page script, so every response gets a nonce. */
const respond = (render: (nonce: string) => Html, status = 200): Response => {
  const nonce = newNonce();
  return new Response(render(nonce), { status, headers: interactiveHeaders(nonce) });
};
const problem = (title: string, text: string, status: number): Response => respond(() => problemPage(title, text, BACK), status);

/** The page acts as the signed-in member, like their assistants do: same identity, same access rules. */
const principalOf = (s: Session): Principal => ({ subject: s.handle, scopes: [], clientId: "files", token: "" });

/**
 * My account at /account. Any member signs in with their username and access code; an admin's sign-in also opens
 * the console. They see their unsent files and live handoffs in one list, upload a file for their assistant to
 * send, remove an unsent file, and download the files of their handoffs. Every change is a form POST from this
 * origin carrying the session's CSRF value.
 */
export function accountRoutes(): Hono<{ Bindings: Env; Variables: AccountVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AccountVariables }>();

  const page = async (c: C, s: Session, opts: { flash?: Flash | ((unsentIds: Map<string, string>) => Flash); status?: number; uploadOpen?: boolean; cursor?: string }): Promise<Response> => {
    const svc = c.get("service");
    const p = principalOf(s);
    const [unsent, handoffs, admin] = await Promise.all([
      opts.cursor ? Promise.resolve([]) : svc.unsentFiles(p, 100),
      svc.handoffsPage(p, { limit: PAGE_SIZE, cursor: opts.cursor }),
      isAdmin(c.env.DB, s.handle),
    ]);
    const flash = typeof opts.flash === "function" ? opts.flash(new Map(unsent.map((f) => [f.attachment_id, f.filename]))) : (opts.flash ?? null);
    return respond(
      (nonce) =>
        accountPage(
          { handle: handleOf(s.handle), tenant: tenantOf(s.handle), csrf: s.csrf, admin },
          {
            unsent,
            handoffs: handoffs.handoffs,
            nextCursor: handoffs.next_cursor,
            older: !!opts.cursor,
            uploadOpen: !!opts.uploadOpen,
            maxBytes: svc.cfg.maxAttachmentBytes,
            unsentTtlMs: svc.cfg.unattachedReadyTtlMs,
            flash,
            now: Date.now(),
          },
          nonce,
        ),
      opts.status,
    );
  };
  const loginPage = (c: C, error?: string, team?: string, status = 200) =>
    respond((nonce) => accountLoginPage({ control: c.get("cfg").mode === "control", error, team }, nonce), status);
  const sessionOf = (c: C) => sessionFrom(c.env.DB, cookieToken(c.req.header("cookie"), ACCOUNT_SESSIONS), ACCOUNT_SESSIONS);

  // The files page moved here. Old links and open tabs follow; 307 keeps a form's method and body, and the new
  // routes check its origin and CSRF value as usual.
  app.all("/files", (c) => redirect(`/account${new URL(c.req.url).search}`, 307));
  app.all("/files/*", (c) => redirect(`${c.req.path.replace(/^\/files/, "/account")}${new URL(c.req.url).search}`, 307));

  // Forms are small, except the upload: one file of the largest size this server takes, and the form around it.
  app.use("/account/*", async (c, next) => {
    const upload = c.req.path === "/account/upload";
    const max = upload ? c.get("cfg").maxAttachmentBytes + 64 * 1024 : 4096;
    const tooLarge = `That is larger than this server accepts${upload ? `: files up to ${bytes(c.get("cfg").maxAttachmentBytes)}` : ""}.`;
    return bodyLimit({ maxSize: max, onError: () => problem("Too large", tooLarge, 413) })(c, next);
  });

  app.get("/account", async (c) => {
    const s = await sessionOf(c);
    if (!s) return loginPage(c);
    const q = (k: string) => c.req.query(k);
    const older = q("older");
    try {
      return await page(c, s, {
        cursor: older || undefined,
        uploadOpen: q("upload") === "1",
        flash: (unsent) => {
          const name = unsent.get(q("uploaded") ?? "");
          if (name) {
            const what = q("renamed") === "1" ? `Uploaded as <strong>${esc(name)}</strong>, because you already had a file with that name.` : `Uploaded <strong>${esc(name)}</strong>.`;
            return { ok: true, text: `${what} Tell your assistant: <q>Hand this off with ${esc(name)}.</q>` };
          }
          return q("removed") === "1" ? { ok: true, text: "File removed." } : null;
        },
      });
    } catch (e) {
      // A cursor that is not ours: start from the newest.
      if (e instanceof HandoffError && older) return redirect("/account");
      throw e;
    }
  });

  app.post("/account/login", async (c) => {
    const db = c.env.DB;
    const cfg = c.get("cfg");
    if (!sameOrigin(c.req.header("origin"), cfg.publicUrl)) {
      return problem("Sign-in refused", "The sign-in form must be sent from this server's own page.", 403);
    }
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip"), "account-login"))) {
      const res = loginPage(c, "Too many attempts. Try again in 10 minutes.", undefined, 429);
      res.headers.set("retry-after", "600");
      return res;
    }
    const form = (await c.req.parseBody()) as Body;
    const identity = identityFrom(cfg, str(form, "team"), str(form, "handle"));
    const code = str(form, "access_code");
    const valid = identity !== null && code.length > 0 && code.length <= 256 && (await verifyMemberCode(db, identity, code)) === identity;
    // One sign-in: every member gets My account, and an admin the console as well.
    const cookies = valid && identity ? await startSessions(db, identity) : [];
    if (cookies.length === 0) {
      await recordEvent(db, { kind: "files", name: "login", subject: identity, outcome: "refused" }, { unauthenticated: true });
      const msg = cfg.mode === "control" ? "That team, username and access code do not match." : "That username and access code do not match.";
      return loginPage(c, msg, str(form, "team"), 401);
    }
    await recordEvent(db, { kind: "files", name: "login", subject: identity, outcome: "ok" });
    return redirectSetting("/account", cookies);
  });

  // Everything below needs a session; a POST also needs this origin and the session's CSRF value.
  app.use("/account/*", async (c, next) => {
    const s = await sessionOf(c);
    if (!s) return c.req.method === "GET" ? redirect("/account") : loginPage(c, "Your session ended. Sign in again.", undefined, 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
        return problem("Refused", "Changes must be sent from this server's own pages.", 403);
      }
      const body = (await c.req.parseBody()) as Body;
      if (!csrfOk(s, body.csrf)) return problem("This form has expired", "Go back, reload the page, and try again.", 403);
      c.set("body", body);
    }
    c.set("session", s);
    await next();
  });

  // Signing out here also signs an admin out of the console: one sign-in, one sign-out.
  app.post("/account/logout", async (c) => redirectSetting("/account", await endSessions(c.env.DB, c.req.header("cookie"))));

  app.post("/account/upload", async (c) => {
    const s = c.get("session");
    const body = c.get("body");
    const svc = c.get("service");
    const file = body.file;
    const failed = (text: string, status: number) => page(c, s, { flash: { ok: false, text }, status, uploadOpen: true });
    if (!(file instanceof File) || !file.name) return failed("Choose a file to upload.", 400);
    if (file.size === 0) return failed("That file is empty.", 400);
    if (file.size > svc.cfg.maxAttachmentBytes) return failed(`That file is larger than ${esc(bytes(svc.cfg.maxAttachmentBytes))}.`, 413);
    try {
      const { attachment, renamed } = await svc.webUpload(principalOf(s), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, str(body, "note"));
      await recordEvent(c.env.DB, { kind: "files", name: "upload", subject: s.handle, outcome: "ok" });
      return redirect(`/account?uploaded=${encodeURIComponent(attachment.id)}${renamed ? "&renamed=1" : ""}`);
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      await recordEvent(c.env.DB, { kind: "files", name: "upload", subject: s.handle, outcome: e.code });
      return failed(`Not uploaded. ${esc(e.message)}`, e.status);
    }
  });

  app.post("/account/remove", async (c) => {
    const s = c.get("session");
    try {
      await c.get("service").removeUnsent(principalOf(s), str(c.get("body"), "id"));
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return page(c, s, { flash: { ok: false, text: "That file is in a handoff now, or was already removed." }, status: e.status });
    }
    await recordEvent(c.env.DB, { kind: "files", name: "remove", subject: s.handle, outcome: "ok" });
    return redirect("/account?removed=1");
  });

  // A file of a live handoff the member sent or received, with the same check as an assistant's download.
  app.get("/account/download/:packet/:attachment", async (c) => {
    const s = c.get("session");
    const svc = c.get("service");
    try {
      const { attachment } = await svc.readAttachment(principalOf(s), c.req.param("packet"), c.req.param("attachment"));
      const blob = await svc.openBlob(attachment);
      await recordEvent(c.env.DB, { kind: "files", name: "download", subject: s.handle, outcome: "ok" });
      return attachmentResponse(attachment, blob);
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return problem("File not available", "This file is not available. Its handoff may have expired or been revoked.", e.status);
    }
  });

  return app;
}
