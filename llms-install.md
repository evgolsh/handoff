# Handoff install guide for local coding agents

Use this guide when asked to deploy Handoff into the user's Cloudflare account and connect their assistants. The main route is **one CLI deployment, then the Handoff console and assistant sign-ins**, not a Deploy Button or a new deployment for every person.

You need command execution on the computer where the deployment clone will be kept. If this chat has no such access, say so and give the user the [README terminal steps](README.md#1-use-claude-code-or-your-terminal). Do not claim to have installed anything. Running on a remote computer is possible, but requires the remote Cloudflare login flow below and deliberate retention of that clone.

## 1. Establish intent and prerequisites

Before creating or changing cloud resources, confirm any answers not already supplied:

1. **The user's own Handoff username**, explicitly first in the initial list. Ask for teammates only if they want to seed them now; one username is enough. For the fictional Acme example, `tim` is the owner and `tom` is a teammate. Never infer the owner from a computer login or reuse placeholder users.
2. **The Cloudflare account to deploy into**, whether an account already exists, and whether it already contains a Handoff deployment. If not registered, the user creates a free account at https://dash.cloudflare.com/sign-up.
3. Permission to provision or reuse the intended Worker, D1 database and KV namespace. If a Worker called `handoff` already exists, **stop and resolve whether updating it is intended**. Also check for existing configured resources or the fallback names `handoff` and `handoff-FILES`.

Prerequisites are Git CLI, **Node.js 22+** and npm. The installed Wrangler 4.152.0 package declares `engines.node: >=22.0.0`; Node 20 is insufficient. Verify the environment rather than trusting an old global Wrangler:

```sh
git --version
node --version
npm --version
```

The default Workers + D1 + KV deployment can use Cloudflare's free plan without a payment method or R2 subscription. Do not enable R2 or ask the user to add a card for this path. No GitHub account, fork or GitHub authorization is needed to clone the public repository.

### Safety before setup

Read `scripts/deploy.mjs`, `package.json` and `wrangler.jsonc` in the actual checkout before executing. Use an existing deployment clone when updating, rather than making a fresh clone with different bindings. Inspect local changes and preserve them.

Validate usernames **before** the script deploys:

- 1 to 63 lowercase characters, starting with a letter or digit, then letters, digits, `.`, `_` or `-`.
- No `team` or `all`; no blanks or duplicates.
- The user's own username must be first and valid. The script skips invalid entries and grants admin to the first entry it successfully seeds.

Always use **`--members=tim,tom` with the equals sign**, substituting the confirmed usernames. The script does not parse `--members tim,tom`. Omitting the option seeds `owner,teammate`; do not use that default. The script has no dry-run mode: **do not run `npm run setup -- --help` to inspect options**, because it still runs the setup.

Do not assume setup prompts for an account, Worker name or resource-collision confirmation. If Wrangler can access multiple accounts, resolve the intended account/configuration before provisioning. If you cannot establish the target safely with read-only inspection, ask the user rather than guessing. Changing only the Worker name does not guarantee isolation because fallback resource names are fixed.

## 2. Clone, authenticate and deploy

For a new installation, after confirming the scope:

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
```

Check the repository-installed tooling:

```sh
node -p 'JSON.stringify(require("./node_modules/wrangler/package.json").engines)'
npx wrangler login --help
npx wrangler whoami
```

### Cloudflare authorization

For a local terminal, setup checks `whoami` and opens `wrangler login` if needed. The user signs in to their Cloudflare account and approves the requested access in the browser. An existing valid Wrangler login is reused. An agent can run commands and explain prompts, **not approve consent or invent credentials**.

For a remote/headless terminal, pre-authenticate on that terminal:

```sh
npx wrangler login --device
npx wrangler whoami
```

Ask the user to open the displayed verification URL and approve the displayed device flow privately. Installed Wrangler 4.152.0 supports `--device`; check help before recommending it for a different version. `--browser=false` only disables auto-opening the browser; it still uses the callback flow unless device mode is selected. Setup's automatic login is plain `wrangler login`, so pre-login is necessary when its localhost callback will not work.

Do not put Cloudflare login secrets, tokens or approval codes in repository files, handoff packets or a final report. Do not replace a blocked login with an unapproved API token or an unrelated account. Account creation and Cloudflare account-specific requirements remain manual.

### Run setup

For an owner named `tim`:

```sh
npm run setup -- --members=tim
```

For owner `tim` and teammate `tom`, use `npm run setup -- --members=tim,tom` instead. Run only the confirmed variant, not both.

The script:

1. Checks Cloudflare authentication.
2. Reuses the configured D1 ID if found in the account; otherwise reuses or creates D1 `handoff`, writing its ID to `wrangler.jsonc`.
3. Reuses the configured KV namespace if found; otherwise reuses or creates `handoff-FILES`, writing its ID to the config. R2 is used only when explicitly configured and is not the default route.
4. Applies the schema via D1 migrations, builds fonts/demo assets and deploys the Worker.
5. Checks the members table. **Only if empty**, seeds the requested members and grants the first valid seeded member console admin access.
6. Prints the live server `/mcp`, guide `/connect` and admin `/console` URLs, plus newly generated member access codes **once**.

Use the actual output URL. The script can fall back to a placeholder if it cannot parse a `workers.dev` URL; that fallback is not proof of a live deployment. Resolve the real address before proceeding.

A completed CLI install does **not** need `HANDOFF_SETUP_CODE` or `/console/setup`. Do not send the user through the Deploy Button's first-admin bootstrap.

### Failure and rerun rules

- Inspect the failed step and its Wrangler output. Do not claim success just because the Worker deployed; member seeding and the admin grant happen afterward.
- A fresh Cloudflare account may need Workers onboarding and a `workers.dev` subdomain. Setup captures deploy stdout/stderr, which can hide Wrangler's interactive registration prompts. If it fails or stalls at this requirement, ask the user to finish Workers onboarding in Cloudflare, then retry from the same clone with its saved bindings. Do not promise zero-dashboard or unattended cold-account setup.
- With a nonempty members table, `--members` does not add usernames, rotate codes or grant an admin. A normal rerun does not reset data and does not print existing codes.
- If an interrupted seed left members but no admin, grant the intended existing owner access with `npm run admin -- tim`. If a code was lost, ask before rotating it with `npm run member:add -- tim`; this signs out that member's existing assistants.
- If a read/check failed, do not assume the database is empty or absent. Inspect it before retrying provisioning or seeding.
- Do not run `npm run teardown` as a retry. It permanently deletes resources and their data. Only use it after a separate, explicit deletion request and confirmation of all targets.

## 3. Save credentials and enter the Handoff console

Have the user save each once-only member access code in a password manager before closing the terminal. Prefer the private terminal/password-manager flow over echoing credentials into an agent chat. Never put codes in source control, public messages, logs you publish, or handoff briefs. Share only a person's own username and code with that person.

Open **the printed `/console` URL**, which leads to console login. The user signs in with the first seeded username and its member access code. They should see:

- **Members** for adding teammates and managing access codes.
- **Connect an assistant** (`/console/connect`) for their assistant setup.
- **Assistants** for connections and disconnection.
- **Ops** for deployment health and updates.

This is Handoff's console, not Cloudflare's dashboard. Cloudflare owns infrastructure, account settings and billing. Handoff owns membership and assistant connections. Ordinary teammates need neither Cloudflare accounts nor console admin access; use the public `/connect` page for them.

If console sign-in fails, check the username, code and admin grant. Do not silently reset a code, create another deployment or invent a bootstrap secret.

## 4. Connect assistants

Use `/console/connect` as the owner, or the deployment's public `/connect` guide. It has host-specific instructions, compatibility status and warnings. Choose the user's actual host; a CLI command for Codex does not configure every Codex app route, and a connector visible in one plan may not be available in another.

**Every connection must use the user's own deployment URL ending in `/mcp`**, not `https://handoff.infraworks.net/mcp` or a copied example. In the commands below, `https://handoff.acme.workers.dev` is fictional: replace it with the verified output origin.

### Claude Code

```sh
claude mcp add --transport http --scope user handoff https://handoff.acme.workers.dev/mcp
```

Then the user opens `/mcp` in Claude Code, selects **handoff**, chooses **Authenticate**, signs in with their own Handoff username and access code, and approves access.

### Hermes Agent

```sh
hermes mcp add handoff --url https://handoff.acme.workers.dev/mcp --auth oauth
hermes mcp login handoff
```

Start a new chat or run `/reload-mcp` after sign-in. A remote gateway has its own OAuth reachability considerations; follow the deployment's Connect page and the host's instructions rather than assuming the local browser flow works there.

### Codex CLI

```sh
codex mcp add handoff --url https://handoff.acme.workers.dev/mcp
codex mcp login handoff
```

Start a new Codex chat after approval. For the Codex app, use the route described on `/connect`, not an assumption that this CLI configuration carries over.

### Claude web/desktop and ChatGPT

Follow their tabs on `/connect`. Connector/plugin availability depends on the host and plan. Claude file uploads require the deployment hostname in Claude's allowed domains under Settings > Capabilities. ChatGPT file imports may need a reviewed `IMPORT_HOST_ALLOWLIST`; see [deployment configuration](docs/DEPLOY.md#url-and-optional-variables).

Check for an existing MCP entry named `handoff` before changing client configuration; do not silently overwrite a connection to another deployment. All of the user's assistants sign in as **that user**, not a teammate. Each host's sign-in, consent and tool approvals remain manual. Do not promise universal compatibility or automatic background delivery.

## 5. Verify an actual self-handoff across assistants

After connection, check that the host exposes `handoff_send`, `handoff_inbox`, `handoff_read`, `handoff_upload_url` and `handoff_revoke`.

Begin with text, then test files if requested:

1. In assistant A, signed in as the owner, send a small distinctive brief to self: omit `to`, or set it to the owner's username. Use a fresh `idempotency_key`. Record the returned `packet_id`.
2. In **a different connected assistant B**, signed in as the same owner, call `handoff_inbox`, then `handoff_read` on that packet. Verify the returned brief matches what A sent. The user can say: "Check my Handoff inbox and continue the handoff I just sent."
3. After confirming receipt, revoke the disposable test packet with `handoff_revoke` and check it no longer appears in the inbox.

If you can access only one assistant, perform the send/inbox/read round trip there, but label it **single-client verification**. Give the user the second-assistant prompt and report that cross-assistant verification is still pending. Do not claim it passed without actual output from B.

For a requested file test, use a harmless file the user selected, upload it with `handoff_upload_url`, send its attachment ID and read it on the receiving assistant. Verify content or checksum; do not claim text-only verification proves files. File workflows differ by host.

## 6. Add a teammate without another deployment

In the Handoff console's **Members**, add `tom` if not already seeded. Save the one-time code and privately share:

- The **same deployment's `/connect` URL** and `/mcp` endpoint.
- The teammate's username and their own access code.
- "Connect your assistant and sign in as yourself. You do not need a Cloudflare account or another deployment."

The owner sends: "Hand this off to tom." Tom asks his assistant: "Check my Handoff inbox and continue the handoff from tim." Verify with Tom if testing this path; never claim receipt based only on a successful send.

For terminal administration in the configured clone:

```sh
npm run member:add -- tom
npm run admin -- tim
```

The first command adds a member **or resets an existing member's code and signs out their assistants**. Check first and get approval for a reset. The second grants an existing member console access; teammates normally do not need that grant. Use `npm run admin -- tim --revoke` only for an intentional admin revocation.

## 7. Updates and alternative installation

Keep the same deployment clone and preserve `wrangler.jsonc`: it now contains the user's resource IDs and may include custom settings. Before updating, inspect `git status` and `git diff -- wrangler.jsonc`; privately back up or deliberately stash local configuration. Pull with `git pull --ff-only`, restore/reconcile the configuration without accepting upstream resource IDs blindly, run `npm install`, then `npm run deploy`. Check Ops and an existing assistant connection afterward. See [updates and recovery](docs/DEPLOY.md#updates-and-recovery).

The [Deploy Button](docs/DEPLOY.md#deploy-button-alternative) is a secondary route for a user choosing Cloudflare's dashboard/Git integration. It needs GitHub or GitLab as well as Cloudflare, and a `HANDOFF_SETUP_CODE` secret of at least 12 characters. Only that route uses `/console/setup` to create the first admin and reveal a separate member access code. Do not mix this bootstrap into a successful CLI install.

## Completion report

Report briefly:

- The verified deployment origin, console URL and Connect URL, and the owner's username. Do not repeat secrets.
- Which assistants are connected and which manual approvals remain.
- What actually passed: deployment metadata, console sign-in, single-client round trip, cross-assistant read and/or file test. Distinguish untested paths.
- Where the deployment clone is kept, the requirement to preserve its config, and how to add teammates through Members.

A live Worker alone is not end-to-end onboarding. If you cannot complete a manual step, state exactly what is waiting for the user rather than claiming the installation and connections are finished.
