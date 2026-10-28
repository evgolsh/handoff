import type { AttachmentRow, AttachmentState, InboxRow, PacketRow, Repository, TicketRow } from "./repository";
import { AttachmentUnavailable, UniqueViolation } from "./repository";
import { teamOf, tenantOf } from "../domain/tenant";

export class D1Repository implements Repository {
  constructor(private readonly db: D1Database) {}

  async getPacketByIdempotencyKey(owner: string, key: string): Promise<PacketRow | null> {
    return (
      (await this.db
        .prepare("SELECT * FROM packets WHERE owner = ? AND idempotency_key = ?")
        .bind(owner, key)
        .first<PacketRow>()) ?? null
    );
  }

  async createPacket(p: PacketRow, attachmentIds: string[]): Promise<void> {
    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO packets (id, owner, recipient, title, brief, created_at, expires_at, revoked_at, idempotency_key, request_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(p.id, p.owner, p.recipient ?? p.owner, p.title, p.brief, p.created_at, p.expires_at, p.idempotency_key, p.request_hash),
    ];
    attachmentIds.forEach((aid, i) => {
      // The subquery is NULL unless the attachment is owned, ready and free at this moment. A NULL
      // attachment_id violates NOT NULL, which aborts the whole batch, so the packet is not written either.
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO packet_attachments (packet_id, attachment_id, position)
             VALUES (?, (SELECT id FROM attachments WHERE id = ? AND owner = ? AND state = 'ready' AND claim IS NULL), ?)`,
          )
          .bind(p.id, aid, p.owner, i),
      );
    });
    try {
      await this.db.batch(stmts);
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg.includes("UNIQUE")) throw new UniqueViolation();
      if (msg.includes("NOT NULL") && msg.includes("attachment_id")) throw new AttachmentUnavailable();
      throw e;
    }
  }

  async getPacket(id: string): Promise<PacketRow | null> {
    return (await this.db.prepare("SELECT * FROM packets WHERE id = ?").bind(id).first<PacketRow>()) ?? null;
  }

  async listInbox(
    owner: string,
    nowIso: string,
    limit: number,
    cursor: { created_at: string; id: string } | null,
  ): Promise<InboxRow[]> {
    const base = `SELECT p.id, p.owner, p.recipient, p.title, p.created_at, p.expires_at,
        (SELECT COUNT(*) FROM packet_attachments pa WHERE pa.packet_id = p.id) AS attachment_count
      FROM packets p
      WHERE (p.owner = ? OR p.recipient = ? OR p.recipient = ?) AND p.expires_at > ? AND p.revoked_at IS NULL`;
    const team = teamOf(tenantOf(owner));
    const stmt = cursor
      ? this.db
          .prepare(`${base} AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?)) ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
          .bind(owner, owner, team, nowIso, cursor.created_at, cursor.created_at, cursor.id, limit)
      : this.db.prepare(`${base} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`).bind(owner, owner, team, nowIso, limit);
    const { results } = await stmt.all<InboxRow>();
    return results;
  }

  async revokePacket(id: string, atIso: string): Promise<void> {
    await this.db.prepare("UPDATE packets SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(atIso, id).run();
  }

  async getPacketAttachments(packetId: string): Promise<AttachmentRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT a.* FROM attachments a JOIN packet_attachments pa ON pa.attachment_id = a.id
         WHERE pa.packet_id = ? ORDER BY pa.position ASC`,
      )
      .bind(packetId)
      .all<AttachmentRow>();
    return results;
  }

  async getPacketAttachment(packetId: string, attachmentId: string): Promise<AttachmentRow | null> {
    return (
      (await this.db
        .prepare(
          `SELECT a.* FROM attachments a JOIN packet_attachments pa ON pa.attachment_id = a.id
           WHERE pa.packet_id = ? AND pa.attachment_id = ?`,
        )
        .bind(packetId, attachmentId)
        .first<AttachmentRow>()) ?? null
    );
  }

  async findLivePacketWithAttachment(owner: string, attachmentId: string, nowIso: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        `SELECT p.id FROM packets p JOIN packet_attachments pa ON pa.packet_id = p.id
         WHERE pa.attachment_id = ? AND (p.owner = ? OR p.recipient = ? OR p.recipient = ?) AND p.revoked_at IS NULL AND p.expires_at > ?
         LIMIT 1`,
      )
      .bind(attachmentId, owner, owner, teamOf(tenantOf(owner)), nowIso)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  async isMember(handle: string): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS ok FROM members WHERE handle = ?").bind(handle).first<{ ok: number }>()) !== null;
  }

  async createAttachment(a: AttachmentRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO attachments (id, owner, filename, mime_type, size, sha256, state, blob_key, source, provenance, fail_reason, created_at, ready_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        a.id, a.owner, a.filename, a.mime_type, a.size, a.sha256, a.state, a.blob_key,
        a.source, a.provenance, a.fail_reason, a.created_at, a.ready_at,
      )
      .run();
  }

  async getAttachment(id: string): Promise<AttachmentRow | null> {
    return (await this.db.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<AttachmentRow>()) ?? null;
  }

  async getAttachmentsByIds(owner: string, ids: string[]): Promise<AttachmentRow[]> {
    if (ids.length === 0) return [];
    const marks = ids.map(() => "?").join(",");
    const { results } = await this.db
      .prepare(`SELECT * FROM attachments WHERE owner = ? AND id IN (${marks})`)
      .bind(owner, ...ids)
      .all<AttachmentRow>();
    return results;
  }

  async countUnsentAttachments(owner: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM attachments a
         WHERE a.owner = ? AND a.state IN ('staging', 'ready') AND (a.claim IS NULL OR a.claim <> 'delete')
           AND NOT EXISTS (SELECT 1 FROM packet_attachments pa WHERE pa.attachment_id = a.id)`,
      )
      .bind(owner)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async claimUpload(id: string, claim: string): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE attachments SET claim = ? WHERE id = ? AND state = 'staging' AND claim IS NULL")
      .bind(claim, id)
      .run();
    return (r.meta.changes ?? 0) === 1;
  }

  async completeUpload(id: string, claim: string, p: { mime_type: string; size: number; sha256: string; ready_at: string }): Promise<boolean> {
    const r = await this.db
      .prepare(
        `UPDATE attachments SET state = 'ready', mime_type = ?, size = ?, sha256 = ?, ready_at = ?, fail_reason = NULL, claim = NULL
         WHERE id = ? AND state = 'staging' AND claim = ?`,
      )
      .bind(p.mime_type, p.size, p.sha256, p.ready_at, id, claim)
      .run();
    return (r.meta.changes ?? 0) === 1;
  }

  async failUpload(id: string, claim: string, reason: string): Promise<void> {
    await this.db
      .prepare("UPDATE attachments SET state = 'failed', fail_reason = ?, claim = NULL WHERE id = ? AND state = 'staging' AND claim = ?")
      .bind(reason, id, claim)
      .run();
  }

  async releaseUpload(id: string, claim: string): Promise<void> {
    await this.db.prepare("UPDATE attachments SET claim = NULL WHERE id = ? AND state = 'staging' AND claim = ?").bind(id, claim).run();
  }

  async markAttachmentFailed(id: string, reason: string): Promise<void> {
    await this.db
      .prepare("UPDATE attachments SET state = 'failed', fail_reason = ? WHERE id = ? AND state = 'staging' AND claim IS NULL")
      .bind(reason, id)
      .run();
  }

  async createTicket(t: TicketRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO tickets (id, kind, owner, attachment_id, packet_id, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(t.id, t.kind, t.owner, t.attachment_id, t.packet_id, t.created_at, t.expires_at)
      .run();
  }

  async getTicket(id: string): Promise<TicketRow | null> {
    return (await this.db.prepare("SELECT * FROM tickets WHERE id = ?").bind(id).first<TicketRow>()) ?? null;
  }

  async useTicket(id: string, atIso: string): Promise<boolean> {
    const r = await this.db.prepare("UPDATE tickets SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(atIso, id).run();
    return (r.meta.changes ?? 0) > 0;
  }

  async listAttachmentsInStateBefore(state: AttachmentState, beforeIso: string, limit: number): Promise<AttachmentRow[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM attachments WHERE state = ? AND created_at < ? LIMIT ?")
      .bind(state, beforeIso, limit)
      .all<AttachmentRow>();
    return results;
  }

  async listUnattachedReadyBefore(beforeIso: string, limit: number): Promise<AttachmentRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT a.* FROM attachments a
         WHERE a.state = 'ready' AND a.claim IS NULL AND a.created_at < ?
           AND NOT EXISTS (SELECT 1 FROM packet_attachments pa WHERE pa.attachment_id = a.id)
         LIMIT ?`,
      )
      .bind(beforeIso, limit)
      .all<AttachmentRow>();
    return results;
  }

  async listClaimedForDeletion(limit: number): Promise<AttachmentRow[]> {
    const { results } = await this.db.prepare("SELECT * FROM attachments WHERE claim = 'delete' LIMIT ?").bind(limit).all<AttachmentRow>();
    return results;
  }

  async claimStaleForDeletion(id: string, beforeIso: string): Promise<boolean> {
    const r = await this.db
      .prepare(
        `UPDATE attachments SET claim = 'delete'
         WHERE id = ? AND state IN ('staging', 'failed') AND created_at < ? AND (claim IS NULL OR claim <> 'delete')`,
      )
      .bind(id, beforeIso)
      .run();
    return (r.meta.changes ?? 0) === 1;
  }

  async claimUnattachedForDeletion(id: string, beforeIso: string | null): Promise<boolean> {
    const r = await this.db
      .prepare(
        `UPDATE attachments SET claim = 'delete'
         WHERE id = ?1 AND state = 'ready' AND claim IS NULL AND (?2 IS NULL OR created_at < ?2)
           AND NOT EXISTS (SELECT 1 FROM packet_attachments pa WHERE pa.attachment_id = attachments.id)`,
      )
      .bind(id, beforeIso)
      .run();
    return (r.meta.changes ?? 0) === 1;
  }

  async deleteClaimedAttachment(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM tickets WHERE attachment_id = ?").bind(id),
      this.db.prepare("DELETE FROM attachments WHERE id = ? AND claim = 'delete'").bind(id),
    ]);
  }

  async listDeadPacketsBefore(beforeIso: string, limit: number): Promise<PacketRow[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM packets WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?) LIMIT ?")
      .bind(beforeIso, beforeIso, limit)
      .all<PacketRow>();
    return results;
  }

  async deletePacket(id: string): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM tickets WHERE packet_id = ?").bind(id),
      this.db.prepare("DELETE FROM packet_attachments WHERE packet_id = ?").bind(id),
      this.db.prepare("DELETE FROM packets WHERE id = ?").bind(id),
    ]);
  }

  async deleteExpiredTickets(beforeIso: string): Promise<void> {
    await this.db.prepare("DELETE FROM tickets WHERE expires_at < ?").bind(beforeIso).run();
  }
}
