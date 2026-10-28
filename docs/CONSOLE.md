# Console

`PUBLIC_URL/console` is the operators' console: a sidebar with
Overview, Members, Assistants and Ops, server-rendered pages, and no script. It replaced the first admin
console at `/admin` (2026-10-26), which now redirects here. Code: `src/console/`.

## Who can open it

Members whose handle is in `admin_members`. The operator grants that in a terminal; the console cannot make
admins, and nobody becomes one by visiting the page:

```sh
npm run admin -- tim              # grant (the member must exist: npm run member:add -- tim)
npm run admin -- tim --revoke     # revoke; ends that admin's console sessions
```

`npm run setup` (scripts/deploy.mjs) makes the first member it seeds an admin. A server deployed with the
Deploy to Cloudflare button has no admin: `/console/setup` takes the `HANDOFF_SETUP_CODE` secret and a handle
once, makes that member the admin and shows the code (docs/DEPLOY.md). Sign in at `/console/login` with the
member handle and access code.

## Pages

- **Overview**: status of the Worker (deployed version), D1 and R2 (answer time), sign-in (members, admins,
  assistants connected, signing key) and the last cleanup; handoffs sent per day over 14 days; latency by
  tool (p50, p95, max) and tool calls ok / failed over 7 days; refused tokens and wrong sign-in codes; calls
  per member; recent activity.
- **Members**: each member with a liveness dot (seen within an hour, within 7 days, longer ago, never), last
  seen, last sign-in, assistants signed in now, calls over 7 days, and live packets sent and addressed to
  them. Add a member, reset a code, remove a member.
- **Assistants**: each assistant signed in as each member: the name it gave when it registered, the name and
  version it announced at MCP initialize, the host its sign-in returns to (`127.0.0.1` or `localhost` = an app
  on that computer), first and last seen, calls, connected or signed out. Disconnect one assistant. Also:
  refused tokens by reason, wrong sign-in codes by handle, and registrations never used.
- **Ops**: deployment (version, address, issuer, signing key, limits), database counts and applied
  migrations, files in storage by state, cleanup runs with a **Run cleanup now** button, recent problems
  (tool errors, refused tokens, wrong codes, failed cleanups), and the console's own record of who did what.

There is no packet viewer: the console never shows a title, a brief, a file name, a code or a token. A new
access code is the one exception: it is shown once, on the page right after Add or Reset.

## What the actions do

- **Add member**: creates the handle with a new code (`hf-` and 96 random bits), shown once. `team` and `all`
  are reserved: they address every member in `handoff_send`.
- **Reset code**: a new code, shown once. The old code stops, and every assistant of that member is signed out
  at once: their refresh tokens are revoked, and access tokens issued before the reset are refused. Resetting
  your own code ends your console session too. `npm run member:add -- <existing handle>` does the same.
- **Remove member**: deletes the member and their admin grant, signs out all their assistants, and revokes the
  live packets they sent or that were addressed to them, so a member added later with the same handle cannot
  read them. Packets to the whole team stay. You cannot remove yourself.
- **Disconnect** (Assistants): signs out one assistant of one member at once. Signing in again works.
- **Run cleanup now**: the hourly cleanup, run immediately.

Each action asks first on a page of its own, except Add and Run cleanup.

## How it is kept safe

- Session: a random token in a `__Host-handoff-console` cookie (Secure, HttpOnly, SameSite=Strict, Path=/),
  12 hours. D1 keeps only its sha256, bound to the member's code hash, so a code reset ends the session.
  The admin grant and the code hash are checked on every request.
- Changes are form POSTs that must carry this origin's `Origin` header and the session's CSRF value
  (sha256 of the session token, in a hidden field). Pages use `referrer-policy: same-origin`: with
  `no-referrer` a browser sends `Origin: null` and the check would refuse the form.
- Console sign-in: at most 10 attempts per 10 minutes per client IP (only a hash of the IP is stored).
- Pages: `no-store`, `noindex`, and a CSP with `default-src 'none'`, no script, `form-action 'self'` and
  `frame-ancestors 'none'`.

## Where the numbers come from

The `events` table (migration 0005) records, per request: tool calls (tool name, member, client, outcome
code, time taken), MCP initialize (the client's announced name and version), refused tokens (the reason),
sign-ins at `/authorize` (ok or wrong code), token grants, cleanup runs, and console actions. No arguments,
titles, briefs, file names, codes or tokens. Events from requests without a valid token (refused tokens,
wrong codes) are capped at 60 per minute per Worker isolate, so a flood cannot fill the table. Events are
kept 30 days.

`access_revocations` (migration 0005) holds the revocations of the last 9 hours: an access token for that
member and client issued at or before the revocation is refused (`src/auth/verify.ts`). Access tokens live
8 hours, so older rows do nothing and cleanup removes them.

Cleanup (hourly, and from Ops) also removes: expired sign-in codes, refresh tokens that expired or were
revoked more than 7 days ago, client registrations that never got a token within 7 days, ended console
sessions and login limits.

## Local run

```sh
npm run db:migrate:local
npm run member:add -- me --local
npm run admin -- me --local
npm run dev                         # .dev.vars sets PUBLIC_URL=http://localhost:8787
```

Open `http://localhost:8787/console`. `PUBLIC_URL` must be the origin you open, or the console refuses forms.

## Tests

`test/console.test.ts`: sign-in page without script and with `same-origin` referrer policy; signed-out
redirects; admin-only sign-in; cookie flags and a hashed session token; refusal of another origin; the
10-attempt limit; CSRF; add (code once, hashed, taken and reserved handles refused); reset (new code works,
old fails, assistants signed out); own reset ends the session; remove (signed out, packets revoked, not
yourself); activity recorded and shown without titles, briefs, codes or tokens; disconnect of one assistant
only; wrong sign-in code recorded; refresh refused for a removed member; cleanup from Ops prunes old events
and unused registrations and keeps used ones.
