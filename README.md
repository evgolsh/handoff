# Handoff

Hand your work to someone else's AI assistant, with a brief and the original files.

You sort out the details in Claude. Your partner says "continue the handoff from tim" in ChatGPT and gets your notes and the original files. You can hand off to a teammate, or to yourself in another assistant or on another computer.

- **Your notes and the files.** The brief says what you decided and what is left to do. PDFs and images go with it, byte for byte.
- **Their own assistant.** Your partner can use ChatGPT while you use Claude. Codex, Claude Code and Hermes work too. Each person signs in with their own username.
- **Storage, not AI.** Handoff keeps the brief and files and deletes them after 30 days. It makes no model calls and needs no API keys.

Handoff is an open-source MCP server on your own Cloudflare account, on the free plan with no card. MIT licensed. [Watch the 31-second demo](https://handoff.infraworks.net/demo/handoff-demo.mp4).

## Install

Install it once for your whole team. It runs on Workers, D1 and KV in your Cloudflare account. Teammates only sign in, and a new assistant, computer or teammate needs no new install.

There are three ways to install. Each one creates the same private server.

### From your browser

You need a **Cloudflare account** and a **GitHub or GitLab account**. Cloudflare copies the code there, creates the database and file store, and deploys your server.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://handoff.infraworks.net/deploy)

Set `HANDOFF_SETUP_CODE` to a code of 12 or more characters. After the deploy, open `/console/setup` on your new server and enter it with your username. See [Deploy button details](docs/DEPLOY.md#from-your-browser).

### Ask a coding assistant

Claude Code, Codex, Gemini CLI, Hermes or any assistant that can run commands on your computer. Give it this request with your own usernames:

> Deploy https://github.com/evgolsh/handoff to my Cloudflare account. Follow llms-install.md. My username is tim; add tom as a teammate. Ask me to approve the Cloudflare login, then help me connect my assistants.

You approve the Cloudflare login. No GitHub account needed. The steps it follows are in [llms-install.md](llms-install.md).

### Run it yourself

You need Git, **Node.js 22+** with npm, and a Cloudflare account. No GitHub account needed.

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim,tom
```

Replace `tim,tom` with your usernames, yours first. Setup creates the storage, deploys the server and makes you the admin. It opens the Cloudflare login if needed, then prints your server, `/connect` and `/console` URLs and the access codes.

- A username has 1 to 63 lowercase letters, digits, dots, underscores or hyphens, and starts with a letter or digit. `team` and `all` are reserved.
- Always pass `--members=`. Without it, setup creates placeholder users `owner` and `teammate`.
- **If the account already has a Worker named `handoff`, check it first.** Setup redeploys it and reuses its resources. See [existing deployments and reruns](docs/DEPLOY.md#existing-deployments-and-reruns).
- A new Cloudflare account may need its `workers.dev` address registered first. Setup links to the page. Register it, then run setup again from the same clone.

## After you install

1. **Sign in to your Handoff console.** After a browser deploy, `/console/setup` creates your admin account and shows your access code once. After a terminal install, sign in at the printed `/console` URL with the access code setup printed. Assistants sign in with access codes, never with the setup code. Keep access codes in a password manager, and out of issues, commits and briefs.
2. **Add your teammates.** After a browser deploy, or when adding more people later, create their usernames in **Members** and share each person's access code privately. Teammates need no Cloudflare or GitHub account.
3. **Connect your assistants.** Each person opens your server's `/connect` page and follows the steps for their assistant. Everyone uses the same server and its `/mcp` address, for example `https://handoff.acme.workers.dev/mcp`, and signs in with their own username.
4. **Try a handoff.** Say "Hand this off" in one assistant, then "Continue my handoff" in another. To send to your teammate, say "Hand this off to tom". Your teammate says "Continue the handoff from tim".

The [console guide](docs/CONSOLE.md) covers Members, assistant connections and the Ops page.

## Updates

Keep the clone you installed from: setup writes your resource IDs into `wrangler.jsonc`. To update, pull the code in that clone, run `npm install`, then `npm run deploy`. Deploy applies database migrations, then deploys the Worker. It does not change members.

Add new people in Members. Running setup again with a longer `--members` list does not add them to an existing server. See [updates and recovery](docs/DEPLOY.md#updates-and-recovery) for lost codes and local changes.

## Try it without deploying

[The shared playground](https://handoff.infraworks.net/join) lets you create a team and connect an assistant first. It is separate from your own server and has limits: 10 members per team, handoffs expire after 24 hours by default (7 days at most), and files up to 5 MiB. Keep private work on your own server.

## How it works

Handoff is storage with a sign-in. The assistant writes a brief: the purpose, decisions, constraints, next step, references and open questions. Handoff stores it word for word, with the original files and a SHA-256 checksum for each. A handoff goes to yourself, to one username, or to `team` for everyone on your server.

| Tool | Does |
|---|---|
| `handoff_send` | Publish a brief with optional `to` and attachments. Idempotent per `idempotency_key`. |
| `handoff_inbox` | List unexpired packets, newest first. |
| `handoff_read` | Read a packet's brief and attachment list, or an attachment as text, image, or a 10-minute download URL. |
| `handoff_revoke` | Hide a packet and stop its downloads. |
| `handoff_upload_url` | Create a single-use 15-minute upload URL for a local file. |

Files: PDF, PNG, JPEG, text and Markdown, up to 25 MiB each and 10 per handoff. The type is checked from the bytes. Handoffs expire after 30 days by default (1 hour to 90 days).

On Cloudflare's free plan there is room for 100,000 requests and 1,000 new files a day, and 1 GB of stored files. Handoff has no paid tier.

## Security

- The Worker is its own OAuth 2.1 server. Only listed members can sign in, using PBKDF2-hashed access codes. No third-party identity provider or public sign-up on a private install.
- Identity comes from the signed access token (`sub`, ES256, issuer `PUBLIC_URL`, audience `PUBLIC_URL/mcp`). Clients register via RFC 7591 or an HTTPS client metadata document, with redirect validation and PKCE S256. OAuth authorization codes last 10 minutes, access tokens 8 hours, rotating refresh tokens 30 days.
- A packet is readable by its sender, its named recipient, or every member for a team packet. Everyone else gets "not found". Only the sender revokes a team packet.
- Attachments are readable only through a live packet. Download URLs last 10 minutes and packet access is rechecked on each fetch.
- Resetting a member's access code or removing them signs out their assistants. Disconnect in the console signs out one connection.
- Server-side file imports are off until `IMPORT_HOST_ALLOWLIST` names allowed hosts. Imports require HTTPS and public DNS, refuse redirects and bound the size. Signed URLs are not stored or logged.
- The Worker does not implement a general per-request rate limit. See [Operations](docs/DEPLOY.md#operations) for optional Cloudflare zone-level protection.

## Update check

Once a day the Worker asks `handoff.infraworks.net` for the latest version and shows it on the Ops page. It sends a random instance ID, the version, and two size buckets (members: 0, 1, 2-5, 6+; packets in the last 30 days: 0, 1-9, 10-49, 50+). Nothing else. Turn it off with `HANDOFF_UPDATE_CHECK=off`.

## Docs

- [Deploy and connect](docs/DEPLOY.md): setup safety, the Deploy button, configuration and operations.
- [Console](docs/CONSOLE.md): pages and actions.
- [Development](docs/DEVELOPMENT.md): tests and a local server.
- [Install guide for coding assistants](llms-install.md): installation and checks, step by step.
- [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).
- [Plugin package](plugin/): packaging and host-specific notes. Use your own server's URL when you connect a self-hosted install.
