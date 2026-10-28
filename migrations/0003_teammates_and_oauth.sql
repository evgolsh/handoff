-- Teammate addressing and built-in OAuth 2.1 server tables.
-- Times are ISO-8601 UTC strings.

-- Recipient handle or subject on a packet. NULL or equal to owner = self-handoff;
-- a teammate handle/subject = shared with that teammate; '*' = shared with all members of this instance.
ALTER TABLE packets ADD COLUMN recipient TEXT;
CREATE INDEX packets_recipient_inbox ON packets(recipient, expires_at, created_at DESC, id DESC);

-- Built-in OAuth 2.1 ES256 signing keypair (auto-created on first use when OAUTH_SIGNING_JWK is not set).
CREATE TABLE oauth_keys (
  kid         TEXT PRIMARY KEY,
  private_jwk TEXT NOT NULL,
  public_jwk  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Micro-team / family members for built-in sign-in at /authorize.
CREATE TABLE members (
  handle      TEXT PRIMARY KEY,
  code_salt   TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- RFC 7591 Dynamic Client Registration records.
CREATE TABLE oauth_clients (
  client_id     TEXT PRIMARY KEY,
  redirect_uris TEXT NOT NULL,
  client_name   TEXT,
  created_at    TEXT NOT NULL
);

-- Single-use PKCE S256 authorization codes (10-minute lifetime).
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
CREATE INDEX oauth_codes_expires ON oauth_codes(expires_at);

-- Rotating refresh tokens (30-day lifetime).
CREATE TABLE oauth_refresh_tokens (
  token_hash  TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  scope       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX oauth_refresh_tokens_expires ON oauth_refresh_tokens(expires_at);
