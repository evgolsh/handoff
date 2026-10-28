-- Console access is granted by the deployment operator, never by public registration.
CREATE TABLE admin_members (
  handle TEXT PRIMARY KEY REFERENCES members(handle) ON DELETE CASCADE
);

-- Only hashes of browser session tokens are stored. Binding to the member's code hash
-- invalidates sessions after an access-code reset, including one done by the CLI.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  handle TEXT NOT NULL REFERENCES members(handle) ON DELETE CASCADE,
  credential_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE admin_login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
