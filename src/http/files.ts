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
import { CONSOLE_HEADERS, bytes, esc, interactiveHeaders, problemPage, type Html } from "../console/html";
import { FILES_SESSIONS, cookieToken, csrfOk, endSession, loginAllowed, sameOrigin, sessionCookie, sessionFrom, startSession, type Session } from "../console/session";
import type { UnsentFile } from "../domain/service";
import { attachmentResponse } from "./routes";
import { filesLoginPage, filesPage, type Flash } from "./files-page";

type Body = Record<string, string | File | (string | File)[]>;
type FilesVariables = Variables & { session: Session; body: Body };
type C = { env: Env; get: <K extends keyof FilesVariables>(k: K) => FilesVariables[K]; req: { header: (n: string) => string | undefined } };

const BACK = { site: "Handoff", href: "/files", label: "Back to your files" };
const html = (body: Html, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { ...CONSOLE_HEADERS, ...extra } });
const redirect = (to: string, extra: Record<string, string> = {}): Response =>
  new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...extra } });
const str = (body: Body, key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");

/** The page acts as the signed-in member, like their assistants do: same identity, same access rules. */
const principalOf = (s: Session): Principal => ({ subject: s.handle, scopes: [], clientId: "files", token: "" });

/**
 * The member file page at /files. Any member signs in with their username and access code (the console is for
 * admins). They upload files for their assistant to send and download the files of their handoffs. Every change
 * is a form POST from this origin carrying the session's CSRF value.
 */
export function filesRoutes(): Hono<{ Bindings: Env; Variables: FilesVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: FilesVariables }>();

  const page = async (c: C, s: Session, flash: Flash | ((unsent: UnsentFile[]) => Flash), status = 200): Promise<Response> => {
    const svc = c.get("service");
    const p = principalOf(s);
    const [unsent, handoffs] = await Promise.all([svc.unsentFiles(p, 50), svc.recentHandoffs(p, 20)]);
    const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const body = filesPage(
      { handle: handleOf(s.handle), tenant: tenantOf(s.handle), csrf: s.csrf },
      { unsent, handoffs, maxBytes: svc.cfg.maxAttachmentBytes, flash: typeof flash === "function" ? flash(unsent) : flash, now: Date.now() },
      nonce,
    );
    return new Response(body, { status, headers: interactiveHeaders(nonce) });
  };
  const loginPage = (c: C, error?: string, team?: string) => filesLoginPage({ control: c.get("cfg").mode === "control", error, team });
  const sessionOf = (c: C) => sessionFrom(c.env.DB, cookieToken(c.req.header("cookie"), FILES_SESSIONS), FILES_SESSIONS);

  // Forms are small, except the upload: one file of the largest size this server takes, and the form around it.
  app.use("/files/*", async (c, next) => {
    const max = c.req.path === "/files/upload" ? c.get("cfg").maxAttachmentBytes + 64 * 1024 : 4096;
    const tooLarge = `That is larger than this server accepts${c.req.path === "/files/upload" ? `: files up to ${bytes(c.get("cfg").maxAttachmentBytes)}` : ""}.`;
    return bodyLimit({ maxSize: max, onError: () => html(problemPage("Too large", tooLarge, BACK), 413) })(c, next);
  });

  app.get("/files", async (c) => {
    const s = await sessionOf(c);
    if (!s) return html(loginPage(c));
    const uploaded = c.req.query("uploaded");
    const removed = c.req.query("removed") === "1";
    return page(c, s, (unsent) => {
      const f = uploaded ? unsent.find((u) => u.attachment_id === uploaded) : undefined;
      if (f) return { ok: true, text: `Uploaded <strong>${esc(f.filename)}</strong>. Your assistant can now attach it to a handoff by its name.` };
      return removed ? { ok: true, text: "File removed." } : null;
    });
  });

  app.post("/files/login", async (c) => {
    const db = c.env.DB;
    const cfg = c.get("cfg");
    if (!sameOrigin(c.req.header("origin"), cfg.publicUrl)) {
      return html(problemPage("Sign-in refused", "The sign-in form must be sent from this server's own page.", BACK), 403);
    }
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip"), "files-login"))) {
      return html(loginPage(c, "Too many attempts. Try again in 10 minutes."), 429, { "retry-after": "600" });
    }
    const form = (await c.req.parseBody()) as Body;
    const identity = identityFrom(cfg, str(form, "team"), str(form, "handle"));
    const code = str(form, "access_code");
    const valid = identity !== null && code.length > 0 && code.length <= 256 && (await verifyMemberCode(db, identity, code)) === identity;
    const cookie = valid && identity ? await startSession(db, identity, FILES_SESSIONS) : null;
    if (!cookie) {
      await recordEvent(db, { kind: "files", name: "login", subject: identity, outcome: "refused" }, { unauthenticated: true });
      const msg = cfg.mode === "control" ? "That team, username and access code do not match." : "That username and access code do not match.";
      return html(loginPage(c, msg, str(form, "team")), 401);
    }
    await recordEvent(db, { kind: "files", name: "login", subject: identity, outcome: "ok" });
    return redirect("/files", { "set-cookie": cookie });
  });

  // Everything below needs a session; a POST also needs this origin and the session's CSRF value.
  app.use("/files/*", async (c, next) => {
    const s = await sessionOf(c);
    if (!s) return c.req.method === "GET" ? redirect("/files") : html(loginPage(c, "Your session ended. Sign in again."), 401);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
        return html(problemPage("Refused", "Changes must be sent from this server's own pages.", BACK), 403);
      }
      const body = (await c.req.parseBody()) as Body;
      if (!csrfOk(s, body.csrf)) return html(problemPage("This form has expired", "Go back, reload the page, and try again.", BACK), 403);
      c.set("body", body);
    }
    c.set("session", s);
    await next();
  });

  app.post("/files/logout", async (c) => {
    await endSession(c.env.DB, c.get("session"), FILES_SESSIONS);
    return redirect("/files", { "set-cookie": sessionCookie("", 0, FILES_SESSIONS) });
  });

  app.post("/files/upload", async (c) => {
    const s = c.get("session");
    const body = c.get("body");
    const svc = c.get("service");
    const file = body.file;
    if (!(file instanceof File) || !file.name) return page(c, s, { ok: false, text: "Choose a file to upload." }, 400);
    if (file.size === 0) return page(c, s, { ok: false, text: "That file is empty." }, 400);
    if (file.size > svc.cfg.maxAttachmentBytes) return page(c, s, { ok: false, text: `That file is larger than ${esc(bytes(svc.cfg.maxAttachmentBytes))}.` }, 413);
    try {
      const row = await svc.webUpload(principalOf(s), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, str(body, "note"));
      await recordEvent(c.env.DB, { kind: "files", name: "upload", subject: s.handle, outcome: "ok" });
      return redirect(`/files?uploaded=${encodeURIComponent(row.id)}`);
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      await recordEvent(c.env.DB, { kind: "files", name: "upload", subject: s.handle, outcome: e.code });
      return page(c, s, { ok: false, text: `Not uploaded. ${esc(e.message)}` }, e.status);
    }
  });

  app.post("/files/remove", async (c) => {
    const s = c.get("session");
    try {
      await c.get("service").removeUnsent(principalOf(s), str(c.get("body"), "id"));
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return page(c, s, { ok: false, text: "That file is in a handoff now, or was already removed." }, e.status);
    }
    await recordEvent(c.env.DB, { kind: "files", name: "remove", subject: s.handle, outcome: "ok" });
    return redirect("/files?removed=1");
  });

  // A file of a live handoff the member sent or received, with the same check as an assistant's download.
  app.get("/files/download/:packet/:attachment", async (c) => {
    const s = c.get("session");
    const svc = c.get("service");
    try {
      const { attachment } = await svc.readAttachment(principalOf(s), c.req.param("packet"), c.req.param("attachment"));
      const blob = await svc.openBlob(attachment);
      await recordEvent(c.env.DB, { kind: "files", name: "download", subject: s.handle, outcome: "ok" });
      return attachmentResponse(attachment, blob);
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return html(problemPage("File not available", "This file is not available. Its handoff may have expired or been revoked.", BACK), e.status);
    }
  });

  return app;
}
