import type { Config } from "../env";
import type { Principal } from "../auth/verify";
import type { BlobStore } from "../store/blobs";
import type { AttachmentRow, InboxRow, PacketRow, Repository, TicketKind, TicketRow } from "../store/repository";
import { AttachmentUnavailable, UniqueViolation } from "../store/repository";
import { HandoffError } from "./errors";
import { verifyType } from "./filetypes";
import { base64url, newAttachmentId, newPacketId, newTicketToken, nowIso, plusMs, sha256Hex } from "./ids";
import { handleOf, isTeam, qualify, shownRecipient, teamOf, tenantOf } from "./tenant";

export interface SendInput {
  title: string;
  brief: string;
  to?: string;
  attachment_ids: string[];
  idempotency_key: string;
  expires_in_hours?: number;
  /** References used for the idempotency hash when attachments are created during the request (host imports). */
  hash_refs?: string[];
}

export interface AttachmentDescriptor {
  attachment_id: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  sha256: string | null;
  state: AttachmentRow["state"];
}

export interface PacketSummary {
  packet_id: string;
  from: string;
  to: string;
  title: string;
  created_at: string;
  expires_at: string;
}

export interface SendResult extends PacketSummary {
  attachments: AttachmentDescriptor[];
  replayed: boolean;
}

export interface PacketView extends PacketSummary {
  brief: string;
  attachments: AttachmentDescriptor[];
}

export interface HostFile {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export const describe = (a: AttachmentRow): AttachmentDescriptor => ({
  attachment_id: a.id,
  filename: a.filename,
  mime_type: a.mime_type,
  size: a.size,
  sha256: a.sha256,
  state: a.state,
});

/** People see handles; the stored identities may carry a tenant prefix (src/domain/tenant.ts). */
const summary = (p: PacketRow): PacketSummary => ({
  packet_id: p.id,
  from: handleOf(p.owner),
  to: shownRecipient(p.recipient ?? p.owner),
  title: p.title,
  created_at: p.created_at,
  expires_at: p.expires_at,
});

/**
 * Empty means the sender; "team", "all" and "*" mean every member of the sender's tenant; any other name is a
 * member handle (lower case) in that tenant. The result is a stored identity (tenant-qualified where the owner is).
 */
export function normalizeRecipient(owner: string, to?: string): string {
  if (!to || !to.trim()) return owner;
  const raw = to.trim();
  const tenant = tenantOf(owner);
  const lower = raw.toLowerCase();
  if (raw === "*" || lower === "team" || lower === "all") return teamOf(tenant);
  const qualified = qualify(tenant, handleOf(lower) === lower ? lower : handleOf(lower));
  return qualified === owner ? owner : qualified;
}

export function encodeCursor(row: InboxRow): string {
  return base64url(new TextEncoder().encode(`${row.created_at}|${row.id}`));
}

export function decodeCursor(cursor: string): { created_at: string; id: string } {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const text = atob(padded);
    const i = text.lastIndexOf("|");
    if (i <= 0) throw new Error("bad");
    return { created_at: text.slice(0, i), id: text.slice(i + 1) };
  } catch {
    throw new HandoffError("invalid_input", "cursor is not valid");
  }
}

export class HandoffService {
  constructor(
    private readonly repo: Repository,
    private readonly blobs: BlobStore,
    readonly cfg: Config,
  ) {}

  // ---- packets -----------------------------------------------------------

  async requestHash(input: SendInput): Promise<string> {
    // Deduplicated like send() does, so [a, a] and [a] are the same request.
    const refs = [...new Set(input.hash_refs ?? input.attachment_ids)].sort();
    const to = input.to?.trim();
    const tuple = to
      ? [input.title, input.brief, refs, input.expires_in_hours ?? null, normalizeRecipient("", to)]
      : [input.title, input.brief, refs, input.expires_in_hours ?? null];
    return sha256Hex(JSON.stringify(tuple));
  }

  /**
   * Returns the already-published packet for this idempotency key, or null. Throws on a conflicting reuse,
   * and when that packet was revoked or has expired: the recipient cannot read it, so it is not a success.
   */
  async findReplay(owner: string, input: SendInput): Promise<SendResult | null> {
    const existing = await this.repo.getPacketByIdempotencyKey(owner, input.idempotency_key);
    if (!existing) return null;
    const hash = await this.requestHash(input);
    if (existing.request_hash !== hash) {
      throw new HandoffError(
        "idempotency_conflict",
        `idempotency_key "${input.idempotency_key}" was already used for a different packet (${existing.id}); choose a new key`,
      );
    }
    const again = "; to send it again, use a new idempotency_key";
    if (existing.revoked_at) {
      throw new HandoffError("revoked", `idempotency_key "${input.idempotency_key}" already sent packet ${existing.id}, which was revoked at ${existing.revoked_at}${again}`);
    }
    if (existing.expires_at <= nowIso()) {
      throw new HandoffError("expired", `idempotency_key "${input.idempotency_key}" already sent packet ${existing.id}, which expired at ${existing.expires_at}${again}`);
    }
    const atts = await this.repo.getPacketAttachments(existing.id);
    return { ...summary(existing), attachments: atts.map(describe), replayed: true };
  }

  /**
   * Sends a packet with files that the host passes as download URLs (OpenAI `files`). The request, every
   * URL and any earlier send with the same key are checked before anything is downloaded. Files imported by
   * a call that does not publish them (an error, or a concurrent identical call that won) are deleted at once.
   */
  async sendWithImports(principal: Principal, input: SendInput, files: HostFile[], host: string): Promise<SendResult> {
    if (files.length === 0) return this.send(principal, input);
    const withRefs: SendInput = { ...input, hash_refs: [...input.attachment_ids, ...files.map((f) => `file:${f.file_id}`)] };
    this.validateSend(withRefs, files.length);
    for (const f of files) this.validateImportUrl(f.download_url);
    await this.recipientFor(principal.subject, input.to);
    const replay = await this.findReplay(principal.subject, withRefs);
    if (replay) return replay;
    const imported: AttachmentRow[] = [];
    let result: SendResult | null = null;
    try {
      for (const f of files) imported.push(await this.importHostFile(principal, f, host));
      result = await this.send(principal, { ...withRefs, attachment_ids: [...input.attachment_ids, ...imported.map((a) => a.id)] });
      return result;
    } finally {
      if (!result || result.replayed) await this.discardUnattached(imported);
    }
  }

  /** Deletes files that no packet links. A file that a packet does link is left alone. Best effort: cleanup takes what remains. */
  private async discardUnattached(rows: AttachmentRow[]): Promise<void> {
    for (const a of rows) {
      try {
        if (await this.repo.claimUnattachedForDeletion(a.id, null)) await this.dropClaimed(a);
      } catch {
        // Left for the scheduled cleanup.
      }
    }
  }

  /** Deletes the bytes and the row of an attachment that this caller has claimed for deletion. */
  private async dropClaimed(a: AttachmentRow): Promise<void> {
    await this.blobs.delete(a.blob_key);
    await this.repo.deleteClaimedAttachment(a.id);
  }

  async send(principal: Principal, input: SendInput): Promise<SendResult> {
    const owner = principal.subject;
    this.validateSend(input);
    const recipient = await this.recipientFor(owner, input.to);
    const replay = await this.findReplay(owner, input);
    if (replay) return replay;

    const ids = [...new Set(input.attachment_ids)];
    const rows = await this.repo.getAttachmentsByIds(owner, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const a = byId.get(id);
      if (!a || a.claim === "delete") throw new HandoffError("not_found", `attachment ${id} not found`);
      if (a.state !== "ready") {
        throw new HandoffError("attachment_not_ready", `attachment ${id} is ${a.state}${a.fail_reason ? ` (${a.fail_reason})` : ""}; upload it fully before sending`);
      }
    }

    const now = new Date();
    const hours = input.expires_in_hours ?? this.cfg.defaultExpiryHours;
    const packet: PacketRow = {
      id: newPacketId(),
      owner,
      recipient,
      title: input.title,
      brief: input.brief,
      created_at: now.toISOString(),
      expires_at: plusMs(hours * 3_600_000, now),
      revoked_at: null,
      idempotency_key: input.idempotency_key,
      request_hash: await this.requestHash(input),
    };
    try {
      await this.repo.createPacket(packet, ids);
    } catch (e) {
      if (e instanceof UniqueViolation) {
        const again = await this.findReplay(owner, input);
        if (again) return again;
      }
      if (e instanceof AttachmentUnavailable) {
        throw new HandoffError("not_found", "an attachment stopped being available while sending (it was removed as unused); upload it again");
      }
      throw e;
    }
    return { ...summary(packet), attachments: ids.map((id) => describe(byId.get(id)!)), replayed: false };
  }

  /** `pendingFiles`: host files still to be imported, which will become attachments too. */
  private validateSend(input: SendInput, pendingFiles = 0): void {
    const { cfg } = this;
    if (!input.title.trim()) throw new HandoffError("invalid_input", "title is empty");
    if (input.title.length > cfg.maxTitleChars) throw new HandoffError("invalid_input", `title longer than ${cfg.maxTitleChars} characters`);
    if (!input.brief.trim()) throw new HandoffError("invalid_input", "brief is empty");
    if (input.brief.length > cfg.maxBriefChars) throw new HandoffError("invalid_input", `brief longer than ${cfg.maxBriefChars} characters`);
    if (input.to !== undefined) {
      const r = input.to.trim();
      if (!r || r.length > 128 || /[\u0000-\u001f\u007f]/.test(r)) {
        throw new HandoffError("invalid_input", "to must be 1..128 printable characters");
      }
    }
    if (!input.idempotency_key.trim() || input.idempotency_key.length > 128) throw new HandoffError("invalid_input", "idempotency_key must be 1..128 characters");
    if (input.attachment_ids.length + pendingFiles > cfg.maxAttachmentsPerPacket) throw new HandoffError("invalid_input", `more than ${cfg.maxAttachmentsPerPacket} attachments`);
    const h = input.expires_in_hours;
    if (h !== undefined && (!Number.isInteger(h) || h < 1 || h > cfg.maxExpiryHours)) {
      throw new HandoffError("invalid_input", `expires_in_hours must be an integer from 1 to ${cfg.maxExpiryHours}`);
    }
  }

  /**
   * The recipient a send stores: the sender, a member handle, or "*" for every member. The team is the members
   * table: only the operator adds members, so "team" never reaches a stranger.
   */
  private async recipientFor(owner: string, to?: string): Promise<string> {
    const r = normalizeRecipient(owner, to);
    if (r === owner) return owner;
    if (!isTeam(r) && !(await this.repo.isMember(r))) {
      throw new HandoffError("invalid_input", `to: "${to?.trim()}" is not a member of this server; use a member handle, or "team" for every member`);
    }
    return r;
  }

  /** The sender, the named recipient, or for a team packet every member of that tenant. */
  private canAccessPacket(subject: string, p: PacketRow): boolean {
    const recipient = p.recipient ?? p.owner;
    return p.owner === subject || recipient === subject || recipient === teamOf(tenantOf(subject));
  }

  async inbox(principal: Principal, opts: { limit?: number; cursor?: string }): Promise<{ packets: (PacketSummary & { attachment_count: number })[]; next_cursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await this.repo.listInbox(principal.subject, nowIso(), limit + 1, cursor);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      packets: page.map((r) => ({
        packet_id: r.id,
        from: handleOf(r.owner ?? principal.subject),
        to: shownRecipient(r.recipient ?? r.owner ?? principal.subject),
        title: r.title,
        created_at: r.created_at,
        expires_at: r.expires_at,
        attachment_count: r.attachment_count,
      })),
      next_cursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /** Loads a packet the principal owns or received and that is still live. Other packets read as not found. */
  async livePacket(subject: string, packetId: string): Promise<PacketRow> {
    const p = await this.repo.getPacket(packetId);
    if (!p || !this.canAccessPacket(subject, p)) throw new HandoffError("not_found", `packet ${packetId} not found`);
    if (p.revoked_at) throw new HandoffError("revoked", `packet ${packetId} was revoked at ${p.revoked_at}`);
    if (p.expires_at <= nowIso()) throw new HandoffError("expired", `packet ${packetId} expired at ${p.expires_at}`);
    return p;
  }

  async read(principal: Principal, packetId: string): Promise<PacketView> {
    const p = await this.livePacket(principal.subject, packetId);
    const atts = await this.repo.getPacketAttachments(p.id);
    return { ...summary(p), brief: p.brief, attachments: atts.map(describe) };
  }

  /** The attachment must belong to this live packet; owning it through another packet is not enough. */
  async readAttachment(principal: Principal, packetId: string, attachmentId: string): Promise<{ packet: PacketRow; attachment: AttachmentRow }> {
    const packet = await this.livePacket(principal.subject, packetId);
    const attachment = await this.repo.getPacketAttachment(packet.id, attachmentId);
    if (!attachment || attachment.owner !== packet.owner) {
      throw new HandoffError("not_found", `attachment ${attachmentId} is not part of packet ${packetId}`);
    }
    if (attachment.state !== "ready") throw new HandoffError("attachment_not_ready", `attachment ${attachmentId} is ${attachment.state}`);
    return { packet, attachment };
  }

  async revoke(principal: Principal, packetId: string): Promise<{ packet_id: string; revoked_at: string }> {
    const p = await this.repo.getPacket(packetId);
    if (!p || !this.canAccessPacket(principal.subject, p)) throw new HandoffError("not_found", `packet ${packetId} not found`);
    if (p.owner !== principal.subject && isTeam(p.recipient)) {
      throw new HandoffError("invalid_input", `packet ${packetId} went to the whole team; only its sender can revoke it`);
    }
    if (p.revoked_at) return { packet_id: p.id, revoked_at: p.revoked_at };
    const at = nowIso();
    await this.repo.revokePacket(p.id, at);
    return { packet_id: p.id, revoked_at: at };
  }

  // ---- attachments -------------------------------------------------------

  private cleanFilename(name: string | undefined, fallback: string): string {
    const base = (name ?? "").split(/[\\/]/).pop()?.trim() ?? "";
    const safe = base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
    return safe && safe !== "." && safe !== ".." ? safe : fallback;
  }

  async createUpload(principal: Principal, input: { filename: string; mime_type?: string }, source: AttachmentRow["source"] = "upload", provenance: Record<string, unknown> | null = null): Promise<AttachmentRow> {
    // Bounds the storage one account can hold outside packets. Not atomic: concurrent calls may pass it by a few.
    const unsent = await this.repo.countUnsentAttachments(principal.subject);
    if (unsent >= this.cfg.maxUnsentFilesPerOwner) {
      throw new HandoffError(
        "quota_exceeded",
        `${unsent} of your files are not in a packet yet (limit ${this.cfg.maxUnsentFilesPerOwner}); send them, or wait: unfinished uploads are removed after 24 hours and unsent files after 7 days`,
      );
    }
    const id = newAttachmentId();
    const row: AttachmentRow = {
      id,
      owner: principal.subject,
      filename: this.cleanFilename(input.filename, id),
      mime_type: null,
      size: null,
      sha256: null,
      state: "staging",
      blob_key: `att/${principal.subject}/${id}`,
      source,
      provenance: provenance ? JSON.stringify(provenance) : null,
      fail_reason: null,
      created_at: nowIso(),
      ready_at: null,
      claim: null,
    };
    await this.repo.createAttachment(row);
    return row;
  }

  /**
   * Verifies and stores the bytes of a staging attachment, then marks it ready. One writer per slot: the
   * writer first claims the slot in the database, so a second request for the same slot is refused before
   * it can write. A ready attachment never accepts bytes again, so a published file cannot change.
   */
  async receiveBytes(attachment: AttachmentRow, bytes: Uint8Array, declared: { mime_type?: string | null; sha256?: string | null }): Promise<AttachmentRow> {
    if (attachment.state !== "staging") throw new HandoffError("upload_conflict", `attachment ${attachment.id} is ${attachment.state}; it does not accept bytes`);
    if (bytes.byteLength === 0) throw new HandoffError("invalid_input", "empty body");
    const claim = `upload:${newTicketToken()}`;
    if (!(await this.repo.claimUpload(attachment.id, claim))) {
      throw new HandoffError("upload_conflict", `attachment ${attachment.id} already has its bytes or another upload is in progress`);
    }
    const fail = async (reason: string, err: HandoffError): Promise<never> => {
      await this.repo.failUpload(attachment.id, claim, reason);
      throw err;
    };
    if (bytes.byteLength > this.cfg.maxAttachmentBytes) {
      await fail("too large", new HandoffError("too_large", `attachment larger than ${this.cfg.maxAttachmentBytes} bytes`));
    }
    let mime: string;
    try {
      mime = verifyType(bytes, declared.mime_type, attachment.filename);
    } catch (e) {
      if (e instanceof HandoffError) return fail(e.message, e);
      await this.repo.releaseUpload(attachment.id, claim);
      throw e;
    }
    const digest = await sha256Hex(bytes);
    if (declared.sha256 && declared.sha256.toLowerCase() !== digest) {
      await fail("checksum mismatch", new HandoffError("invalid_input", `sha256 mismatch: declared ${declared.sha256}, stored ${digest}`));
    }
    try {
      await this.blobs.put(attachment.blob_key, bytes, { contentType: mime, sha256: digest });
    } catch (e) {
      await this.repo.releaseUpload(attachment.id, claim);
      throw e;
    }
    const ready_at = nowIso();
    if (!(await this.repo.completeUpload(attachment.id, claim, { mime_type: mime, size: bytes.byteLength, sha256: digest, ready_at }))) {
      // Only cleanup can take a claimed slot away (after the staging lifetime). Remove what this writer stored.
      await this.blobs.delete(attachment.blob_key).catch(() => undefined);
      throw new HandoffError("upload_conflict", `attachment ${attachment.id} was removed while its bytes were arriving`);
    }
    return { ...attachment, state: "ready", mime_type: mime, size: bytes.byteLength, sha256: digest, ready_at, claim: null };
  }

  /** The upload slot that a single-use upload ticket opens. Uses up the ticket. */
  async redeemUploadTicket(token: string, attachmentId: string): Promise<AttachmentRow> {
    const t = await this.consumeUploadTicket(token, attachmentId);
    const a = await this.repo.getAttachment(t.attachment_id);
    if (!a || a.owner !== t.owner) throw new HandoffError("not_found", `attachment ${attachmentId} not found`);
    return a;
  }

  async getOwnedAttachment(principal: Principal, id: string): Promise<AttachmentRow> {
    const a = await this.repo.getAttachment(id);
    if (!a || a.owner !== principal.subject) throw new HandoffError("not_found", `attachment ${id} not found`);
    return a;
  }

  /**
   * Owner download of the original. Files are readable only through a live packet: with packetId, that packet;
   * without it, any live packet of the owner that contains the file. Unsent, revoked or expired: unavailable.
   */
  async ownerOriginal(principal: Principal, attachmentId: string, packetId?: string): Promise<AttachmentRow> {
    if (packetId) return (await this.readAttachment(principal, packetId, attachmentId)).attachment;
    const live = await this.repo.findLivePacketWithAttachment(principal.subject, attachmentId, nowIso());
    if (!live) {
      await this.getOwnedAttachment(principal, attachmentId);
      throw new HandoffError("unavailable", `attachment ${attachmentId} is not part of a live packet; files are readable only through a live packet`);
    }
    return (await this.readAttachment(principal, live, attachmentId)).attachment;
  }

  async openBlob(attachment: AttachmentRow): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
    const blob = await this.blobs.get(attachment.blob_key);
    if (!blob) throw new HandoffError("not_found", `stored bytes for ${attachment.id} are missing`);
    return blob;
  }

  async readBlobBytes(attachment: AttachmentRow): Promise<Uint8Array> {
    const blob = await this.openBlob(attachment);
    return new Uint8Array(await new Response(blob.body).arrayBuffer());
  }

  // ---- server-side import of a host file reference (OpenAI `files`) --------

  validateImportUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new HandoffError("import_rejected", "download_url is not a valid URL");
    }
    if (url.protocol !== "https:") throw new HandoffError("import_rejected", "download_url must use https");
    if (url.username || url.password) throw new HandoffError("import_rejected", "download_url must not carry credentials");
    const host = url.hostname.toLowerCase();
    const ipLike = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
    if (ipLike || host === "localhost" || /\.(local|internal|localhost)$/.test(host) || !host.includes(".")) {
      throw new HandoffError("import_rejected", "download_url host must be a public DNS name");
    }
    // Imports are off until IMPORT_HOST_ALLOWLIST names the hosts. The message names the host, so the first
    // real-host test shows which one to allow.
    const allow = this.cfg.importHostAllowlist;
    if (!allow.some((a) => host === a || (a.startsWith("*.") && host.endsWith(a.slice(1))))) {
      throw new HandoffError(
        "import_rejected",
        allow.length
          ? `download_url host ${host} is not in IMPORT_HOST_ALLOWLIST`
          : `file import is off on this server (IMPORT_HOST_ALLOWLIST is empty); download_url host ${host} was not contacted`,
      );
    }
    return url;
  }

  async importHostFile(principal: Principal, file: HostFile, host: string): Promise<AttachmentRow> {
    const url = this.validateImportUrl(file.download_url);
    const row = await this.createUpload(
      principal,
      { filename: file.file_name ?? file.file_id, mime_type: file.mime_type },
      "import",
      { host, file_id: file.file_id, file_name: file.file_name ?? null, mime_type: file.mime_type ?? null, download_host: url.hostname },
    );
    let res: Response;
    try {
      res = await fetch(url.toString(), { redirect: "manual", headers: { accept: "*/*" } });
    } catch (e) {
      await this.repo.markAttachmentFailed(row.id, "download failed");
      throw new HandoffError("import_rejected", `download of ${file.file_id} failed: ${(e as Error).name}`);
    }
    if (res.status >= 300 && res.status < 400) {
      await this.repo.markAttachmentFailed(row.id, "redirect");
      throw new HandoffError("import_rejected", `download of ${file.file_id} redirected; redirects are not followed`);
    }
    if (!res.ok) {
      await this.repo.markAttachmentFailed(row.id, `http ${res.status}`);
      throw new HandoffError("import_rejected", `download of ${file.file_id} returned HTTP ${res.status}`);
    }
    const declaredLen = Number(res.headers.get("content-length") ?? "0");
    if (declaredLen > this.cfg.maxAttachmentBytes) {
      await this.repo.markAttachmentFailed(row.id, "too large");
      throw new HandoffError("too_large", `file ${file.file_id} larger than ${this.cfg.maxAttachmentBytes} bytes`);
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readBounded(res.body, this.cfg.maxAttachmentBytes);
    } catch (e) {
      await this.repo.markAttachmentFailed(row.id, "download failed");
      throw new HandoffError("import_rejected", `download of ${file.file_id} failed while reading: ${(e as Error).name}`);
    }
    if (!bytes) {
      await this.repo.markAttachmentFailed(row.id, "too large");
      throw new HandoffError("too_large", `file ${file.file_id} larger than ${this.cfg.maxAttachmentBytes} bytes`);
    }
    const declaredType = file.mime_type ?? res.headers.get("content-type");
    return this.receiveBytes(row, bytes, { mime_type: declaredType });
  }

  // ---- tickets -------------------------------------------------------------

  async issueTicket(kind: TicketKind, owner: string, attachmentId: string, packetId: string | null): Promise<{ token: string; expires_at: string }> {
    const token = newTicketToken();
    const ttl = kind === "upload" ? this.cfg.uploadTicketTtlMs : this.cfg.downloadTicketTtlMs;
    const row: TicketRow = {
      id: await sha256Hex(token),
      kind,
      owner,
      attachment_id: attachmentId,
      packet_id: packetId,
      created_at: nowIso(),
      expires_at: plusMs(ttl),
      used_at: null,
    };
    await this.repo.createTicket(row);
    return { token, expires_at: row.expires_at };
  }

  async lookupTicket(kind: TicketKind, token: string): Promise<TicketRow> {
    const t = await this.repo.getTicket(await sha256Hex(token));
    if (!t || t.kind !== kind) throw new HandoffError("ticket_invalid", "ticket not found");
    if (t.expires_at <= nowIso()) throw new HandoffError("ticket_invalid", "ticket expired");
    return t;
  }

  /** Single use: the first caller wins. */
  async consumeUploadTicket(token: string, attachmentId: string): Promise<TicketRow> {
    const t = await this.lookupTicket("upload", token);
    if (t.attachment_id !== attachmentId) throw new HandoffError("ticket_invalid", "ticket is for another attachment");
    if (!(await this.repo.useTicket(t.id, nowIso()))) throw new HandoffError("ticket_invalid", "ticket already used");
    return t;
  }

  /** A download ticket stays valid for its window, but the packet must still be live at fetch time. */
  async redeemDownloadTicket(token: string): Promise<AttachmentRow> {
    const t = await this.lookupTicket("download", token);
    if (!t.packet_id) throw new HandoffError("ticket_invalid", "ticket has no packet");
    const owner = { subject: t.owner, scopes: [], clientId: "ticket", token: "" };
    const { attachment } = await this.readAttachment(owner, t.packet_id, t.attachment_id);
    return attachment;
  }

  // ---- cleanup -----------------------------------------------------------

  /**
   * Deletes stale uploads, old unattached files and long-dead packets. A candidate list only proposes rows:
   * each file is deleted only after an atomic claim that a send cannot pass (see Repository.createPacket),
   * so a file is either linked by a packet or deleted, never both.
   */
  async cleanup(now: Date = new Date()): Promise<{ attachments_deleted: number; packets_deleted: number; backlog: boolean }> {
    const { cleanupBatch, cleanupRounds } = this.cfg;
    const iso = (ms: number) => new Date(now.getTime() - ms).toISOString();
    let attachments_deleted = 0;
    let packets_deleted = 0;
    let backlog = false;
    const drop = async (a: AttachmentRow): Promise<true> => {
      await this.dropClaimed(a);
      attachments_deleted++;
      return true;
    };
    // Works through one kind of row a batch at a time. Stops on a short batch, on a batch where nothing could
    // be removed (rows another actor holds), or after `cleanupRounds` batches; then the next run continues.
    const drain = async <T>(list: () => Promise<T[]>, handle: (row: T) => Promise<boolean>) => {
      for (let round = 1; ; round++) {
        const rows = await list();
        let removed = 0;
        for (const r of rows) if (await handle(r)) removed++;
        if (rows.length < cleanupBatch || removed === 0) return;
        if (round >= cleanupRounds) {
          backlog = true;
          return;
        }
      }
    };
    // Finish deletions that an earlier run claimed but did not complete.
    await drain(() => this.repo.listClaimedForDeletion(cleanupBatch), drop);
    const staleBefore = iso(this.cfg.stagingTtlMs);
    for (const state of ["staging", "failed"] as const) {
      await drain(
        () => this.repo.listAttachmentsInStateBefore(state, staleBefore, cleanupBatch),
        async (a) => (await this.repo.claimStaleForDeletion(a.id, staleBefore)) && drop(a),
      );
    }
    const unattachedBefore = iso(this.cfg.unattachedReadyTtlMs);
    await drain(
      () => this.repo.listUnattachedReadyBefore(unattachedBefore, cleanupBatch),
      async (a) => (await this.repo.claimUnattachedForDeletion(a.id, unattachedBefore)) && drop(a),
    );
    await drain(
      () => this.repo.listDeadPacketsBefore(iso(this.cfg.expiredPacketGraceMs), cleanupBatch),
      async (p) => {
        const atts = await this.repo.getPacketAttachments(p.id);
        await this.repo.deletePacket(p.id);
        packets_deleted++;
        for (const a of atts) if (await this.repo.claimUnattachedForDeletion(a.id, null)) await drop(a);
        return true;
      },
    );
    await this.repo.deleteExpiredTickets(now.toISOString());
    return { attachments_deleted, packets_deleted, backlog };
  }
}

/** Reads a stream up to `max` bytes. Returns null when the stream exceeds it. */
export async function readBounded(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
