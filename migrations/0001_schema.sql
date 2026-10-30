-- Handoff schema. A fresh install applies this one file; later changes come as numbered files after it.
-- Written from the schema that migrations 0001 to 0008 produced (2026-10-30).

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
, recipient TEXT);

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
, claim TEXT);

CREATE TABLE packet_attachments (
  packet_id     TEXT NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  position      INTEGER NOT NULL,
  PRIMARY KEY (packet_id, attachment_id)
);

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

CREATE TABLE oauth_keys (
  kid         TEXT PRIMARY KEY,
  private_jwk TEXT NOT NULL,
  public_jwk  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE members (
  handle      TEXT PRIMARY KEY,
  code_salt   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE oauth_clients (
  client_id     TEXT PRIMARY KEY,
  redirect_uris TEXT NOT NULL,
  client_name   TEXT,
  created_at    TEXT NOT NULL
, last_used_at TEXT, fetched_at TEXT);

CREATE TABLE oauth_codes (
  code_hash       TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  subject         TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  scope           TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  used_at         TEXT
);

CREATE TABLE oauth_refresh_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  scope       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE admin_members (
  handle TEXT PRIMARY KEY REFERENCES members(handle) ON DELETE CASCADE
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  handle TEXT NOT NULL REFERENCES members(handle) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE admin_login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- tool | initialize | auth | sign_in | token | console | cleanup
  name       TEXT,            -- tool name, grant type, client name announced at initialize, ...
  subject    TEXT,            -- member handle, when known
  client_id  TEXT,            -- OAuth client, when known
  outcome    TEXT NOT NULL,   -- ok, or an error code
  ms         INTEGER,
  detail     TEXT             -- small JSON (cleanup counts, client version)
);

CREATE TABLE access_revocations (
  subject    TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY (subject, client_id)
);

CREATE TABLE instance (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE instances_seen (
  id         TEXT PRIMARY KEY,
  version    TEXT NOT NULL,
  members    TEXT NOT NULL,   -- bucket: 0, 1, 2-5, 6+
  packets    TEXT NOT NULL,   -- bucket of packets created in the last 30 days: 0, 1-9, 10-49, 50+
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  checks     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tenants (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  members_cap INTEGER NOT NULL DEFAULT 10
);

CREATE UNIQUE INDEX packets_owner_idem ON packets(owner, idempotency_key);

CREATE INDEX packets_inbox ON packets(owner, expires_at, created_at DESC, id DESC);

CREATE INDEX attachments_owner ON attachments(owner, state);

CREATE INDEX attachments_state_created ON attachments(state, created_at);

CREATE INDEX packet_attachments_attachment ON packet_attachments(attachment_id);

CREATE INDEX tickets_expires ON tickets(expires_at);

CREATE INDEX packets_recipient_inbox ON packets(recipient, expires_at, created_at DESC, id DESC);

CREATE INDEX oauth_codes_expires ON oauth_codes(expires_at);

CREATE INDEX oauth_refresh_tokens_expires ON oauth_refresh_tokens(expires_at);

CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);

CREATE INDEX events_ts ON events(ts);

CREATE INDEX events_kind_ts ON events(kind, ts);

CREATE INDEX events_subject_ts ON events(subject, ts);

CREATE INDEX instances_seen_last ON instances_seen(last_seen);
