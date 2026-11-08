# Handoff

Hand your work to someone else's AI assistant, with your notes and the original files.

Joe sorts out the car insurance renewal in Claude. Anna says "continue the handoff from joe" in ChatGPT and gets his notes and the two PDFs. You can hand off to your partner, a teammate, or yourself in another assistant or on another computer.

- **Your notes and the files.** The brief says what you decided and what is left to do. PDFs and images go with it, byte for byte. Open a handoff in Assets to read the brief and see the files.
- **Their own assistant.** Anna can use ChatGPT while Joe uses Claude. Codex, Claude Code and Hermes work too. Each person signs in with their own username.
- **Storage, not AI.** Handoff keeps the brief and files and deletes them when they expire. It makes no model calls and needs no API keys.

Free at [handoff.infraworks.net](https://handoff.infraworks.net), or open source on your own Cloudflare account for a small team that wants its files on its own infrastructure. MIT licensed. [Watch the 29-second demo](https://handoff.infraworks.net/demo/handoff-demo.mp4).

## Get started

1. **Add Handoff to your assistant.** The server address is `https://handoff.infraworks.net/mcp`. In Claude, [this link](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Handoff&connectorUrl=https%3A%2F%2Fhandoff.infraworks.net%2Fmcp) opens the custom connector form with it filled in. For ChatGPT, Codex, Claude Code and Hermes, see [Assistant setup](https://handoff.infraworks.net/connect).
2. **Create a team.** On the Handoff sign-in page that opens, choose **Create a team** and pick a team name and your username. You are its admin. Save the access code it shows once: you need it to sign in from another assistant.
3. **Invite your partner.** Ask your assistant "invite anna to Handoff" and send her the link it gives you. She opens it, gets her own access code and connects her assistant.
4. **Hand off.** "Hand this off to anna with the two PDFs." She says "Continue the handoff from joe."

The hosted service is free: up to 10 people per team, files up to 25 MiB, handoffs deleted after 7 days by default (30 at most). See [Privacy](https://handoff.infraworks.net/privacy). Assistants can read the whole setup at [llms.txt](https://handoff.infraworks.net/llms.txt).

## Your own private server

Install it once for your whole team. It runs on Workers, D1 and KV in your Cloudflare account, on the free plan with no card. Teammates only sign in, and a new assistant, computer or teammate needs no new install. Your briefs and files stay on your account, and handoffs are kept 30 days by default.


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

## After you install a private server

1. **Sign in to your Handoff console.** After a browser deploy, `/console/setup` creates your admin account and shows your access code once. After a terminal install, sign in at the printed `/console` URL with the access code setup printed. Assistants sign in with access codes, never with the setup code. Keep access codes in a password manager, and out of issues, commits and briefs.
2. **Add your teammates.** After a browser deploy, or when adding more people later, create their usernames in **Members** and share each person's access code privately. Teammates need no Cloudflare or GitHub account.
3. **Connect your assistants.** Each person opens your server's `/connect` page and follows the steps for their assistant. Everyone uses the same server and its `/mcp` address, for example `https://handoff.acme.workers.dev/mcp`, and signs in with their own username. To upload a file from a phone or another folder, they sign in at `/assets` (see [Assets](#assets)).
4. **Try a handoff.** Say "Hand this off" in one assistant, then "Continue my handoff" in another. To send to your teammate, say "Hand this off to tom". Your teammate says "Continue the handoff from tim".

The [console guide](docs/CONSOLE.md) covers Members, assistant connections and the Ops page.

## Assets

Each member can open `/assets` on your server and sign in with their username and access code. Assets shows their handoffs and files in one list: the handoffs they sent or received, and files they uploaded that are not sent yet. Each one shows when it expires.

Opening a handoff shows its brief and its files in the page: PDFs in the browser's viewer, images, text and Markdown, each with Open and Download. An uploaded file opens the same way, for its uploader only.

There they also upload a file for their assistant to send, such as a scan on their phone. An uploaded file is visible only to its uploader until an assistant sends it, and is deleted if it is not sent within 7 days. If they already have an unsent file with that name, the new one gets a number, such as `lease (2).pdf`.

Then they say "Hand this off with lease.pdf". The assistant attaches the file by its name. If no file or more than one file has that name, nothing is sent and the assistant asks which one.

Every signed-in page has the same left menu: Assets, Assistant setup, and for an admin the team pages of the console. An admin signs in once, and signing out of either ends both.

## Updates

Keep the clone you installed from: setup writes your resource IDs into `wrangler.jsonc`. To update, pull the code in that clone, run `npm install`, then `npm run deploy`. Deploy applies database migrations, then deploys the Worker. It does not change members.

Add new people in Members. Running setup again with a longer `--members` list does not add them to an existing server. See [updates and recovery](docs/DEPLOY.md#updates-and-recovery) for lost codes and local changes.

## How it works

Handoff is storage with a sign-in. The assistant writes a brief: the purpose, decisions, constraints, next step, references and open questions. Handoff stores it word for word, with the original files and a SHA-256 checksum for each. A handoff goes to yourself, to one username, or to `team` for everyone in your team.

| Tool | Does |
|---|---|
| `handoff_send` | Publish a brief with optional `to` and attachments, by id or by the name of an unsent file. Idempotent per `idempotency_key`. |
| `handoff_inbox` | List unexpired packets, newest first, and your unsent files. |
| `handoff_read` | Read a packet's brief and attachment list, or an attachment as text, image, or a 10-minute download URL. |
| `handoff_revoke` | Hide a packet and stop its downloads. |
| `handoff_upload_url` | Create a single-use 15-minute upload URL for a local file. |
| `handoff_invite` | For a team admin: add a teammate and get a one-time invitation link, valid 7 days. |

Files: PDF, PNG, JPEG, text and Markdown, up to 25 MiB each and 10 per handoff. The type is checked from the bytes. On a private server handoffs expire after 30 days by default (1 hour to 90 days); on the hosted service after 7 days (1 hour to 30 days).

On Cloudflare's free plan a private server has room for 100,000 requests and 1,000 new files a day, and 1 GB of stored files. Handoff has no paid tier.

## Security

- The Worker is its own OAuth 2.1 server. Only listed members can sign in, using PBKDF2-hashed access codes. No third-party identity provider or public sign-up on a private install.
- Identity comes from the signed access token (`sub`, ES256, issuer `PUBLIC_URL`, audience `PUBLIC_URL/mcp`). Clients register via RFC 7591 or an HTTPS client metadata document, with redirect validation and PKCE S256. OAuth authorization codes last 10 minutes, access tokens 8 hours, rotating refresh tokens 30 days.
- A packet is readable by its sender, its named recipient, or every member for a team packet. Everyone else gets "not found". Only the sender revokes a team packet.
- Attachments are readable only through a live packet. Download URLs last 10 minutes and packet access is rechecked on each fetch.
- Assets (`/assets`) has its own session cookie (HttpOnly, SameSite=Strict, 12 hours), which never opens the console. An admin's sign-in also starts a separate console session, and the console checks the admin grant on every request. Its forms check the origin and a per-session CSRF value. A file matched by name is searched only among the caller's own unsent files.
- An invitation link works once and expires after 7 days. Opening it only shows who sent it; the access code is set and shown after a button press, so a messenger's link preview does not use it up.
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
- For assistants: [llms.txt](https://handoff.infraworks.net/llms.txt), the [MCP server card](https://handoff.infraworks.net/.well-known/mcp/server-card.json) and the [agent skill](https://handoff.infraworks.net/.well-known/agent-skills/index.json).
