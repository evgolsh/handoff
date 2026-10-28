-- Console data: what happened (tool calls, sign-ins, rejected tokens, cleanup runs), and revoked access.
-- Times are ISO-8601 UTC strings. Events are kept 30 days (cleanup).

-- One row per event. No packet content, no titles, no codes or tokens: names, ids, outcomes and durations.
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
CREATE INDEX events_ts ON events(ts);
CREATE INDEX events_kind_ts ON events(kind, ts);
CREATE INDEX events_subject_ts ON events(subject, ts);

-- Access tokens issued at or before revoked_at for this member and client ('*' = every client) are refused.
-- Written when a member is removed, a code is reset, or an assistant is disconnected. Kept 9 hours (longer
-- than an access token lives), then cleanup removes it.
CREATE TABLE access_revocations (
  subject    TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY (subject, client_id)
);

-- When a client last received tokens. Registrations that never did are removed after 7 days (cleanup);
-- a client that was used keeps its registration, so the assistant can sign in again with its saved client id.
ALTER TABLE oauth_clients ADD COLUMN last_used_at TEXT;
