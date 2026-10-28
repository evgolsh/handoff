-- Settings of this deployment (src/update-check.ts): the random instance id made once, when the daily update
-- check last ran, and the latest version it was told about.
CREATE TABLE instance (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Only used by a deployment with UPDATE_CHECK_RECEIVER=1 (the project's hosted instance): the anonymous
-- update checks it received, one row per instance id. Rows not seen for 90 days are removed by cleanup.
CREATE TABLE instances_seen (
  id         TEXT PRIMARY KEY,
  version    TEXT NOT NULL,
  members    TEXT NOT NULL,   -- bucket: 0, 1, 2-5, 6+
  packets    TEXT NOT NULL,   -- bucket of packets created in the last 30 days: 0, 1-9, 10-49, 50+
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  checks     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX instances_seen_last ON instances_seen(last_seen);
