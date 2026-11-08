-- Browser sessions: one per signed-in member, started at /login (see 0004). The console also checks admin_members.
CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  handle TEXT NOT NULL REFERENCES members(handle) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires_at);
