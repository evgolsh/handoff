# Handoff

Tell something to a teammate's agent. Your assistant writes a brief, attaches the original files, and sends it. Their assistant reads it and carries on. Works across vendors: Claude, ChatGPT, Codex, Hermes, Cursor, Gemini CLI.

Runs on your own Cloudflare account (Workers, D1, R2). Free tier is enough. MIT.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://handoff.infraworks.net/deploy)

## Quick start

Three ways.

**Deploy button.** Needs a Cloudflare account and a GitHub or GitLab account (Cloudflare copies the repo into it). The form asks for one secret, `HANDOFF_SETUP_CODE`: pick anything 12 characters or longer. After the deploy, open `/console/setup` on your Worker, enter that code and your handle. You are the admin.

**Ask your AI.** Tell Claude Code, Codex or Hermes: "Deploy https://github.com/evgolsh/handoff for me and tom". It follows `llms-install.md`. Needs Node and a Cloudflare login, no GitHub.

**Terminal.**

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim,tom   # your handle first
```

`npm run setup` signs you in to Cloudflare, creates the D1 database and R2 bucket, runs the migrations, deploys, creates the members with access codes (shown once) and prints your `/connect` and `/console` URLs. Later: `npm run deploy`.

## Try it first

https://handoff.infraworks.net is the project's own deployment. Create a team at `/join` and connect an assistant. It is shared and capped (10 members per team, packets live 24 hours by default, 7 days at most, 5 MiB files), so keep private files on your own install.

## How it works

The sender says "hand this off to tom with these files". The assistant calls `handoff_send` with a brief (purpose, decisions, constraints, next step, references, open questions) and the attachments. Tom says "pick up the handoff from tim"; his assistant calls `handoff_inbox` and `handoff_read`. The brief is stored verbatim, attachments as original bytes with a sha256. A packet goes to yourself, to one handle, or to `team`.

| Tool | Does |
|---|---|
| `handoff_send` | Publish a brief with optional `to` and attachments. Idempotent per `idempotency_key`. |
| `handoff_inbox` | List unexpired packets, newest first. |
| `handoff_read` | One packet's brief and attachment list, or one attachment as text, image, or a 10-minute download URL. |
| `handoff_revoke` | Hide a packet and stop its downloads. |
| `handoff_upload_url` | Single-use 15-minute upload URL for a local file. |

Files: PDF, PNG, JPEG, text, Markdown. 25 MiB each, 10 per packet. Type is sniffed from the bytes. Packets expire after 30 days by default (1 hour to 90 days).

The Worker is its own OAuth 2.1 server. Members sign in with a handle and an access code the admin gives them. No third-party identity provider, no sign-up on a private install.

## Security

- Identity is the `sub` of an access token this Worker signed (ES256, issuer `PUBLIC_URL`, audience `PUBLIC_URL/mcp`). Nothing in a request names an owner.
- Sign-in only for listed members, with PBKDF2-hashed codes, only for clients registered by RFC 7591 with that exact redirect URI, PKCE S256. Codes last 10 minutes, access tokens 8 hours, refresh tokens 30 days and rotate.
- A packet is readable by its sender, its named recipient, or every member for a team packet. Everyone else gets "not found". Only the sender revokes a team packet.
- An attachment is readable only through a live packet it belongs to. Download URLs live 10 minutes and are re-checked against the packet on each fetch.
- Reset or removal signs the member out of every assistant at once; Disconnect in the console signs out one. Tokens issued before are refused.
- Server-side imports of host file URLs are off until `IMPORT_HOST_ALLOWLIST` names the hosts. Then https only, public DNS, no redirects, bounded size. Signed URLs are never stored or logged.
- Rate limiting is a Cloudflare WAF rule on your zone, not Worker code. `docs/DEPLOY.md` has the suggested rule.

## Console

`/console`: members, connected assistants, activity, ops. Admins sign in with their handle and code. Add members, reset codes, disconnect an assistant, run cleanup. On the control center, `/console/tenants` is the operator's view across teams.

## Update check

Once a day the Worker asks `handoff.infraworks.net` for the latest version and shows it on the Ops page. It sends a random instance id, the version, and two size buckets (members: 0, 1, 2-5, 6+; packets in the last 30 days: 0, 1-9, 10-49, 50+). Nothing else. Turn it off with the variable `HANDOFF_UPDATE_CHECK=off`.

## Docs

- `docs/DEPLOY.md`: Cloudflare, variables, the WAF rule, connecting each assistant.
- `docs/CONSOLE.md`: the console pages and actions.
- `docs/DEVELOPMENT.md`: tests and a local server.
- `llms-install.md`: the install guide an AI agent follows.
- `CONTRIBUTING.md`, `SECURITY.md`.
- `plugin/`, `.claude-plugin/`, `.cursor-plugin/`, `gemini-extension.json`, `server.json`: manifests for Codex, Claude Code, Cursor, Gemini CLI and the MCP registry.
