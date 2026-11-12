# Threadpacket

Send your work to someone else's AI assistant, with your notes and the original files.

A packet is your notes and the original files. Joe sorts out the car insurance renewal in Claude and says "send a packet to anna". Anna says "continue the packet from joe" in ChatGPT and picks up the thread with the two PDFs. You can send a packet to your partner, a teammate, or yourself in another assistant or on another computer.

- **Your notes and the files.** The brief says what you decided and what is left to do. PDFs and images go with it, byte for byte. Open a packet in Packets to read the brief and see the files.
- **You see that it arrived.** Packets shows when Anna picked it up and in which assistant, and your assistant can tell you the same.
- **Their own assistant.** Anna can use ChatGPT while Joe uses Claude. Codex, Claude Code and Hermes work too. Each person signs in with their own username.
- **Storage, not AI.** Threadpacket keeps the brief and files and deletes them when they expire. It makes no model calls and needs no API keys.

Free at [threadpacket.com](https://threadpacket.com), or open source on your own Cloudflare account for a small team that wants its files on its own infrastructure. MIT licensed. [Watch the 29-second demo](https://threadpacket.com/demo/threadpacket-demo.mp4).

## Get started

1. **Add Threadpacket to your assistant.** The server address is `https://threadpacket.com/mcp`. In Claude, [this link](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Threadpacket&connectorUrl=https%3A%2F%2Fthreadpacket.com%2Fmcp) opens the custom connector form with it filled in. For ChatGPT, Codex, Claude Code and Hermes, see [Assistant setup](https://threadpacket.com/connect).
2. **Create a team.** On the Threadpacket sign-in page that opens, choose **Create a team** and pick your username, and a team name if you like (without one, the team is named after you). You are its admin. Save the access code it shows once: your username and access code sign you in on any computer and in any assistant.
3. **Invite your partner.** Ask your assistant "invite anna to Threadpacket" and send her the link it gives you. She opens it, gets her own access code and connects her assistant.
4. **Send a packet.** "Send a packet to anna with the two PDFs." She says "Continue the packet from joe."

The hosted service is free: up to 10 people per team, files up to 25 MiB, packets deleted after 7 days by default (30 at most). See [Privacy](https://threadpacket.com/privacy). Assistants can read the whole setup at [llms.txt](https://threadpacket.com/llms.txt).

## Your own private server

Install it once for your whole team. It runs on Workers, D1 and KV in your Cloudflare account, on the free plan with no card. Teammates only sign in, and a new assistant, computer or teammate needs no new install. Your briefs and files stay on your account, and packets are kept 30 days by default.

There are three ways to install. Each one creates the same private server.

### From your browser

You need a **Cloudflare account** and a **GitHub or GitLab account**. Cloudflare copies the code there, creates the database and file store, and deploys your server.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://threadpacket.com/deploy)

Set `THREADPACKET_SETUP_CODE` to a code of 12 or more characters. After the deploy, open `/console/setup` on your new server and enter it with your username. See [Deploy button details](docs/DEPLOY.md#from-your-browser).

### Ask a coding assistant

Claude Code, Codex, Gemini CLI, Hermes or any assistant that can run commands on your computer. Give it this request with your own usernames:

> Deploy https://github.com/evgolsh/threadpacket to my Cloudflare account. Follow llms-install.md. My username is tim; add tom as a teammate. Ask me to approve the Cloudflare login, then help me connect my assistants.

You approve the Cloudflare login. No GitHub account needed. The steps it follows are in [llms-install.md](llms-install.md).

### Run it yourself

You need **Git**, **Node.js 22+** with npm, and a **Cloudflare account**. No GitHub account needed.

```sh
git clone https://github.com/evgolsh/threadpacket.git
cd threadpacket
npm install
npm run setup -- --members=tim,tom
```

Replace `tim,tom` with your usernames, yours first. Setup creates the storage, deploys the server and makes you the admin. It opens the Cloudflare login if needed, then prints your server, `/connect` and `/console` URLs and the access codes.

- A username has 1 to 63 lowercase letters, digits, dots, underscores or hyphens, and starts with a letter or digit. `team` and `all` are reserved.
- Always pass `--members=`. Without it, setup creates placeholder users `owner` and `teammate`.
- **If the account already has a Worker named `threadpacket`, check it first.** Setup redeploys it and reuses its resources. See [existing deployments and reruns](docs/DEPLOY.md#existing-deployments-and-reruns).
- A new Cloudflare account may need its `workers.dev` address registered first. Setup links to the page. Register it, then run setup again from the same clone.

## After you install a private server

1. **Sign in to your Threadpacket console.** After a browser deploy, `/console/setup` creates your admin account and shows your access code once. After a terminal install, sign in at the printed `/console` URL with the access code setup printed. Assistants sign in with access codes, never with the setup code. Keep access codes in a password manager, and out of issues, commits and briefs.
2. **Connect your assistant.** Open your server's `/connect` page and follow the steps for your assistant. Everyone uses the same server and its `/mcp` address, for example `https://threadpacket.acme.workers.dev/mcp`, and signs in with their own username. To upload a file from a phone or another folder, sign in at `/packets` (see [Packets](#packets)).
3. **Add your teammates.** Ask your assistant "invite tom to Threadpacket", or create their usernames in **Members**. Each teammate gets a link with their username, access code and setup steps. Teammates need no Cloudflare or GitHub account.
4. **Send a packet.** Say "Send myself a packet" in one assistant, then "Continue my packet" in another. To send to your teammate, say "Send a packet to tom". Your teammate says "Continue the packet from tim".

The [console guide](docs/CONSOLE.md) covers Members, assistant connections and the Ops page.

## Packets

Each member can open `/packets` on your server and sign in with their username and access code. Packets has three parts:

- **Ready to send:** files they uploaded that no assistant has sent yet, each with the sentence to tell their assistant and a Copy button.
- **New for you:** packets sent to them, or to the team, that they have not picked up in an assistant or opened here.
- **Sent and received:** everything they sent or received, newest first, with All, Received and Sent filters. Each row shows who it went to or came from, its files, and its pickup status. The expiry shows only when it is less than 2 days away.

A packet is picked up when a recipient's assistant first reads it, and opened when the recipient first opens it in Packets. The sender sees both for each recipient, with the assistant's name and the time, such as "Picked up by anna in ChatGPT · 2 h ago". For a packet to the team, the sender sees who has not picked it up yet. A recipient sees only their own. The sender's own reads change nothing. Their assistant gets the same status from `threadpacket_inbox`, so "Did anna get the tax letter?" has an answer.

Opening a packet (`/packets/<pk_id>`) shows its status, the assistant prompt to continue it, its brief and its files in the page: PDFs in the browser's viewer, images, text and Markdown, each with Open and Download. The sender can revoke it there: no one can open it again, in an assistant or in Packets. What a recipient's assistant already read stays in that chat. An uploaded file opens the same way (`/packets/file/<at_id>`), for its uploader only.

There they upload a file for their assistant to send or read, such as a scan on their phone: "Send a packet to anna with lease.pdf", or "Read lease.pdf from Threadpacket" to work on it in that chat. An uploaded file is visible only to its uploader, in Packets and in their own assistants, until an assistant sends it, and is deleted if it is not sent within 7 days. If they already have an unsent file with that name, the new one gets a number, such as `lease (2).pdf`.

Then they say "Send a packet with lease.pdf". The assistant attaches the file by its name. If no file or more than one file has that name, nothing is sent and the assistant asks which one.

Everyone signs in once, at `/login`, with their username and access code (no team: the code says which account it is), and every page knows them: the left menu has Packets, Assistant setup, and for an admin the team pages of the console. On the public pages, Dashboard takes the place of Sign in. A session lasts 30 days and is renewed while used. The account menu at the bottom of the left menu switches between accounts signed in on this browser, signs in to another, and signs out.

## Updates

Keep the clone you installed from: setup writes your resource IDs into `wrangler.jsonc`. To update, pull the code in that clone, run `npm install`, then `npm run deploy`. Deploy applies database migrations, then deploys the Worker. It does not change members.

Add new people in Members. Running setup again with a longer `--members` list does not add them to an existing server. See [updates and recovery](docs/DEPLOY.md#updates-and-recovery) for lost codes and local changes.

## How it works

Threadpacket is storage with a sign-in. The assistant writes a brief: the purpose, decisions, constraints, next step, references and open questions. Threadpacket stores it word for word, with the original files and a SHA-256 checksum for each. A packet goes to yourself, to one username, or to `team` for everyone in your team.

| Tool | Does |
|---|---|
| `threadpacket_send` | Publish a packet (brief with optional `to` and attachments, by id or by the name of an unsent file). Idempotent per `idempotency_key`. |
| `threadpacket_inbox` | List unexpired packets, newest first, with who picked each one up, and your unsent files. |
| `threadpacket_read` | Read a packet's brief and attachment list, or an attachment as text, image, or a 10-minute download URL. Without a packet, open one of your own unsent files the same way. |
| `threadpacket_revoke` | Hide a packet and stop its downloads. |
| `threadpacket_upload_url` | Create a single-use 15-minute upload URL for a local file. |
| `threadpacket_invite` | For a team admin: add a teammate and get a one-time invitation link, valid 7 days. |

Files: PDF, PNG, JPEG, text and Markdown, up to 25 MiB each and 10 per packet. The type is checked from the bytes. On a private server packets expire after 30 days by default (1 hour to 90 days); on the hosted service after 7 days (1 hour to 30 days).

On Cloudflare's free plan a private server has room for 100,000 requests and 1,000 new files a day, and 1 GB of stored files. Threadpacket has no paid tier.

## Security

- The Worker is its own OAuth 2.1 server. Only listed members can sign in, using PBKDF2-hashed access codes. No third-party identity provider or public sign-up on a private install.
- Identity comes from the signed access token (`sub`, ES256, issuer `PUBLIC_URL`, audience `PUBLIC_URL/mcp`). Clients register via RFC 7591 or an HTTPS client metadata document, with redirect validation and PKCE S256. OAuth authorization codes last 10 minutes, access tokens 8 hours, rotating refresh tokens 30 days.
- A packet is readable by its sender, its named recipient, or every member for a team packet. Everyone else gets "not found". Only the sender revokes a team packet.
- Attachments are readable only through a live packet. Download URLs last 10 minutes and packet access is rechecked on each fetch.
- Browser sessions (`/login`; cookie `__Host-threadpacket-session`, HttpOnly, SameSite=Strict, up to five accounts per browser, 30 days renewed while used, stored in D1 only as hashes). The console checks the admin grant on every request. Forms check the origin and a per-session CSRF value. A file matched by name is searched only among the caller's own unsent files.
- An invitation link works once and expires after 7 days. Opening it only shows who sent it; the access code is set and shown after a button press, so a messenger's link preview does not use it up.
- Resetting a member's access code or removing them signs out their assistants. Disconnect in the console signs out one connection.
- Server-side file imports are off until `IMPORT_HOST_ALLOWLIST` names allowed hosts. Imports require HTTPS and public DNS, refuse redirects and bound the size. Signed URLs are not stored or logged.
- The Worker does not implement a general per-request rate limit. See [Operations](docs/DEPLOY.md#operations) for optional Cloudflare zone-level protection.

## Update check

Once a day the Worker asks `threadpacket.com` for the latest version and shows it on the Ops page. It sends a random instance ID, the version, and two size buckets (members: 0, 1, 2-5, 6+; packets in the last 30 days: 0, 1-9, 10-49, 50+). Nothing else. Turn it off with `THREADPACKET_UPDATE_CHECK=off`.

## Docs

- [Deploy and connect](docs/DEPLOY.md): setup safety, the Deploy button, configuration and operations.
- [Console](docs/CONSOLE.md): pages and actions.
- [Development](docs/DEVELOPMENT.md): tests and a local server.
- [Install guide for coding assistants](llms-install.md): installation and checks, step by step.
- [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).
- [Plugin package](plugin/): packaging and host-specific notes. Use your own server's URL when you connect a self-hosted install.
- For assistants: [llms.txt](https://threadpacket.com/llms.txt), the [MCP server card](https://threadpacket.com/.well-known/mcp/server-card.json) and the [agent skill](https://threadpacket.com/.well-known/agent-skills/index.json).
