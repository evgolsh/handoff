import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import type { Principal } from "../auth/verify";
import { identityFrom, verifyMemberCode } from "../auth/builtin";
import { HandoffError } from "../domain/errors";
import { base64url } from "../domain/ids";
import { handleOf, tenantOf } from "../domain/tenant";
import type { AttachmentRow } from "../store/repository";
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
import { renderBrief } from "./markdown";
import { assetsLoginPage, assetsPage, filePage, handoffPage, previewKind, type AssetsViewer, type FileCard, type Flash, type Preview } from "./assets-page";

type Body = Record<string, string | File | (string | File)[]>;
type AssetsVariables = Variables & { session: Session; body: Body };
type C = { env: Env; get: <K extends keyof AssetsVariables>(k: K) => AssetsVariables[K]; req: { header: (n: string) => string | undefined } };

/** Handoffs per page; "Show older handoffs" continues from the last one. */
const PAGE_SIZE = 20;
/** The most of a text or Markdown file a page shows; Download has the rest. */
const TEXT_PREVIEW_BYTES = 256 * 1024;
const BACK = { site: "Handoff", href: "/assets", label: "Back to Assets" };
const redirect = (to: string, status = 303): Response => new Response(null, { status, headers: { location: to, "cache-control": "no-store" } });
const str = (body: Body, key: string): string => (typeof body[key] === "string" ? (body[key] as string) : "");
const newNonce = (): string => base64url(crypto.getRandomValues(new Uint8Array(16)));

/** The pages may frame their own PDFs: frame-src 'self' on top of the console's policy. */
const pageHeaders = (nonce: string): Record<string, string> => {
  const h = interactiveHeaders(nonce);
  return { ...h, "content-security-policy": `${h["content-security-policy"]}; frame-src 'self'` };
};
/** Every page here carries the small page script, so every response gets a nonce. */
const respond = (render: (nonce: string) => Html, status = 200): Response => {
  const nonce = newNonce();
  return new Response(render(nonce), { status, headers: pageHeaders(nonce) });
};
const problem = (title: string, text: string, status: number): Response => respond(() => problemPage(title, text, BACK), status);

/** The page acts as the signed-in member, like their assistants do: same identity, same access rules. */
const principalOf = (s: Session): Principal => ({ subject: s.handle, scopes: [], clientId: "files", token: "" });

/**
 * A stored file shown in the page. Only the types the upload admits are shown, as the type the bytes were checked
 * to be; text and Markdown as plain text. Everything but a PDF is sandboxed. The page itself may frame it; no
 * other site may. A PDF gets no sandbox: browsers refuse to show a sandboxed PDF.
 */
function inlineResponse(a: AttachmentRow, blob: { body: ReadableStream<Uint8Array>; size: number }): Response {
  const kind = previewKind(a.mime_type);
  if (kind === "none") return attachmentResponse(a, blob);
  const name = encodeURIComponent(a.filename).replace(/['()]/g, escape);
  return new Response(blob.body, {
    status: 200,
    headers: {
      "content-type": kind === "text" || kind === "markdown" ? "text/plain; charset=utf-8" : a.mime_type!,
      "content-length": String(blob.size),
      "content-disposition": `inline; filename*=UTF-8''${name}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "no-referrer",
      "content-security-policy": kind === "pdf" ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'",
    },
  });
}

/**
 * Assets at /assets. Any member signs in with their username and access code; an admin's sign-in also opens the
 * console. They see their unsent files and live handoffs in one list, open a handoff to read its brief and see
 * its files, upload a file for their assistant to send, and remove an unsent file. Every change is a form POST
 * from this origin carrying the session's CSRF value.
 */
export function assetsRoutes(): Hono<{ Bindings: Env; Variables: AssetsVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AssetsVariables }>();

  const viewer = async (c: C, s: Session): Promise<AssetsViewer> => ({
    handle: handleOf(s.handle),
    tenant: tenantOf(s.handle),
    control: c.get("cfg").mode === "control",
    admin: await isAdmin(c.env.DB, s.handle),
    csrf: s.csrf,
  });

  const page = async (c: C, s: Session, opts: { flash?: Flash | ((unsentIds: Map<string, string>) => Flash); status?: number; uploadOpen?: boolean; cursor?: string }): Promise<Response> => {
    const svc = c.get("service");
    const p = principalOf(s);
    const [unsent, handoffs, v] = await Promise.all([
      opts.cursor ? Promise.resolve([]) : svc.unsentFiles(p, 100),
      svc.handoffsPage(p, { limit: PAGE_SIZE, cursor: opts.cursor }),
      viewer(c, s),
    ]);
    const flash = typeof opts.flash === "function" ? opts.flash(new Map(unsent.map((f) => [f.attachment_id, f.filename]))) : (opts.flash ?? null);
    return respond(
      (nonce) =>
        assetsPage(
          v,
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

  /** Text and Markdown are read here and shown in the page; PDFs and images load from the view URL. */
  const preview = async (c: C, a: AttachmentRow): Promise<Preview> => {
    const kind = previewKind(a.mime_type);
    if (kind !== "text" && kind !== "markdown") return { kind };
    const all = await c.get("service").readBlobBytes(a);
    const cut = all.byteLength > TEXT_PREVIEW_BYTES;
    const text = new TextDecoder().decode(cut ? all.subarray(0, TEXT_PREVIEW_BYTES) : all);
    return kind === "text" ? { kind, text, cut } : { kind, html: renderBrief(text), cut };
  };

  const loginPage = (c: C, error?: string, team?: string, status = 200) =>
    respond((nonce) => assetsLoginPage({ control: c.get("cfg").mode === "control", error, team }, nonce), status);
  const sessionOf = (c: C) => sessionFrom(c.env.DB, cookieToken(c.req.header("cookie"), ACCOUNT_SESSIONS), ACCOUNT_SESSIONS);

  // Assets was My account (/account), and before that the files page (/files). Old links and open tabs follow;
  // 307 keeps a form's method and body, and the new routes check its origin and CSRF value as usual.
  for (const old of ["/files", "/account"]) {
    app.all(old, (c) => redirect(`/assets${new URL(c.req.url).search}`, 307));
    app.all(`${old}/*`, (c) => redirect(`${c.req.path.replace(old, "/assets")}${new URL(c.req.url).search}`, 307));
  }

  // Forms are small, except the upload: one file of the largest size this server takes, and the form around it.
  app.use("/assets/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const upload = c.req.path === "/assets/upload";
    const max = upload ? c.get("cfg").maxAttachmentBytes + 64 * 1024 : 4096;
    const tooLarge = `That is larger than this server accepts${upload ? `: files up to ${bytes(c.get("cfg").maxAttachmentBytes)}` : ""}.`;
    return bodyLimit({ maxSize: max, onError: () => problem("Too large", tooLarge, 413) })(c, next);
  });

  app.get("/assets", async (c) => {
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
      if (e instanceof HandoffError && older) return redirect("/assets");
      throw e;
    }
  });

  app.post("/assets/login", async (c) => {
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
    // One sign-in: every member gets Assets, and an admin the console as well.
    const cookies = valid && identity ? await startSessions(db, identity) : [];
    if (cookies.length === 0) {
      await recordEvent(db, { kind: "files", name: "login", subject: identity, outcome: "refused" }, { unauthenticated: true });
      const msg = cfg.mode === "control" ? "That team, username and access code do not match." : "That username and access code do not match.";
      return loginPage(c, msg, str(form, "team"), 401);
    }
    await recordEvent(db, { kind: "files", name: "login", subject: identity, outcome: "ok" });
    return redirectSetting("/assets", cookies);
  });

  // Everything below needs a session; a POST also needs this origin and the session's CSRF value.
  app.use("/assets/*", async (c, next) => {
    const s = await sessionOf(c);
    if (!s) return c.req.method === "GET" || c.req.method === "HEAD" ? redirect("/assets") : loginPage(c, "Your session ended. Sign in again.", undefined, 401);
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
  app.post("/assets/logout", async (c) => redirectSetting("/assets", await endSessions(c.env.DB, c.req.header("cookie"))));

  app.post("/assets/upload", async (c) => {
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
      return redirect(`/assets?uploaded=${encodeURIComponent(attachment.id)}${renamed ? "&renamed=1" : ""}`);
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      await recordEvent(c.env.DB, { kind: "files", name: "upload", subject: s.handle, outcome: e.code });
      return failed(`Not uploaded. ${esc(e.message)}`, e.status);
    }
  });

  app.post("/assets/remove", async (c) => {
    const s = c.get("session");
    try {
      await c.get("service").removeUnsent(principalOf(s), str(c.get("body"), "id"));
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return page(c, s, { flash: { ok: false, text: "That file is in a handoff now, or was already removed." }, status: e.status });
    }
    await recordEvent(c.env.DB, { kind: "files", name: "remove", subject: s.handle, outcome: "ok" });
    return redirect("/assets?removed=1");
  });

  // A handoff the member sent or received: its brief and its files, with the same check as an assistant's read.
  app.get("/assets/handoff/:packet", async (c) => {
    const s = c.get("session");
    const svc = c.get("service");
    const p = principalOf(s);
    const packetId = c.req.param("packet");
    try {
      const h = await svc.read(p, packetId);
      const ready = h.attachments.filter((a) => a.state === "ready");
      const cards: FileCard[] = [];
      for (const d of ready) {
        const { attachment } = await svc.readAttachment(p, packetId, d.attachment_id);
        const base = `${encodeURIComponent(packetId)}/${encodeURIComponent(d.attachment_id)}`;
        cards.push({ ...d, view: `/assets/view/${base}`, download: `/assets/download/${base}`, preview: await preview(c, attachment) });
      }
      const v = await viewer(c, s);
      await recordEvent(c.env.DB, { kind: "files", name: "open", subject: s.handle, outcome: "ok" });
      return respond((nonce) => handoffPage(v, h, renderBrief(h.brief), cards, Date.now(), nonce));
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return problem("Handoff not available", "This handoff is not available. It may have expired or been revoked.", e.status);
    }
  });

  // A file of a live handoff the member sent or received, shown in the page or downloaded.
  for (const [route, inline] of [["/assets/view/:packet/:attachment", true], ["/assets/download/:packet/:attachment", false]] as const) {
    app.get(route, async (c) => {
      const s = c.get("session");
      const svc = c.get("service");
      try {
        const { attachment } = await svc.readAttachment(principalOf(s), c.req.param("packet"), c.req.param("attachment"));
        const blob = await svc.openBlob(attachment);
        await recordEvent(c.env.DB, { kind: "files", name: inline ? "view" : "download", subject: s.handle, outcome: "ok" });
        return inline ? inlineResponse(attachment, blob) : attachmentResponse(attachment, blob);
      } catch (e) {
        if (!(e instanceof HandoffError)) throw e;
        return problem("File not available", "This file is not available. Its handoff may have expired or been revoked.", e.status);
      }
    });
  }

  /** The member's own file that no handoff carries yet. Only its uploader sees it. */
  const ownUnsent = async (c: C, s: Session, id: string): Promise<AttachmentRow | null> => {
    const svc = c.get("service");
    const p = principalOf(s);
    const listed = (await svc.unsentFiles(p, 100)).some((f) => f.attachment_id === id);
    if (!listed) return null;
    const a = await svc.getOwnedAttachment(p, id).catch(() => null);
    return a && a.state === "ready" ? a : null;
  };

  app.get("/assets/file/:attachment", async (c) => {
    const s = c.get("session");
    const svc = c.get("service");
    const id = c.req.param("attachment");
    const a = await ownUnsent(c, s, id);
    const f = a ? (await svc.unsentFiles(principalOf(s), 100)).find((x) => x.attachment_id === id) : undefined;
    if (!a || !f) return problem("File not available", "This file was sent in a handoff, removed, or has expired. A sent file is under its handoff in Assets.", 404);
    const base = encodeURIComponent(id);
    const card: FileCard = { attachment_id: id, filename: f.filename, mime_type: f.mime_type, size: f.size, view: `/assets/view/${base}`, download: `/assets/download/${base}`, preview: await preview(c, a) };
    const v = await viewer(c, s);
    return respond((nonce) => filePage(v, f, card, Date.now(), svc.cfg.unattachedReadyTtlMs, nonce));
  });

  for (const [route, inline] of [["/assets/view/:attachment", true], ["/assets/download/:attachment", false]] as const) {
    app.get(route, async (c) => {
      const s = c.get("session");
      const a = await ownUnsent(c, s, c.req.param("attachment"));
      if (!a) return problem("File not available", "This file was sent in a handoff, removed, or has expired. A sent file is under its handoff in Assets.", 404);
      const blob = await c.get("service").openBlob(a);
      return inline ? inlineResponse(a, blob) : attachmentResponse(a, blob);
    });
  }

  return app;
}
