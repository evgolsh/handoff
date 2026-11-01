# Handoff

Move work from one AI assistant to another, or to a teammate's assistant. The sender prepares a brief and attaches the original files. The recipient reads them and continues, without copying a conversation or reconstructing the context.

Runs on your own Cloudflare account: Workers, D1 and Workers KV. The default setup works on the free plan, with no payment method or R2 subscription. MIT licensed.

## Start with your own deployment

**Deploy once for yourself and your teammates, then connect each person's assistants to that same server.** You do not deploy again for a new assistant, computer or teammate.

You need:

- **Node.js 22 or newer**, npm and the Git command-line tool. The installed Wrangler package requires Node `>=22.0.0`.
- A [Cloudflare account](https://dash.cloudflare.com/sign-up). Create one first if needed.
- Your chosen Handoff username. Teammates can be added later.

No GitHub account, fork, domain name or manual database setup is needed for the CLI route. Git downloads this public repository without a GitHub sign-in.

### 1. Use Claude Code or your terminal

**With a local coding agent**, such as Claude Code, give it this prompt, replacing `tim` with your own username:

> Install https://github.com/evgolsh/handoff on my Cloudflare account. Read llms-install.md first. My Handoff username is tim; make me the first admin. Check for an existing deployment before changing anything. Run the setup, then help me sign in to the Handoff console and connect two of my assistants. Pause for my Cloudflare login and any approval prompts. Keep access codes private.

The agent needs terminal access to the computer where you keep the deployment clone. A chat without that access can guide you, but cannot run this installation for you. You still approve Cloudflare access and each assistant's connection yourself.

**Or run it yourself:** replace `tim` with **your own username before running**. If adding a teammate now, use `--members=tim,tom`, with your username first.

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim
```

Use 1 to 63 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit. `team` and `all` are reserved. Always pass `--members=...`: without it, the script seeds placeholder users `owner` and `teammate`.

**Already have a Worker named `handoff` in this Cloudflare account? Stop and check before running setup.** It can redeploy that Worker and reuse existing resources. This is not an isolated second installation. See [deployment safety and reruns](docs/DEPLOY.md#existing-deployments-and-reruns).

Setup opens Cloudflare login and consent if Wrangler is not already authenticated. For an account with Workers ready, that is normally the only Cloudflare browser step; the script creates or reuses D1 and KV, applies the schema, builds the static files, deploys the Worker, and seeds members if the database is empty. **A fresh account may also need Workers onboarding and a `workers.dev` subdomain** if setup reports that requirement; complete it in Cloudflare, then retry from the same clone. Your first seeded username becomes the Handoff admin. Setup prints your server, Connect and console URLs and the new access codes. No `HANDOFF_SETUP_CODE` is needed.

### 2. Save your code and open the Handoff console

Save the once-only access codes in a password manager before closing the terminal. Give each teammate only their own username and code, privately. Do not put codes in issues, commits or handoff briefs.

Open the printed **`/console`** URL and sign in with your first username and its access code. CLI setup already created the admin: use the console login, **not `/console/setup`**.

- **Members**: add teammates, reset lost codes, or remove access.
- **Connect an assistant**: choose an assistant and follow its setup steps.
- **Assistants**: inspect connections or disconnect one.
- **Ops**: check deployment health, cleanup and available updates.

This is the **Handoff console**, not the Cloudflare dashboard. Handoff manages people and assistant connections. Cloudflare owns the infrastructure, billing and deployment settings. Teammates need neither a Cloudflare nor a GitHub account, and ordinary members do not need console access.

### 3. Connect your assistants

Use **Connect an assistant** in the console, or open the printed **`/connect`** URL. It has per-assistant instructions and states what has been tested; support and file workflows vary by host and plan.

Add **your deployment's** MCP endpoint, ending in `/mcp`. For the fictional Acme deployment it would be `https://handoff.acme.workers.dev/mcp`; use the actual URL setup printed, not that example or the project's playground URL.

Sign each of your assistants in with **your same Handoff username and code**, and approve access. Connecting one assistant does not automatically configure all the others. Handoff does not bypass the assistant's consent or tool-approval prompts.

### 4. Try a handoff to yourself, then to a teammate

In your first connected assistant:

> Hand this off to myself: summarize what we decided, the constraints and the next step, so I can continue in my other assistant.

In a second assistant connected as the same username:

> Check my Handoff inbox and continue the handoff I just sent.

A self-handoff omits `to` or uses your own username. Check that the second assistant reads the actual packet, not just the prompt. Add files after this text-only round trip works.

For a teammate, add `tom` in **Members** if not already seeded. Share your deployment's `/connect` URL and Tom's username and code privately. Tom connects his assistant to the **same `/mcp` endpoint**, signing in as `tom`, not as you. You say "Hand this off to tom"; Tom says "Check my Handoff inbox and continue the handoff from tim."

## Later: members and updates

Keep the deployment clone: setup writes your resource IDs into `wrangler.jsonc`. Use Members for new people; rerunning setup with a longer `--members` list does **not** add them to an existing database or reset their codes.

Update from that **same clone**, preserving your `wrangler.jsonc` bindings and settings: pull the code, install dependencies, then run `npm run deploy`. See [updates and recovery](docs/DEPLOY.md#updates-and-recovery) for local-config conflicts and lost codes. Deploy applies migrations before the Worker; it does not reseed members.

## Alternative: Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://handoff.infraworks.net/deploy)

Prefer the dashboard route? The button needs a Cloudflare account **and a GitHub or GitLab account** so Cloudflare can copy the repository and configure builds. It asks for a secret named `HANDOFF_SETUP_CODE`: choose a private random value at least 12 characters long.

After deploying, open **`/console/setup`** on your new Worker, enter that setup code and your chosen username, then save the newly generated **member access code**. The setup code bootstraps the first admin; it is not the code used to connect assistants. Continue with the console, Members and Connect steps above. See the [button deployment details](docs/DEPLOY.md#deploy-button-alternative).

## Try it without deploying

[The shared playground](https://handoff.infraworks.net/join) lets you create a team and connect an assistant first. It is separate from your private deployment and capped: 10 members per team, 24-hour default packet expiry (7 days maximum), and 5 MiB files. Keep private work on your own installation.

## How it works

The assistant prepares a brief containing the purpose, decisions, constraints, next step, references and open questions. Handoff stores the brief verbatim and the original attachment bytes with a SHA-256 checksum. A packet goes to yourself, one username, or `team` for everyone on the private deployment.

| Tool | Does |
|---|---|
| `handoff_send` | Publish a brief with optional `to` and attachments. Idempotent per `idempotency_key`. |
| `handoff_inbox` | List unexpired packets, newest first. |
| `handoff_read` | Read a packet's brief and attachment list, or an attachment as text, image, or a 10-minute download URL. |
| `handoff_revoke` | Hide a packet and stop its downloads. |
| `handoff_upload_url` | Create a single-use 15-minute upload URL for a local file. |

Private-install limits: PDF, PNG, JPEG, text and Markdown; 25 MiB per file, 10 files per packet. Type is checked from the bytes. Packets expire after 30 days by default (1 hour to 90 days).

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

- [Deploy and connect](docs/DEPLOY.md): setup safety, alternative deployment, configuration and operations.
- [Console](docs/CONSOLE.md): pages and actions.
- [Development](docs/DEVELOPMENT.md): tests and a local server.
- [AI agent install guide](llms-install.md): end-to-end installation and verification.
- [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).
- [Plugin package](plugin/): packaging and host-specific notes. Use your own deployment URL when configuring a self-hosted connection.
