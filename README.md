# Handoff

Plan in one AI. Build in another. **Tell something — with original files attached — to a teammate's or family member's agent.**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/evgolsh/handoff)

Three ways in. **The button** needs a Cloudflare account and a GitHub or GitLab account: it copies this repository
into yours, creates the D1 database and R2 bucket, asks for one secret, `HANDOFF_SETUP_CODE` (a code you choose,
12 characters or more), and deploys. Then open `/console/setup` on your Worker, enter that code and your handle, and
you are the admin. **Ask your AI**: say "Deploy https://github.com/evgolsh/handoff for me" to Claude Code, Codex or
Hermes Agent; it follows `llms-install.md` and runs `npm run setup` (needs Node and a Cloudflare login, no GitHub).
**A terminal**: the quick start below. The button was tested on 2026-10-28: build, deploy and the setup page.

Handoff is a small MCP service that a family or a small team runs on its own Cloudflare account. The
sending assistant writes a brief (purpose, decisions and reasons, constraints, next step, references,
open questions), attaches the files the user chose, and sends it to the sender's own inbox, to a
teammate, or to the whole team. The receiving assistant lists and reads it and continues the work. The
brief is stored verbatim. Attachments are stored as original bytes with a sha256.

One deployment profile (Cloudflare Workers, D1, R2). The Worker is also its own OAuth 2.1 server: members
sign in with a handle and an access code that the operator issues; there is no outside identity provider.
Five MCP tools, an operators' console at `/console`, and plugin/extension manifests for OpenAI Codex, Claude Code, Cursor, Gemini CLI, and Hermes Agent. Deployed at `https://handoff.evgolsh.workers.dev`;
the home page at `/` introduces the use cases, and `/connect` has the setup steps for each assistant.
`/use-cases` remains an alias for the home page. Which assistants are tested, and how far, is on `/connect`.

## Quick start (self-host on Cloudflare Free Tier)

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim,tom      # your handle first, then your teammates'
```

`npm run setup` checks your Cloudflare login, uses the D1 database named in `wrangler.jsonc` if it is in your account (otherwise yours named `handoff`, created if needed, with its id written into `wrangler.jsonc`), creates the R2 bucket (`handoff-attachments`), applies the D1 migrations, deploys the Worker, seeds the member handles from `--members` (without it: `owner`, `teammate`) with access codes shown once, grants the first member admin access to `/console`, and prints your live `/connect` and `/console` URLs. Later deploys: `npm run deploy` (migrations, then the Worker).

## Common workflows

- **Household / family last-mile:** Bake a complex task and source files (PDFs, images, Markdown) in Claude Code, Codex, or Hermes on your computer (`"Hand this off to tom with these files"`). Tom opens ChatGPT or Claude on his computer (`"Pick up the handoff from tim"`) and continues immediately without downloading and re-uploading files from chat apps.
- **Micro-team cross-vendor relay:** Design a schema or spec with an architecture PNG in Claude on one machine (`to: "tom"` or `to: "team"`), and let a teammate continue in Codex, Cursor, Claude Code, or Hermes on theirs with verbatim constraints and rejected options intact.
- **Cross-model adversarial review & multi-machine continuation:** Send a plan or diff from Claude Opus to GPT/Codex for an independent audit, or hand off background work from an always-on Mac mini agent to your laptop.

## Tools

| Tool | What it does | Annotations |
|---|---|---|
| `handoff_send` | Publish a brief with optional `to` (teammate handle or `"team"`) and attachments. Idempotent per `idempotency_key`. Accepts ChatGPT `files` (`_meta["openai/fileParams"]`) once `IMPORT_HOST_ALLOWLIST` is set. | write, not destructive, idempotent |
| `handoff_inbox` | Metadata of unexpired packets (`packet_id`, `from`, `to`, `title`, dates, attachment count), newest first, paged. | read-only |
| `handoff_read` | Exact brief and attachment list; or one attachment as text, image, or a 10-minute original download URL with sha256. | read-only |
| `handoff_revoke` | Hide a packet and stop its downloads. | destructive |
| `handoff_upload_url` | Single-use 15-minute upload URL for a local file (Codex, terminal). | write |

Files: PDF, PNG, JPEG, plain text, Markdown; 25 MiB each, 10 per packet. The type is decided from
the bytes. Packets expire after 30 days by default (1 hour to 90 days).

HTTP: `POST /v1/uploads`, `PUT /v1/uploads/:id` (bearer or `?ticket=`), `GET /v1/attachments/:id[/original]`,
`GET /v1/dl/:ticket`, `GET /.well-known/oauth-protected-resource`. OAuth: `GET /.well-known/oauth-authorization-server`,
`GET /.well-known/jwks.json`, `POST /oauth/register`, `GET|POST /authorize`, `POST /oauth/token`.

## Security model

- Identity: the member handle in the `sub` of an access token this Worker signed (ES256; issuer `PUBLIC_URL`, audience `PUBLIC_URL/mcp`, expiry, `client_id`). No input names an owner.
- Sign-in: only members in the `members` table, with their access code (PBKDF2, salted), and only for clients registered by RFC 7591 with that exact redirect URI; PKCE S256. Codes are single use for 10 minutes; access tokens last 8 hours; refresh tokens rotate and last 30 days. The page names the client and the host it returns to.
- Members are added by the operator only (the console at `/console`, or `npm run member:add`); there is no public sign-up. So `to: "team"` reaches the members and nobody else. `team` and `all` cannot be handles.
- Ending access works at once: a code reset or a removed member signs out all their assistants, and Disconnect in the console signs out one. Refresh tokens are revoked, and access tokens issued before that are refused (`access_revocations`, checked on every request).
- A packet is readable by its sender, its named recipient, or for a team packet every member. Anyone else reads "not found". Only the sender revokes a team packet.
- An attachment is readable only through a live packet it belongs to; owning it through another packet is not enough.
- Download URLs are bearer capabilities valid 10 minutes; the packet is re-checked on each fetch, so revocation applies at once.
- Server-side imports: off until `IMPORT_HOST_ALLOWLIST` names the hosts; then https only, public DNS names only, no redirects, size bound. The request is checked before any download, and files imported by a send that does not publish them are deleted at once. Signed URLs are never stored or logged.
- Each account can hold at most 50 files that are not in a packet (uploading or uploaded); more uploads are refused with 429.
- The token signing key is generated on first use and kept in D1 (`oauth_keys`), or set as the `OAUTH_SIGNING_JWK` secret. The local-only `DEV_TOKENS` work only with `HANDOFF_ENV=dev`.

## Update check

Once a day, the hourly cron asks the project's hosted instance for the latest version, and the console's Ops page
shows the answer. The request carries a random id made once for this deployment, the version, and two size buckets
(members: 0, 1, 2-5, 6+; packets created in the last 30 days: 0, 1-9, 10-49, 50+). No handles, titles, file names,
addresses, or counts beyond those buckets; the receiving end keeps one row per id for 90 days. It is how the
project counts deployments in use. To turn it off, set the variable `HANDOFF_UPDATE_CHECK` to `off` (under `vars` in `wrangler.jsonc`, or in the
dashboard); the Ops page then says "update check off". `src/update-check.ts` is the whole of it, both ends.

## Docs

- `docs/DEVELOPMENT.md`: run the tests and a local server.
- `docs/CONSOLE.md`: the operators' console at `/console`: who can open it, what each page shows, and what add, reset, remove and disconnect do.
- `docs/DEPLOY.md`: Cloudflare, the OAuth provider, the plugin install.
- `CONTRIBUTING.md` and `SECURITY.md`: how to report a bug, a host that does not connect, or a security issue.
- `llms-install.md`: machine-readable installation and deployment guide for AI coding agents.
- `plugin/`: the OpenAI / Codex plugin package (manifest, MCP config, skill), alongside root `.claude-plugin/`, `.cursor-plugin/`, `gemini-extension.json`, and `server.json`.
