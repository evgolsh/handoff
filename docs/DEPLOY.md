# Deploy and connect

The Worker is its own OAuth 2.1 server (`src/auth/builtin.ts`), backed by Cloudflare D1 (packets, attachments,
members, OAuth clients/codes/tokens, console sessions, events) and R2 (`handoff-attachments`). Members sign in
with a handle and an access code; there is no external identity provider.

Before opening an instance to people outside your machine:
- Add the Cloudflare WAF rate rule (see Operations).
- Verify member isolation with a second member handle (`npm run member:add -- tom`).

Deploy order: D1 migrations before the Worker. `npm run deploy` does both, in that order (the Deploy to
Cloudflare button runs it too).
Migration 0002 adds `attachments.claim`. Migration 0003 adds `packets.recipient` and
the sign-in tables (members, clients, codes, refresh tokens, signing key); 0004 adds the console tables
(admins, sessions, login limits); 0005 adds `events`, `access_revocations` and `oauth_clients.last_used_at`;
0006 adds `oauth_clients.fetched_at` (client metadata documents).

Logs: invocation logs are off in `wrangler.jsonc`, because request URLs carry upload and download tickets.
The Worker's own error lines carry the route template, never the URL.

Known issues:
- Cloudflare's bot filter answers 403 (error 1010) to some default HTTP client user agents, such as
  Python urllib, before the Worker runs. Check this if a host fails with 403 and no Worker log line.

## 1. Cloudflare

Three ways, each into your own Cloudflare account:

- The Deploy to Cloudflare button (README). It reads `wrangler.jsonc`, creates the database and bucket, asks
  for the secrets in `.dev.vars.example` (only `HANDOFF_SETUP_CODE`) and runs `npm run deploy`. Untested until
  the repository is public.
- `npm run setup` (scripts/deploy.mjs): see the README.
- By hand:

```sh
npx wrangler login
npx wrangler d1 create handoff            # put its database_id into wrangler.jsonc
npx wrangler r2 bucket create handoff-attachments
npm run deploy                            # migrations, then the Worker
```

`PUBLIC_URL` is not set: the Worker uses the origin each request came to (the workers.dev address, or a custom
domain), and that origin is the OAuth issuer. `wrangler.jsonc` has no `vars` at all, so the Deploy to Cloudflare
button asks for nothing but the `HANDOFF_SETUP_CODE` secret. The optional variables (set under `vars`, or in the
dashboard): `PUBLIC_URL` to pin one origin when the Worker has several (no trailing slash; changing it signs every
assistant out), `HANDOFF_ENV=dev` for local development only, `MAX_ATTACHMENT_BYTES` (default 25 MiB),
`IMPORT_HOST_ALLOWLIST` (section 4), and `HANDOFF_UPDATE_CHECK=off` (README, "Update check").

## 2. Sign-in and members

The Worker is the OAuth 2.1 authorization server for its own MCP endpoint (`src/auth/builtin.ts`): RFC 8414
metadata, RFC 7591 dynamic client registration, PKCE S256, ES256 access tokens (8 hours) and rotating
refresh tokens (30 days). The issuer is `PUBLIC_URL`; the audience is `PUBLIC_URL/mcp`. There is no outside
identity provider and nothing to configure for it.

Assistants either register (RFC 7591) or, like Claude Code, use an https `client_id` that names their client
metadata document (`src/auth/clients.ts`). The Worker fetches that document when it first sees it (no
redirects, 5 KB, 5 seconds), keeps it for a day, and returns the sign-in only to a redirect address the
document lists; a loopback address matches on any port (RFC 8252). A document it cannot use is logged as
"client document unusable" in the console's recent activity.

First admin: `npm run setup` makes one. A server deployed with the button has none; open
`PUBLIC_URL/console/setup`, enter the `HANDOFF_SETUP_CODE` secret and a handle, and that member becomes the
admin (code shown once). The page is open only while no admin exists and the secret is 12 characters or
more; guesses count against the console's sign-in limit (10 per 10 minutes per address). Without the secret,
the page says how to set it in the dashboard, or to use `npm run member:add` and `npm run admin`.

Members are the people who may sign in. Add one, or give a member a new code, in the console
(`PUBLIC_URL/console`, Members) or on the deployment computer:

```sh
npm run member:add -- tom              # prints a new access code once; --local for the local D1
npm run admin -- tim                   # lets member tim open the console (--revoke to undo)
```

Give the handle and code to that person privately. Each of their assistants signs in with them. A new code
stops the old one and signs out every assistant of that member at once; they sign in again with the new code.
`docs/CONSOLE.md` describes the console.

Signing key: generated on first use and kept in D1 (`oauth_keys`), unless the `OAUTH_SIGNING_JWK` secret
holds an ES256 private JWK. A new key, or a new `PUBLIC_URL`, signs every assistant out.

The Ops page shows the deployed version from the `version_metadata` binding (`CF_VERSION_METADATA` in
`wrangler.jsonc`).

Check: `curl PUBLIC_URL/.well-known/oauth-protected-resource` names `PUBLIC_URL` as the authorization
server, `curl PUBLIC_URL/.well-known/oauth-authorization-server` lists the endpoints, and
`curl -i PUBLIC_URL/mcp -X POST` returns 401 with a `WWW-Authenticate` header that names the metadata URL.

## 3. Hosts and the plugin package

`plugin/mcp.json` names this deployment's endpoint. For another deployment, replace
`https://handoff.infraworks.net/mcp` there with `PUBLIC_URL/mcp`.

The Connect page (`PUBLIC_URL/connect`) has the steps for each host and says which were tested.
Codex desktop: install the `plugin/` folder as a local plugin (`plugin/README.md` has the tested
commands) and sign in when it asks. Claude Code: `claude mcp add --transport http --scope user
handoff PUBLIC_URL/mcp`, then `/mcp` and Authenticate. Hermes Agent: `hermes mcp add handoff --url
PUBLIC_URL/mcp --auth oauth`, then `hermes mcp login handoff`. ChatGPT: Plugins, add a custom MCP server with
the endpoint URL and OAuth, "Create as a plugin", install it from the personal plugins view, then in a
Work chat type `@` and pick Handoff. claude.ai: add a custom connector with the endpoint URL. To attach files
from Claude (web or desktop), also add the server's host to the allowed domains in Claude's Settings >
Capabilities: Claude uploads from its sandbox, and without the domain the upload fails with 403 while text
handoffs still work. Each host opens the sign-in page: enter the handle and access code.

Check: the five tools `handoff_send`, `handoff_inbox`, `handoff_read`, `handoff_revoke`,
`handoff_upload_url` appear in the host.

## 4. ChatGPT file imports

ChatGPT file imports (`files`) are off while `IMPORT_HOST_ALLOWLIST` is empty. In the first ChatGPT
test, a send with a file fails with `import_rejected: file import is off on this server ...; download_url
host <host> was not contacted`. Put that host (or `*.` and its parent domain) in `IMPORT_HOST_ALLOWLIST`,
deploy, and send again.

## Operations

- Cleanup runs hourly at minute 17 (`triggers.crons`): staging and failed uploads older than 24 hours,
  ready files unattached for 7 days, packets expired or revoked more than 7 days ago, expired tickets.
  One run removes at most 5 batches of 200 rows of each kind; if it stops early, its log line has
  `"backlog": true` and level `warn`, and the next run continues. A failed run logs a `cleanup` error
  line and is recorded as failed.
- The update check runs from the same cron once a day (README, "Update check"): a random instance id, the
  version and two size buckets go to the project's hosted instance, which answers with the latest version
  for the Ops page. `HANDOFF_UPDATE_CHECK=off` turns it off. `UPDATE_CHECK_URL` points it elsewhere;
  `UPDATE_CHECK_RECEIVER=1` makes a deployment the receiving end (the project's hosted instance only).
- `HANDOFF_MODE=control` is set only on the project's control center (README, "Two modes"). It adds `/join`,
  `/stats`, a team field on the sign-in pages, per-team consoles and the operator's Tenants page, and makes the
  deployment the update-check receiver. A private install never sets it.
- Logs are structured JSON through Workers observability. Signed URLs and file bytes are never logged.
- Limits in the Worker: 25 MiB per file, 10 files per packet, 50 files per account outside packets
  (429 `quota_exceeded` beyond that). There is no per-request rate limit in the Worker: put a
  Cloudflare WAF rate-limiting rule on `/mcp` and `/v1/*` (dashboard: Security, WAF, Rate limiting
  rules), for example 120 requests per minute per IP.
