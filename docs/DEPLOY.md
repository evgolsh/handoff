# Deploy and connect

Start with the [README walkthrough](../README.md#install): deploy once, save codes, sign in to the Handoff console, connect your assistants, then invite teammates. A local coding agent can follow the [agent guide](../llms-install.md).

Handoff runs on Cloudflare Workers with D1 for members, packets and OAuth state, and Workers KV for files by default. The Worker is its own OAuth 2.1 server; no external identity provider is needed. Default private installs need no payment method or R2 subscription, within Cloudflare's free-plan limits.

## CLI setup

Prerequisites: **Node.js 22+**, npm, Git CLI and a Cloudflare account. Wrangler 4.152.0 declares Node `>=22.0.0`. No GitHub account or fork is required to clone this public repository.

Replace `tim` with your own username, first in the list. Add `tom` only if you want to seed that teammate now:

```sh
git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim,tom
```

For yourself only, use `--members=tim`. Always supply the `--members=...` form: omitting it seeds the script's placeholder users `owner,teammate`. Usernames must be unique, 1 to 63 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit; `team` and `all` are reserved.

### What setup does

[`scripts/deploy.mjs`](../scripts/deploy.mjs):

1. Checks `npx wrangler whoami`; opens `npx wrangler login` if authentication is needed. You sign in and approve Cloudflare access yourself.
2. Reuses the configured D1 database if its ID belongs to the selected account. Otherwise it reuses or creates that account's database named `handoff` and writes its ID into `wrangler.jsonc`.
3. Does the same for the configured `FILES` KV namespace, falling back to `handoff-FILES`. An explicitly configured R2 bucket takes a separate path; R2 is not needed for the default install.
4. Applies D1 migrations, builds static assets and deploys the Worker.
5. **Only if the members table is empty**, seeds the requested usernames and grants the first valid seeded username admin access.
6. Prints the deployment's `/mcp`, `/connect` and `/console` URLs, and any newly created access codes **once**.

Save codes privately in a password manager. Open the printed `/console` URL and sign in with your first username and code. **Do not use `/console/setup` or set `HANDOFF_SETUP_CODE` for this CLI flow**: the admin already exists.

For an account with Workers ready, Cloudflare login/consent is normally the only Cloudflare browser step; resource provisioning is automated. **Fresh accounts may also need Workers onboarding and a `workers.dev` subdomain.** Setup captures Wrangler's deploy output, so interactive subdomain-registration prompts may not be visible. If deployment reports this requirement or stops there, complete Workers onboarding in Cloudflare, then retry from the same clone with its saved bindings. Do not assume a fully unattended cold-account install. Account creation, account selection and consent remain your responsibility; an agent cannot approve these on your behalf.

### Remote terminal or headless coding agent

Sign Wrangler in before running setup if its normal localhost browser callback cannot reach the terminal host:

```sh
npx wrangler login --device
npx wrangler whoami
npm run setup -- --members=tim
```

Open the URL and complete the device-code approval yourself. The installed Wrangler 4.152.0 supports `--device` (verify with `npx wrangler login --help` if using a different version). Setup itself does not select device login; it uses normal `wrangler login` when unauthenticated. `--browser=false` suppresses browser launch but does not replace the localhost callback with device authentication.

### Existing deployments and reruns

**Stop before setup if this account already has a Worker named `handoff`, or resources named `handoff` / `handoff-FILES`, unless you intend to reuse that deployment.** Setup is not an isolated-instance wizard and does not ask before redeploying an existing Worker. Check the selected account, Worker name and bindings first. If you have several Cloudflare accounts, resolve which one Wrangler will use before provisioning anything.

- Setup writes resource IDs into `wrangler.jsonc`. Keep that clone and its config; do not replace the bindings with the repository's example values.
- `--members` is initial seeding, not member synchronization. With existing members it adds nobody, resets no codes and grants no new admin. Use Members, `member:add`, or `admin` instead.
- Rerunning setup redeploys and applies pending migrations. It is not a database reset and does not reprint old codes.
- A partially failed seed may leave members but no admin. Inspect the failure; use `npm run admin -- tim` to grant an existing intended member access. Reset a lost code separately, with consent.
- Do not assume changing only the Worker name creates an independent install: the script's fallback database and KV names are fixed. Review a separate configuration before attempting multiple deployments in one account.

## Console, members and assistant connections

The **Handoff console** at your deployment's `/console` manages people, connections and service health. The **Cloudflare dashboard** manages the underlying account, resources, billing, domains and build settings. Everyday Handoff use does not require opening Cloudflare.

In the Handoff console:

1. Open **Members** to add a teammate or manage codes. The first CLI-seeded member is the admin; ordinary members can connect assistants but cannot sign in to the admin console.
2. Open **Connect an assistant** (`/console/connect`). Teammates use the public `/connect` guide without needing admin access.
3. Add **your own deployment URL ending in `/mcp`**, sign in with your Handoff username and code, and approve access in each assistant. All of one person's assistants use that person's same username. Different people get different usernames and codes on the same deployment.
4. Send a self-handoff in one assistant and read it in a second connected as you. Then send to a teammate's username. The [README](../README.md#after-you-install) has prompts.

The Connect page records tested hosts and limitations. Do not infer universal MCP-host or file-transfer compatibility. Each host controls its own connector availability and approval prompts; Handoff cannot automate those approvals.

Terminal alternatives, from the deployment clone:

```sh
npm run member:add -- tom
npm run admin -- tim
```

`member:add` creates a new member **or rotates an existing member's code**. A reset invalidates the old code and signs out that member's assistants; resetting your own code also ends your console session. Give each person only their own code privately. `admin` grants console access to an existing member; `npm run admin -- tim --revoke` removes it. See [Console](CONSOLE.md) for the actions and access rules.

### Host-specific notes

Use `/connect` on your deployment for copyable steps and status. For Claude Code, the command is `claude mcp add --transport http --scope user handoff YOUR_URL/mcp`, followed by `/mcp` and **Authenticate**; replace `YOUR_URL` with your actual HTTPS origin. The [agent guide](../llms-install.md#4-connect-assistants) includes CLI commands for other hosts.

- Claude web/desktop file uploads also need your server hostname in Claude's Settings > Capabilities > allowed domains. Without that, uploads can fail with 403 even when text handoffs work.
- ChatGPT's custom MCP server/plugin availability depends on the plan or workspace. Follow the Connect page for the ChatGPT and Codex app route, rather than assuming the Codex CLI command configures the app.
- Repository plugin manifests may point at the project's hosted endpoint. Replace that with your own `/mcp` URL before using them for a private install; see [the plugin package](../plugin/README.md).

## Deploy Button alternative

[Deploy to Cloudflare](https://handoff.infraworks.net/deploy) is the secondary, dashboard-based route. It needs a Cloudflare account **and a GitHub or GitLab account**. Cloudflare copies the repository, provisions bindings and runs `npm run deploy` through its build flow.

1. Set `HANDOFF_SETUP_CODE` in the deploy form to a private random secret of at least 12 characters. This field is described in [`.dev.vars.example`](../.dev.vars.example).
2. After deployment, open **your Worker's `/console/setup`**. Enter that setup code and your chosen Handoff username.
3. Save the new **member access code**, shown once, and continue into the Handoff console. Use that member code for future console and assistant sign-ins, not the setup code.
4. Add teammates in Members and follow Connect as above. They do not deploy again.

The setup page works only while there is no admin and the configured secret is at least 12 characters. After an admin exists it redirects to console login. If the secret was omitted, follow the setup page's Cloudflare secret instructions or use the CLI member/admin commands from a clone configured for this deployment. Do not point an unconfigured fresh clone at existing data.

## Configuration

### Files

Default files live in Workers KV (`FILES`). Cloudflare's free allowance includes 1 GB storage and 1,000 writes per day; KV's 25 MiB value limit matches Handoff's per-file limit. Free-plan quotas still apply.

R2 is optional for larger workloads, not part of onboarding. It requires enabling R2 with a payment method. To use it, create a bucket and bind it as `BLOBS` instead of, or alongside, KV:

```jsonc
"r2_buckets": [{ "binding": "BLOBS", "bucket_name": "handoff-attachments" }]
```

`FILE_STORE=kv` or `FILE_STORE=r2` selects explicitly. If unset, the Worker uses R2 when bound, otherwise KV. Switching stores does not migrate existing files: copy them deliberately or let their packets expire first. The common adapter contract is `BlobStore` in [`src/store/blobs.ts`](../src/store/blobs.ts).

### URL and optional variables

By default `PUBLIC_URL` is unset and the Worker uses the request's origin as its OAuth issuer. `wrangler.jsonc` has no required `vars`. Optional settings can be kept under `vars` in your deployment config; preserve them on updates.

| Setting | Purpose |
|---|---|
| `PUBLIC_URL` | Pin one public HTTPS origin, with no trailing slash, when using several addresses. Changing it signs assistants out. |
| `FILE_STORE` | Select `kv` or `r2`. |
| `MAX_ATTACHMENT_BYTES` | Per-file limit, default 25 MiB. |
| `IMPORT_HOST_ALLOWLIST` | Allow server-side file imports from specified hosts; empty disables imports. |
| `HANDOFF_UPDATE_CHECK=off` | Disable the daily update check. |
| `HANDOFF_ENV=dev` | Local development only, never production. |

For ChatGPT file imports, an `import_rejected` error may name the uncontacted host because imports are disabled. Review that host before adding it, or a deliberate `*.` parent-domain pattern, to `IMPORT_HOST_ALLOWLIST` and redeploying. Do not broadly allow arbitrary hosts just to make a test pass.

### Sign-in and schema

The Worker publishes OAuth metadata, supports RFC 7591 client registration and HTTPS client metadata documents, uses PKCE S256, and issues ES256 access tokens (8 hours) with rotating refresh tokens (30 days). The issuer is the public origin; the audience is that origin plus `/mcp`. HTTPS client metadata is fetched with no redirects, a 5 KB limit and a 5-second timeout, and cached for a day. Loopback redirect ports may vary under RFC 8252.

The signing key is generated on first use and stored in D1 (`oauth_keys`) unless `OAUTH_SIGNING_JWK` supplies an ES256 private JWK. Replacing the key or changing the public origin invalidates existing assistant authentication.

Deploy applies D1 migrations before the Worker. New databases start from `migrations/0001_schema.sql`; later changes use subsequent numbered migrations. Older installations can retain their historical migration records. Do not delete migration history to force a retry.

## Updates and recovery

Use the **same deployment clone**:

1. Inspect `git status` and `git diff -- wrangler.jsonc`. Preserve your resource IDs, Worker name, variables and any other local configuration in a private backup or a deliberate stash before pulling.
2. Run `git pull --ff-only`. If Git reports local changes or a conflict, stop and reconcile them; do not discard your configuration or blindly accept upstream bindings. If you stashed the config, restore it and inspect the result before deploying.
3. Run `npm install`, then `npm run deploy`.
4. Open your console's Ops page and check the version and health. Confirm an existing assistant can still read its inbox.

`npm run deploy` builds assets, applies migrations and deploys using your existing bindings. It does not provision a fresh database or reseed members. The console's Ops page reports available updates.

For a lost access code, reset it in Members or run `npm run member:add -- tim` from the configured clone. This is an intentional rotation, not a way to retrieve the old code. For a failed setup, read the failing Wrangler step, check account and bindings, and repair that cause. **Teardown is not a normal retry step.**

### Optional destructive removal

Only when you intend to permanently remove the deployment, run `npm run teardown` from its configured clone. It deletes the named Worker, D1 database and KV namespace or R2 bucket from the authenticated account. Members, packets and files are lost. It asks you to type the Worker name; Wrangler also asks before deleting the Worker. Already-missing resources are skipped; other failures stop the run. Review the account and all targets before confirming. This is not required for updates, new members or code resets.

## Operations

- Cleanup runs hourly at minute 17: staged/failed uploads older than 24 hours, ready unattached files after 7 days, packets expired or revoked over 7 days ago, and expired tickets. Each run is bounded to 5 batches of 200 rows per kind; backlog continues on the next run. Ops can trigger cleanup too.
- The daily update check sends a random instance ID, version and coarse usage buckets, as described in [the README](../README.md#update-check). `HANDOFF_UPDATE_CHECK=off` disables it. `UPDATE_CHECK_URL` changes the receiver; `UPDATE_CHECK_RECEIVER=1` is for an intentional receiving deployment.
- `HANDOFF_MODE=control` belongs to the project's shared playground, adding team signup, team consoles and operator views. Leave it unset for a private installation.
- Invocation logs are disabled because URLs can contain upload/download tickets. Application errors use route templates, not signed URLs. Console activity does not expose briefs, filenames, codes or tokens.
- Limits include 25 MiB per file, 10 files per packet and 50 unattached files per account. The Worker has no general per-request rate limiter. If serving through a Cloudflare zone you control, consider a WAF rate-limiting rule for `/mcp` and `/v1/*`, for example 120 requests per minute per IP, subject to your plan. Zone-level WAF configuration is not a required CLI setup step and does not imply coverage of a bare `workers.dev` URL.
- Cloudflare's bot filter can return 403/error 1010 to some default HTTP clients before the Worker runs. If no Worker event appears, check this before diagnosing member authentication.

For read-only deployment checks, replace `YOUR_URL` below with the actual HTTPS origin:

```sh
curl YOUR_URL/.well-known/oauth-protected-resource
curl YOUR_URL/.well-known/oauth-authorization-server
curl -i -X POST YOUR_URL/mcp
```

The metadata should name your own origin; an unauthenticated MCP POST should return 401 with a `WWW-Authenticate` header referencing resource metadata. A GET on `/mcp` returns 405: the Worker keeps no session and sends no server-initiated messages, and that answer stops MCP clients from reopening an event stream every second. These checks alone do not prove an authenticated handoff works.
