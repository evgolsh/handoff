# Handoff — Agent Installation & Deployment Guide (`llms-install.md`)

Use these exact steps when a user asks you (Claude Code, Hermes Agent, Codex, Cursor, or Cline) to deploy **Handoff** to their Cloudflare account and connect their assistants.

## 1. Prerequisites
- Node.js 20+ and `npm`
- A Cloudflare account (Free tier is sufficient: Workers + D1 + R2)

## 2. Clone and Deploy (One Command)

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup
```

What `npm run setup` (`scripts/deploy.mjs`) does:
1. Checks `npx wrangler whoami` (opens `npx wrangler login` in the browser if not signed in).
2. Uses the D1 database named in `wrangler.jsonc` if it is in the user's account; otherwise the user's database `handoff`, created if needed, with its `database_id` written into `wrangler.jsonc`. Creates the R2 bucket (`handoff-attachments`) if needed.
3. Applies all D1 migrations (`migrations/`).
4. Deploys the Cloudflare Worker (`https://handoff.<subdomain>.workers.dev`).
5. Seeds initial teammate handles (`owner`, `teammate`), makes the first member an operator of `/console`, and prints the live `/connect` and `/console` URLs plus each member's login handle and access code.

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
