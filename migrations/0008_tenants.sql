-- Teams that signed up on the control center (HANDOFF_MODE=control). A tenant's members are the rows of
-- `members` whose handle starts with "<slug>/" (src/domain/tenant.ts). A private install has no rows here.
CREATE TABLE tenants (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  members_cap INTEGER NOT NULL DEFAULT 10
);
