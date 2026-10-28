import { Hono } from "hono";
import type { Env } from "../env";
import type { AppVariables } from "../auth/middleware";
import { bearerFrom, challenge, requireAuth } from "../auth/middleware";
import { AuthError, HandoffError } from "../domain/errors";
import { describe, readBounded, type HandoffService } from "../domain/service";
import { verifyBearer } from "../auth/verify";
import type { AttachmentRow } from "../store/repository";

type App = Hono<{ Bindings: Env; Variables: AppVariables & { service: HandoffService } }>;

function attachmentResponse(a: AttachmentRow, blob: { body: ReadableStream<Uint8Array>; size: number }): Response {
  const name = encodeURIComponent(a.filename).replace(/['()]/g, escape);
  return new Response(blob.body, {
    status: 200,
    headers: {
      "content-type": a.mime_type ?? "application/octet-stream",
      "content-length": String(blob.size),
      "content-disposition": `attachment; filename*=UTF-8''${name}`,
      "x-checksum-sha256": a.sha256 ?? "",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** REST surface for bytes. The MCP tools carry briefs and metadata; files go through these endpoints. */
export function uploadRoutes(): App {
  const app: App = new Hono();

  // Create a staging attachment; the bytes follow with PUT.
  app.post("/v1/uploads", requireAuth, async (c) => {
    const svc = c.get("service");
    const body = (await c.req.json().catch(() => null)) as { filename?: string; mime_type?: string } | null;
    if (!body || typeof body.filename !== "string" || !body.filename.trim()) {
      throw new HandoffError("invalid_input", "body must be JSON with a filename");
    }
    const row = await svc.createUpload(c.get("principal"), { filename: body.filename, mime_type: body.mime_type });
    return c.json(
      {
        attachment_id: row.id,
        upload_url: `${svc.cfg.publicUrl}/v1/uploads/${row.id}`,
        method: "PUT",
        max_bytes: svc.cfg.maxAttachmentBytes,
        note: "PUT the raw file bytes with your bearer token, or with ?ticket= from handoff_upload_url.",
      },
      201,
    );
  });

  // Receive the bytes. Auth: bearer token of the owner, or a single-use upload ticket for this attachment.
  app.put("/v1/uploads/:id", async (c) => {
    const svc = c.get("service");
    const cfg = c.get("cfg");
    const id = c.req.param("id");
    const ticket = c.req.query("ticket");
    let attachment: AttachmentRow | null;
    if (ticket) {
      attachment = await svc.redeemUploadTicket(ticket, id);
    } else {
      const token = bearerFrom(c);
      if (!token) return challenge(cfg, new AuthError("invalid_request", "missing bearer token or ?ticket="));
      let principal;
      try {
        principal = await verifyBearer(cfg, token, c.env.DB);
      } catch (e) {
        if (e instanceof AuthError) return challenge(cfg, e);
        throw e;
      }
      attachment = await svc.getOwnedAttachment(principal, id);
    }
    const declaredLen = Number(c.req.header("content-length") ?? "0");
    if (declaredLen > cfg.maxAttachmentBytes) throw new HandoffError("too_large", `attachment larger than ${cfg.maxAttachmentBytes} bytes`);
    const bytes = await readBounded(c.req.raw.body, cfg.maxAttachmentBytes);
    if (!bytes) throw new HandoffError("too_large", `attachment larger than ${cfg.maxAttachmentBytes} bytes`);
    const ready = await svc.receiveBytes(attachment, bytes, {
      mime_type: c.req.header("content-type") ?? null,
      sha256: c.req.header("x-checksum-sha256") ?? null,
    });
    return c.json(describe(ready), 200);
  });

  app.get("/v1/attachments/:id", requireAuth, async (c) => {
    const a = await c.get("service").getOwnedAttachment(c.get("principal"), c.req.param("id"));
    return c.json(describe(a));
  });

  // Owner download with the bearer token. Like every file read, it needs a live packet that contains the
  // file (?packet_id= names one; without it any live packet of the owner counts).
  app.get("/v1/attachments/:id/original", requireAuth, async (c) => {
    const svc = c.get("service");
    const a = await svc.ownerOriginal(c.get("principal"), c.req.param("id"), c.req.query("packet_id") || undefined);
    return attachmentResponse(a, await svc.openBlob(a));
  });

  // Download by short-lived ticket (issued by handoff_read with representation "original").
  app.get("/v1/dl/:ticket", async (c) => {
    const svc = c.get("service");
    const a = await svc.redeemDownloadTicket(c.req.param("ticket"));
    return attachmentResponse(a, await svc.openBlob(a));
  });

  return app;
}
