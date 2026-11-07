-- Invitation links (handoff_invite, src/domain/invites.ts). A link names a member who already exists; opening
-- it and pressing the button sets that member's access code and shows it once. Only a hash of the link's
-- token is kept, and no access code is ever stored in plain text.
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  handle     TEXT NOT NULL REFERENCES members(handle) ON DELETE CASCADE,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE INDEX IF NOT EXISTS invites_handle ON invites(handle);
