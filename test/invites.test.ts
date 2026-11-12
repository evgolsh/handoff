import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { verifyMemberCode } from "../src/auth/builtin";
import { base64url } from "../src/domain/ids";
import { ORIGIN, call, errorText, expectOk, token } from "./helpers";

/**
 * The two ways a new person starts on the hosted service without a separate sign-up page: an admin's assistant
 * calls handoff_invite and sends the link, or a new person creates a team on the sign-in page their assistant
 * opened, then continues the same OAuth request.
 */
const ctl = { ...env, THREADPACKET_MODE: "control" };
const uid = () => crypto.randomUUID().slice(0, 6);
const ip = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}-${uid()}`;
const fetchAs = (e: typeof env, path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), e, createExecutionContext());
const post = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip() },
  body: new URLSearchParams(fields),
});

async function seedTeam(team: string, admin: string) {
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO tenants (slug, name, created_at, members_cap) VALUES (?, ?, ?, 10)").bind(team, team, at),
    env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES (?, 's', 'h', ?)").bind(`${team}/${admin}`, at),
    env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES (?)").bind(`${team}/${admin}`),
  ]);
}

describe("threadpacket_invite", () => {
  it("an admin invites a teammate; the link shows who invited them and gives the code once, on a button", async () => {
    const team = `fam-${uid()}`;
    await seedTeam(team, "joe");
    const inv = expectOk(await call(await token(`${team}/joe`), "threadpacket_invite", { username: "Anna" }));
    expect(inv).toMatchObject({ username: "anna", team, new_member: true });
    const url = new URL(inv.invite_url as string);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toMatch(/^\/invite\/[A-Za-z0-9_-]{20,}$/);
    expect(await env.DB.prepare("SELECT 1 AS ok FROM members WHERE handle = ?").bind(`${team}/anna`).first()).toEqual({ ok: 1 });

    // A messenger's link preview (a GET) does not use up the link or reveal a code.
    for (let i = 0; i < 2; i++) {
      const view = await fetchAs(ctl, url.pathname);
      expect(view.status).toBe(200);
      expect(view.headers.get("x-robots-tag")).toBe("noindex");
      const html = await view.text();
      expect(html).toContain("joe invited you.");
      expect(html).toContain(`<strong>${team}</strong>`);
      expect(html).not.toMatch(/tp-[A-Za-z0-9_-]{16}/);
    }

    const open = await fetchAs(ctl, url.pathname, { method: "POST" });
    expect(open.status).toBe(200);
    const page = await open.text();
    const code = /tp-[A-Za-z0-9_-]{16}/.exec(page)?.[0];
    expect(code).toBeTruthy();
    expect(page).toContain("claude.ai/customize/connectors?modal=add-custom-connector");
    expect(page).toContain("Continue the packet from joe.");
    expect(await verifyMemberCode(env.DB, `${team}/anna`, code!)).toBe(`${team}/anna`);

    // Once only.
    const again = await fetchAs(ctl, url.pathname, { method: "POST" });
    expect(again.status).toBe(410);
    expect(await again.text()).toContain("already used");
    expect(await (await fetchAs(ctl, url.pathname)).text()).toContain("already used");
  });

  it("inviting again replaces the open link; an existing member gets a new code from it", async () => {
    const team = `fam-${uid()}`;
    await seedTeam(team, "joe");
    const joe = await token(`${team}/joe`);
    const first = expectOk(await call(joe, "threadpacket_invite", { username: "anna" }));
    const second = expectOk(await call(joe, "threadpacket_invite", { username: "anna" }));
    expect(second.new_member).toBe(false);
    expect((await fetchAs(ctl, new URL(first.invite_url as string).pathname)).status).toBe(404);
    expect((await fetchAs(ctl, new URL(second.invite_url as string).pathname)).status).toBe(200);
  });

  it("only an admin can invite, never themselves, and only valid usernames", async () => {
    const team = `fam-${uid()}`;
    await seedTeam(team, "joe");
    await env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES (?, 's', 'h', ?)").bind(`${team}/kid`, new Date().toISOString()).run();
    expect(errorText(await call(await token(`${team}/kid`), "threadpacket_invite", { username: "friend" }))).toContain("only a team admin");
    const joe = await token(`${team}/joe`);
    expect(errorText(await call(joe, "threadpacket_invite", { username: "joe" }))).toContain("own username");
    expect(errorText(await call(joe, "threadpacket_invite", { username: "team" }))).toContain("reserved");
    expect(errorText(await call(joe, "threadpacket_invite", { username: "-x" }))).toContain("username");
  });

  it("an unknown or expired link says so", async () => {
    expect((await fetchAs(ctl, "/invite/not-a-real-token")).status).toBe(404);
    const team = `fam-${uid()}`;
    await seedTeam(team, "joe");
    const inv = expectOk(await call(await token(`${team}/joe`), "threadpacket_invite", { username: "anna" }));
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE handle = ?").bind("2000-01-01T00:00:00.000Z", `${team}/anna`).run();
    const path = new URL(inv.invite_url as string).pathname;
    expect(await (await fetchAs(ctl, path)).text()).toContain("expired");
    expect((await fetchAs(ctl, path, { method: "POST" })).status).toBe(410);
  });
});

describe("creating a team on the sign-in page", () => {
  async function oauthStart() {
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const reg = await fetchAs(ctl, "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri] }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };
    const verifier = `verifier-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const params = { client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "threadpacket" };
    return { params, redirectUri };
  }

  it("offers Create a team on the hosted service only", async () => {
    const { params } = await oauthStart();
    const qs = new URLSearchParams(params).toString();
    const hosted = await (await fetchAs(ctl, `/authorize?${qs}`)).text();
    expect(hosted).toContain('id="new-team"');
    expect(hosted).toContain('name="action" value="create_team"');
    const priv = await (await fetchAs(env, `/authorize?${qs}`)).text();
    expect(priv).not.toContain('id="new-team"');
  });

  it("creates the team, shows the code once, and the Continue button finishes the same sign-in", async () => {
    const { params, redirectUri } = await oauthStart();
    const team = `fam-${uid()}`;
    const res = await fetchAs(ctl, "/authorize", post({ ...params, action: "create_team", team, handle: "Joe" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain(`Team ${team} is ready`);
    expect(html).not.toContain('id="new-team"');
    const code = /tp-[A-Za-z0-9_-]{16}/.exec(html)?.[0];
    expect(code).toBeTruthy();
    expect(await env.DB.prepare("SELECT handle FROM admin_members WHERE handle = ?").bind(`${team}/joe`).first()).toEqual({ handle: `${team}/joe` });

    // The Continue form carries the OAuth request and the new credentials.
    const fields = Object.fromEntries([...html.matchAll(/<input type="hidden" name="([a-z_]+)" value="([^"]*)">/g)].map((m) => [m[1]!, m[2]!]));
    expect(fields).toMatchObject({ ...params, handle: "joe", access_code: code });
    expect(fields.team).toBeUndefined();
    const signIn = await fetchAs(ctl, "/authorize", post(fields));
    expect(signIn.status).toBe(302);
    const loc = new URL(signIn.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(redirectUri);
    expect(loc.searchParams.get("code")).toMatch(/^hc_/);
    expect(loc.searchParams.get("state")).toBe("s1");
  });

  it("without a team name, the team is named after the username", async () => {
    const { params } = await oauthStart();
    const handle = `lee-${uid()}`;
    const res = await fetchAs(ctl, "/authorize", post({ ...params, action: "create_team", team: "", handle }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`Team ${handle} is ready`);
    expect(await env.DB.prepare("SELECT handle FROM admin_members WHERE handle = ?").bind(`${handle}/${handle}`).first()).toEqual({ handle: `${handle}/${handle}` });
  });

  it("a taken name keeps the form filled and says so", async () => {
    const { params } = await oauthStart();
    const team = `fam-${uid()}`;
    await seedTeam(team, "someone");
    const res = await fetchAs(ctl, "/authorize", post({ ...params, action: "create_team", team, handle: "joe" }));
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain("is taken");
    expect(html).toContain(`value="${team}"`);
    expect(html).toContain('id="new-team"');
  });

  it("does not create a team without a valid OAuth request, or on a private install", async () => {
    const team = `fam-${uid()}`;
    const bare = await fetchAs(ctl, "/authorize", post({ action: "create_team", team, handle: "joe" }));
    expect(bare.status).toBe(400);
    const { params } = await oauthStart();
    const priv = await fetchAs(env, "/authorize", post({ ...params, action: "create_team", team, handle: "joe" }));
    expect(priv.status).toBe(401);
    expect(await env.DB.prepare("SELECT 1 AS ok FROM tenants WHERE slug = ?").bind(team).first()).toBeNull();
  });
});
