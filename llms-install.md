# Handoff: install and deploy (guide for AI agents)

Use these exact steps when a user asks you (Claude Code, Hermes Agent, Codex, Cursor, or Cline) to deploy **Handoff** to their Cloudflare account and connect their assistants.

## 1. Prerequisites
- Node.js 20+ and `npm`
- A Cloudflare account (Free tier is sufficient: Workers + D1 + R2)

## 2. Ask, then Clone and Deploy (One Command)

Before running anything, ask the user two things and wait for the answers:
1. **Handles** for the members: their own and each teammate's or family member's (lower case, letters, digits,
   `.`, `_`, `-`; not `team` or `all`). For example `tim,tom`.
2. Whether they already have a Cloudflare account. If not, they create one (free) at https://dash.cloudflare.com/sign-up
   first; the setup opens a browser window to sign in.

Then:

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim,tom
```

Do not run `npm run setup` without `--members`: it would seed placeholder handles `owner` and `teammate`.
If a Worker named `handoff` already exists in this Cloudflare account, stop and ask: the setup would redeploy it.

What `npm run setup` (`scripts/deploy.mjs`) does:
1. Checks `npx wrangler whoami` (opens `npx wrangler login` in the browser if not signed in).
2. Uses the D1 database named in `wrangler.jsonc` if it is in the user's account; otherwise the user's database `handoff`, created if needed, with its `database_id` written into `wrangler.jsonc`. Creates the R2 bucket (`handoff-attachments`) if needed.
3. Applies all D1 migrations (`migrations/`).
4. Deploys the Cloudflare Worker (`https://handoff.<subdomain>.workers.dev`).
5. Seeds the member handles from `--members`, makes the first one an admin of `/console`, and prints the live `/connect` and `/console` URLs plus each member's handle and access code. **The codes are shown once.** Give the user their own code, and each teammate's code to hand over privately. Never write the codes into a file in the repository or into a handoff brief.

To add or rotate a teammate's login code at any time (in terminal or via `/console`):
```sh
npm run member:add -- <handle>
npm run admin -- <handle>        # optional: grant access to /console (--revoke to undo)
```

## 3. Connect Your AI Assistants

Replace `<PUBLIC_URL>` below with the deployed Worker URL (for example `https://handoff.<subdomain>.workers.dev`):

### Claude Code
```sh
claude mcp add --transport http --scope user handoff <PUBLIC_URL>/mcp
```
Then in Claude Code run `/mcp`, choose **handoff**, and authenticate with your teammate handle and access code.

### Hermes Agent
```sh
hermes mcp add handoff --url <PUBLIC_URL>/mcp --auth oauth
hermes mcp login handoff
```
Then start a new chat or run `/reload-mcp`.

### Codex
```sh
codex mcp add handoff --url <PUBLIC_URL>/mcp
codex mcp login handoff
```

### Claude (`claude.ai` Web & Desktop) / ChatGPT
Open `<PUBLIC_URL>/connect` in your browser and follow the step-by-step connector instructions for Claude and ChatGPT.

## 4. Verify With a Round Trip

After connecting yourself, prove the deployment works before telling the user it is done:
1. Call `handoff_send` with a short brief addressed to the user's own handle (`to` = their handle) and a fresh `idempotency_key`.
2. Call `handoff_inbox`: the packet is listed. Call `handoff_read` with its `packet_id`: the brief comes back verbatim.
3. Call `handoff_revoke` on it.

If any step fails, read the error (it names the cause) and fix that before going on. Then tell the user: the Connect
page address, their handle and code (once), and how a teammate joins: open `<PUBLIC_URL>/connect` on their computer,
pick their assistant, and sign in with the handle and code the user gives them.

## 5. Later

- Add or reset a member: the console at `<PUBLIC_URL>/console` (Members), or `npm run member:add -- <handle>`.
- Update the deployment: `git pull` in the clone, then `npm run deploy`. The console's Ops page says when a newer
  version exists.
