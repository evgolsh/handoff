-- Handoff v1 schema. Times are ISO-8601 UTC strings. Sizes are bytes.

CREATE TABLE packets (
  id              TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,            -- subject of the validated token; also the v1 recipient
  title           TEXT NOT NULL,
  brief           TEXT NOT NULL,            -- stored verbatim, never normalised
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL             -- sha256 of the canonical request; same key + other hash = conflict
);
CREATE UNIQUE INDEX packets_owner_idem ON packets(owner, idempotency_key);
CREATE INDEX packets_inbox ON packets(owner, expires_at, created_at DESC, id DESC);

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT,                         -- verified from the bytes, set when ready
  size        INTEGER,
  sha256      TEXT,
  state       TEXT NOT NULL CHECK (state IN ('staging', 'ready', 'failed')),
  blob_key    TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('upload', 'import')),
  provenance  TEXT,                         -- JSON: host file id, host name; never a signed URL
  fail_reason TEXT,
  created_at  TEXT NOT NULL,
  ready_at    TEXT
);
CREATE INDEX attachments_owner ON attachments(owner, state);
CREATE INDEX attachments_state_created ON attachments(state, created_at);

CREATE TABLE packet_attachments (
  packet_id     TEXT NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  position      INTEGER NOT NULL,
  PRIMARY KEY (packet_id, attachment_id)
);
CREATE INDEX packet_attachments_attachment ON packet_attachments(attachment_id);

-- Short-lived bearer capabilities. id = sha256(token). Upload tickets are single use.
CREATE TABLE tickets (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('upload', 'download')),
  owner         TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  packet_id     TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  used_at       TEXT
);
CREATE INDEX tickets_expires ON tickets(expires_at);
