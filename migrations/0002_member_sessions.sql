-- Sessions of Assets (/assets). Any member signs in there with their username and access code.
-- Kept apart from admin_sessions, so a member's session never opens the console.
CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  handle TEXT NOT NULL REFERENCES members(handle) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires_at);
