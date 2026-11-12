import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import type { Principal } from "../auth/verify";
import { HandoffError } from "../domain/errors";
import { base64url, nowIso } from "../domain/ids";
import { assistantName } from "../domain/service";
import { handleOf, tenantOf } from "../domain/tenant";
import type { AttachmentRow } from "../store/repository";
import { recordEvent } from "../store/events";
import { bytes, esc, interactiveHeaders, problemPage, type Html } from "../console/html";
import { csrfOk, isAdmin, sameOrigin, sessionFrom, type Session } from "../console/session";
import { attachmentResponse } from "./routes";
import { renderBrief } from "./markdown";
import {
  filePage,
  packetPage,
  packetsPage,
  previewKind,
  revokePage,
  type FileCard,
  type FirstDay,
  type Flash,
  type PacketsFilter,
  type PacketsViewer,
  type Preview,
} from "./packets-page";

type Body = Record<string, string | File | (string | File)[]>;
type PacketsVariables = Variables & { session: Session; body: Body };
type C = { env: Env; get: <K extends keyof PacketsVariables>(k: K) => PacketsVariables[K]; req: { header: (n: string) => string | undefined } };

/** Packets per page; "Show older packets" continues from the last one. */
const PAGE_SIZE = 20;
/** The most of a text or Markdown file a page shows; Download has the rest. */
const TEXT_PREVIEW_BYTES = 256 * 1024;
const BACK = { site: "Threadpacket", href: "/packets", label: "Back to Packets" };
const redirect = (to: string): Response => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
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
const principalOf = (s: Session): Principal => ({ subject: s.handle, scopes: [], clientId: "packets", token: "" });

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
 * Packets at /packets, for any signed-in member (see /login). They see their unsent files and live packets in one list,
 * open a packet to read its brief and see its files, upload a file for their assistant to send, and remove an unsent file.
 * Every change is a form POST from this origin carrying the session's CSRF value.
 */
export function packetsRoutes(): Hono<{ Bindings: Env; Variables: PacketsVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: PacketsVariables }>();

  const viewer = async (c: C, s: Session): Promise<PacketsViewer> => ({
    handle: handleOf(s.handle),
    tenant: tenantOf(s.handle),
    control: c.get("cfg").mode === "control",
    admin: await isAdmin(c.env.DB, s.handle),
    csrf: s.csrf,
    others: s.others,
  });

  /** The names of the assistants connected with this member's account (a live refresh token). */
  const assistantsOf = async (c: C, subject: string): Promise<string[]> => {
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT c.client_name FROM oauth_refresh_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.subject = ? AND t.revoked_at IS NULL AND t.expires_at > ?`,
    )
      .bind(subject, nowIso())
      .all<{ client_name: string | null }>();
    return [...new Set(results.map((r) => assistantName(r.client_name) ?? "An assistant"))];
  };

  /** A new member's next steps: connect an assistant, invite someone (an admin), send a packet. */
  const firstDay = async (c: C, s: Session, v: PacketsViewer): Promise<FirstDay> => {
    const [assistants, mates] = await Promise.all([assistantsOf(c, s.handle), c.get("service").teammates(principalOf(s))]);
    return {
      assistants,
      invite: v.admin && (v.tenant || !v.control) ? `Invite my ${v.control ? "partner" : "teammate"} to Threadpacket.` : null,
      send: mates[0] ? `Send a packet to ${mates[0]}.` : "Send myself a packet.",
    };
  };

  const page = async (
    c: C,
    s: Session,
    opts: { flash?: Flash | ((unsentIds: Map<string, string>) => Flash); status?: number; uploadOpen?: boolean; cursor?: string; filter?: PacketsFilter },
  ): Promise<Response> => {
    const svc = c.get("service");
    const p = principalOf(s);
    const filter = opts.filter ?? "all";
    const first = !opts.cursor;
    const [unsent, unseen, list, v] = await Promise.all([
      first ? svc.unsentFiles(p, 100) : Promise.resolve([]),
      first && filter !== "sent" ? svc.unseen(p) : Promise.resolve([]),
      svc.packetsPage(p, { limit: PAGE_SIZE, cursor: opts.cursor, filter }),
      viewer(c, s),
    ]);
    const flash = typeof opts.flash === "function" ? opts.flash(new Map(unsent.map((f) => [f.attachment_id, f.filename]))) : (opts.flash ?? null);
    const empty = first && filter === "all" && !unsent.length && !unseen.length && !list.packets.length;
    const fd = empty ? await firstDay(c, s, v) : undefined;
    return respond(
      (nonce) =>
        packetsPage(
          v,
          {
            unsent,
            unseen,
            packets: list.packets,
            filter,
            nextCursor: list.next_cursor,
            older: !!opts.cursor,
            uploadOpen: !!opts.uploadOpen,
            maxBytes: svc.cfg.maxAttachmentBytes,
            unsentTtlMs: svc.cfg.unattachedReadyTtlMs,
            flash,
            now: Date.now(),
            firstDay: fd,
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

  const sessionOf = (c: C) => sessionFrom(c.env.DB, c.req.header("cookie"));
  /** Not signed in: sign in, then come back to this page (a form's page, for a POST). */
  const toLogin = (c: { req: { method: string; url: string } }) => {
    const u = new URL(c.req.url);
    const back = c.req.method === "GET" || c.req.method === "HEAD" ? `${u.pathname}${u.search}` : "/packets";
    return redirect(`/login?next=${encodeURIComponent(back)}`);
  };

  // Forms are small, except the upload: one file of the largest size this server takes, and the form around it.
  app.use("/packets/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const upload = c.req.path === "/packets/upload";
    const max = upload ? c.get("cfg").maxAttachmentBytes + 64 * 1024 : 4096;
    const tooLarge = `That is larger than this server accepts${upload ? `: files up to ${bytes(c.get("cfg").maxAttachmentBytes)}` : ""}.`;
    return bodyLimit({ maxSize: max, onError: () => problem("Too large", tooLarge, 413) })(c, next);
  });

  app.get("/packets", async (c) => {
    const s = await sessionOf(c);
    if (!s) return toLogin(c);
    const q = (k: string) => c.req.query(k);
    const older = q("older");
    const show = q("show");
    const filter: PacketsFilter = show === "sent" || show === "received" ? show : "all";
    try {
      return await page(c, s, {
        cursor: older || undefined,
        filter,
        uploadOpen: q("upload") === "1",
        flash: (unsent) => {
          const name = unsent.get(q("uploaded") ?? "");
          if (name) {
            const what = q("renamed") === "1" ? `Uploaded as <strong>${esc(name)}</strong>, because you already had a file with that name.` : `Uploaded <strong>${esc(name)}</strong>.`;
            return { ok: true, text: `${what} Tell your assistant: <q>Send a packet with ${esc(name)}.</q>` };
          }
          if (q("revoked") === "1") return { ok: true, text: "Packet revoked. No one can open it now." };
          return q("removed") === "1" ? { ok: true, text: "File removed." } : null;
        },
      });
    } catch (e) {
      // A cursor that is not ours: start from the newest.
      if (e instanceof HandoffError && older) return redirect(filter === "all" ? "/packets" : `/packets?show=${filter}`);
      throw e;
    }
  });

  // Everything below needs a session; a POST also needs this origin and the session's CSRF value.
  app.use("/packets/*", async (c, next) => {
    const s = await sessionOf(c);
    if (!s) return toLogin(c);
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

  app.post("/packets/upload", async (c) => {
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
      await recordEvent(c.env.DB, { kind: "packets", name: "upload", subject: s.handle, outcome: "ok" });
      return redirect(`/packets?uploaded=${encodeURIComponent(attachment.id)}${renamed ? "&renamed=1" : ""}`);
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      await recordEvent(c.env.DB, { kind: "packets", name: "upload", subject: s.handle, outcome: e.code });
      return failed(`Not uploaded. ${esc(e.message)}`, e.status);
    }
  });

  app.post("/packets/remove", async (c) => {
    const s = c.get("session");
    try {
      await c.get("service").removeUnsent(principalOf(s), str(c.get("body"), "id"));
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return page(c, s, { flash: { ok: false, text: "That file is in a packet now, or was already removed." }, status: e.status });
    }
    await recordEvent(c.env.DB, { kind: "packets", name: "remove", subject: s.handle, outcome: "ok" });
    return redirect("/packets?removed=1");
  });

  // A file of a live packet the member sent or received, shown in the page or downloaded.
  for (const [route, inline] of [
    ["/packets/view/:packet{pk_[a-z2-7]+}/:attachment/:filename", true],
    ["/packets/view/:packet{pk_[a-z2-7]+}/:attachment", true],
    ["/packets/download/:packet{pk_[a-z2-7]+}/:attachment", false],
  ] as const) {
    app.get(route, async (c) => {
      const s = c.get("session");
      const svc = c.get("service");
      try {
        const { attachment } = await svc.readAttachment(principalOf(s), c.req.param("packet"), c.req.param("attachment"));
        const blob = await svc.openBlob(attachment);
        await recordEvent(c.env.DB, { kind: "packets", name: inline ? "view" : "download", subject: s.handle, outcome: "ok" });
        return inline ? inlineResponse(attachment, blob) : attachmentResponse(attachment, blob);
      } catch (e) {
        if (!(e instanceof HandoffError)) throw e;
        return problem("File not available", "This file is not available. Its packet may have expired or been revoked.", e.status);
      }
    });
  }

  /** The member's own file that no packet carries yet. Only its uploader sees it. */
  const ownUnsent = async (c: C, s: Session, id: string): Promise<AttachmentRow | null> => {
    const svc = c.get("service");
    const p = principalOf(s);
    const listed = (await svc.unsentFiles(p, 100)).some((f) => f.attachment_id === id);
    if (!listed) return null;
    const a = await svc.getOwnedAttachment(p, id).catch(() => null);
    return a && a.state === "ready" ? a : null;
  };

  app.get("/packets/file/:attachment", async (c) => {
    const s = c.get("session");
    const svc = c.get("service");
    const id = c.req.param("attachment");
    const a = await ownUnsent(c, s, id);
    const f = a ? (await svc.unsentFiles(principalOf(s), 100)).find((x) => x.attachment_id === id) : undefined;
    if (!a || !f) return problem("File not available", "This file was sent in a packet, removed, or has expired. A sent file is under its packet in Packets.", 404);
    const base = encodeURIComponent(id);
    const card: FileCard = { attachment_id: id, filename: f.filename, mime_type: f.mime_type, size: f.size, view: `/packets/view/${base}/${encodeURIComponent(f.filename)}`, download: `/packets/download/${base}`, preview: await preview(c, a) };
    const v = await viewer(c, s);
    return respond((nonce) => filePage(v, f, card, Date.now(), svc.cfg.unattachedReadyTtlMs, nonce));
  });

  for (const [route, inline] of [
    ["/packets/view/:attachment{at_[a-z2-7]+}/:filename", true],
    ["/packets/view/:attachment", true],
    ["/packets/download/:attachment", false],
  ] as const) {
    app.get(route, async (c) => {
      const s = c.get("session");
      const a = await ownUnsent(c, s, c.req.param("attachment"));
      if (!a) return problem("File not available", "This file was sent in a packet, removed, or has expired. A sent file is under its packet in Packets.", 404);
      const blob = await c.get("service").openBlob(a);
      return inline ? inlineResponse(a, blob) : attachmentResponse(a, blob);
    });
  }

  // A packet the member sent or received: its brief and its files, with the same check as an assistant's read.
  app.get("/packets/:packet{pk_[a-z2-7]+}", async (c) => {
    const s = c.get("session");
    const svc = c.get("service");
    const p = principalOf(s);
    const packetId = c.req.param("packet");
    try {
      // Opening it here is a pickup in the browser, for a recipient.
      const h = await svc.read(p, packetId, "browser");
      const delivery = await svc.delivery(p, packetId);
      const ready = h.attachments.filter((a) => a.state === "ready");
      const cards: FileCard[] = [];
      for (const d of ready) {
        const { attachment } = await svc.readAttachment(p, packetId, d.attachment_id);
        const base = `${encodeURIComponent(packetId)}/${encodeURIComponent(d.attachment_id)}`;
        cards.push({ ...d, view: `/packets/view/${base}/${encodeURIComponent(d.filename)}`, download: `/packets/download/${base}`, preview: await preview(c, attachment) });
      }
      const v = await viewer(c, s);
      await recordEvent(c.env.DB, { kind: "packets", name: "open", subject: s.handle, outcome: "ok" });
      return respond((nonce) => packetPage(v, h, delivery, renderBrief(h.brief), cards, Date.now(), nonce));
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return problem("Packet not available", "This packet is not available. It may have expired or been revoked.", e.status);
    }
  });

  // Its sender can revoke a packet here: a page that asks first, then the form. Nobody else sees either.
  const ownPacket = async (c: C, s: Session, packetId: string) => {
    const svc = c.get("service");
    const p = principalOf(s);
    try {
      const pkt = await svc.livePacket(s.handle, packetId);
      if (pkt.owner !== s.handle) return null;
      return { view: await svc.read(p, packetId, null), delivery: await svc.delivery(p, packetId) };
    } catch (e) {
      if (!(e instanceof HandoffError)) throw e;
      return null;
    }
  };
  const notRevocable = () => problem("Packet not available", "Only the sender of a live packet can revoke it. It may have expired or been revoked already.", 404);

  app.get("/packets/:packet{pk_[a-z2-7]+}/revoke", async (c) => {
    const s = c.get("session");
    const own = await ownPacket(c, s, c.req.param("packet"));
    if (!own) return notRevocable();
    const v = await viewer(c, s);
    return respond((nonce) => revokePage(v, own.view, own.delivery, nonce));
  });

  app.post("/packets/:packet{pk_[a-z2-7]+}/revoke", async (c) => {
    const s = c.get("session");
    const packetId = c.req.param("packet");
    if (!(await ownPacket(c, s, packetId))) return notRevocable();
    await c.get("service").revoke(principalOf(s), packetId);
    await recordEvent(c.env.DB, { kind: "packets", name: "revoke", subject: s.handle, outcome: "ok" });
    return redirect("/packets?revoked=1");
  });

  return app;
}
