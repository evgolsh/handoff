export type AttachmentState = "staging" | "ready" | "failed";
export type AttachmentSource = "upload" | "import";
export type TicketKind = "upload" | "download";

export interface PacketRow {
  id: string;
  owner: string;
  recipient?: string | null;
  title: string;
  brief: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  idempotency_key: string;
  request_hash: string;
}

export interface InboxRow {
  id: string;
  owner?: string;
  recipient?: string | null;
  title: string;
  created_at: string;
  expires_at: string;
  attachment_count: number;
}

export interface AttachmentRow {
  id: string;
  owner: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  sha256: string | null;
  state: AttachmentState;
  blob_key: string;
  source: AttachmentSource;
  provenance: string | null;
  fail_reason: string | null;
  created_at: string;
  ready_at: string | null;
  /** See migrations/0002: NULL, 'upload:<nonce>' or 'delete'. */
  claim: string | null;
}

export interface TicketRow {
  id: string;
  kind: TicketKind;
  owner: string;
  attachment_id: string;
  packet_id: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export class UniqueViolation extends Error {
  constructor() {
    super("unique constraint violated");
    this.name = "UniqueViolation";
  }
}

/** createPacket could not link an attachment: it is no longer ready and free (for example, cleanup claimed it). */
export class AttachmentUnavailable extends Error {
  constructor() {
    super("attachment is no longer available");
    this.name = "AttachmentUnavailable";
  }
}

/** Narrow persistence contract. D1 implements it today; a Postgres profile would implement it too. */
export interface Repository {
  getPacketByIdempotencyKey(owner: string, key: string): Promise<PacketRow | null>;
  /**
   * Inserts the packet and its attachment links in one transaction. Each link requires the attachment to be
   * owned, ready and unclaimed at that moment. Throws UniqueViolation on (owner, idempotency_key) and
   * AttachmentUnavailable when a link fails; in both cases nothing is written.
   */
  createPacket(packet: PacketRow, attachmentIds: string[]): Promise<void>;
  getPacket(id: string): Promise<PacketRow | null>;
  /** Live packets this subject sent, or that were sent to them or to "*" (the team). */
  listInbox(owner: string, nowIso: string, limit: number, cursor: { created_at: string; id: string } | null): Promise<InboxRow[]>;
  revokePacket(id: string, atIso: string): Promise<void>;
  getPacketAttachments(packetId: string): Promise<AttachmentRow[]>;
  getPacketAttachment(packetId: string, attachmentId: string): Promise<AttachmentRow | null>;
  /** A live packet this subject sent or received (directly or as the team) that contains the attachment, or null. */
  findLivePacketWithAttachment(owner: string, attachmentId: string, nowIso: string): Promise<string | null>;
  /** True when this handle is in the built-in sign-in's member list. */
  isMember(handle: string): Promise<boolean>;

  createAttachment(row: AttachmentRow): Promise<void>;
  getAttachment(id: string): Promise<AttachmentRow | null>;
  getAttachmentsByIds(owner: string, ids: string[]): Promise<AttachmentRow[]>;
  /** Attachments of this owner that are staging or ready, not being deleted, and linked by no packet. */
  countUnsentAttachments(owner: string): Promise<number>;
  /** Atomically takes a free staging slot for one writer. False when it is not staging or another actor holds it. */
  claimUpload(id: string, claim: string): Promise<boolean>;
  /** Marks the slot ready and frees the claim, only while this writer still holds it. */
  completeUpload(id: string, claim: string, patch: { mime_type: string; size: number; sha256: string; ready_at: string }): Promise<boolean>;
  /** Marks the slot failed, only while this writer still holds it. */
  failUpload(id: string, claim: string, reason: string): Promise<void>;
  /** Gives the slot back after an unexpected error, so the owner can retry. */
  releaseUpload(id: string, claim: string): Promise<void>;
  /** Marks a free staging slot failed (an import that never reached the bytes). */
  markAttachmentFailed(id: string, reason: string): Promise<void>;

  createTicket(row: TicketRow): Promise<void>;
  getTicket(id: string): Promise<TicketRow | null>;
  /** Marks a ticket used. Returns false when it was already used (atomic compare-and-set). */
  useTicket(id: string, atIso: string): Promise<boolean>;

  // Cleanup. Listing only proposes candidates; a claim decides, in one statement, whether cleanup may delete.
  listAttachmentsInStateBefore(state: AttachmentState, beforeIso: string, limit: number): Promise<AttachmentRow[]>;
  listUnattachedReadyBefore(beforeIso: string, limit: number): Promise<AttachmentRow[]>;
  listClaimedForDeletion(limit: number): Promise<AttachmentRow[]>;
  /** Claims an old staging or failed attachment for deletion. */
  claimStaleForDeletion(id: string, beforeIso: string): Promise<boolean>;
  /** Claims a ready, free attachment that no packet links (and, with beforeIso, created before it). */
  claimUnattachedForDeletion(id: string, beforeIso: string | null): Promise<boolean>;
  /** Deletes an attachment row that cleanup has claimed, with its tickets. Never deletes packet links. */
  deleteClaimedAttachment(id: string): Promise<void>;
  listDeadPacketsBefore(beforeIso: string, limit: number): Promise<PacketRow[]>;
  deletePacket(id: string): Promise<void>;
  deleteExpiredTickets(beforeIso: string): Promise<void>;
}
