import { describe, expect, it } from "vitest";
import { SELF, createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { upsertMember } from "../src/auth/builtin";
import { base64url } from "../src/domain/ids";
import { ORIGIN } from "./helpers";

/**
 * One code base, two modes. The suite runs as a private install; these cases run the same Worker with
 * HANDOFF_MODE=control, the control center: homepage, /join, a console per tenant, the operator's dashboard.
 */
const ctl = { ...env, HANDOFF_MODE: "control" };
const uid = () => crypto.randomUUID().slice(0, 6);
const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}-${uid()}`;

const fetchAs = (e: typeof env, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), e, createExecutionContext());
const form = (fields: Record<string, string>, extra: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": ip(), ...extra },
  body: new URLSearchParams(fields),
});

async function join(team: string, handle: string): Promise<{ status: number; code: string | null; text: string }> {
  const res = await fetchAs(ctl, "/join", form({ team, handle }));
  const text = await res.text();
  return { status: res.status, code: /hf-[A-Za-z0-9_-]{16}/.exec(text)?.[0] ?? null, text };
}

interface Session {
  cookie: string;
  page(path: string): Promise<{ status: number; text: string; location: string | null }>;
  submit(path: string, fields?: Record<string, string>): Promise<Response>;
}

async function consoleSession(e: typeof env, fields: Record<string, string>): Promise<Session> {
  const res = await fetchAs(e, "/console/login", form(fields));
  expect(res.status, await res.clone().text()).toBe(303);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  const page = async (path: string) => {
    const r = await fetchAs(e, path, { headers: { cookie } });
    return { status: r.status, text: await r.text(), location: r.headers.get("location") };
  };
  const csrf = async () => /name="csrf" value="([0-9a-f]{64})"/.exec((await page("/console/overview")).text)![1]!;
  return { cookie, page, submit: async (path, f = {}) => fetchAs(e, path, form({ csrf: await csrf(), ...f }, { cookie })) };
}

describe("a private install", () => {
  it("sends / to its Connect page and has no sign-up or public stats", async () => {
    const home = await SELF.fetch(`${ORIGIN}/`, { redirect: "manual" });
    expect(home.status).toBe(303);
    expect(home.headers.get("location")).toBe("/connect");
    expect((await SELF.fetch(`${ORIGIN}/use-cases`, { redirect: "manual" })).status).toBe(303);
    expect((await SELF.fetch(`${ORIGIN}/join`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/stats`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/stats.json`)).status).toBe(404);
    const connect = await (await SELF.fetch(`${ORIGIN}/connect`)).text();
    expect(connect).toContain("About Handoff");
    expect(connect).toContain("https://handoff.infraworks.net/");
    expect(connect).not.toContain('name="team"');
  });
});

describe("the control center", () => {
  it("serves the homepage, the sign-up form and the public counters, and receives update checks", async () => {
    const home = await fetchAs(ctl, "/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("use-cases");
    const join = await fetchAs(ctl, "/join");
    expect(join.status).toBe(200);
    const page = await join.text();
    expect(page).toContain('action="/join"');
    expect(page).toContain("shared Handoff playground");
    const stats = await fetchAs(ctl, "/stats.json");
    expect(stats.status).toBe(200);
    expect(Object.keys((await stats.json()) as object)).toEqual(expect.arrayContaining(["teams", "users_28d", "private_instances_28d", "deploy_clicks_30d"]));
    expect((await fetchAs(ctl, "/stats")).status).toBe(200);
    expect((await fetchAs(ctl, "/v1/update-check?id=inst_abcdefghijklmnopqrstuv&v=0.1.0&m=1&p=0")).status).toBe(200);
  });

  it("sign-up makes a tenant and its admin, shows the code once, and refuses taken, reserved and bad names", async () => {
    const team = `acme-${uid()}`;
    const first = await join(team, "Tim");
    expect(first.status).toBe(200);
    expect(first.code).toMatch(/^hf-/);
    expect(first.text).toContain(`Team ${team} is ready`);
    const rows = await env.DB.prepare("SELECT m.handle, a.handle AS admin FROM members m LEFT JOIN admin_members a ON a.handle = m.handle WHERE m.handle = ?").bind(`${team}/tim`).first();
    expect(rows).toEqual({ handle: `${team}/tim`, admin: `${team}/tim` });
    expect(await env.DB.prepare("SELECT slug, members_cap FROM tenants WHERE slug = ?").bind(team).first()).toEqual({ slug: team, members_cap: 10 });

    expect((await join(team, "tom")).status).toBe(409);
    expect((await join("admin", "tim")).status).toBe(400);
    expect((await join("ab", "tim")).status).toBe(400);
    expect((await join(`ok-${uid()}`, "team")).status).toBe(400);
    const noOrigin = await fetchAs(ctl, "/join", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ team: `x-${uid()}`, handle: "a" }) });
    expect(noOrigin.status).toBe(403);
  });

  it("a team's admin signs in with team, handle and code and sees only their team; Ops and Tenants are not theirs", async () => {
    const team = `beta-${uid()}`;
    const other = `gamma-${uid()}`;
    const me = await join(team, "ann");
    const otherCode = (await join(other, "ann")).code;
    const s = await consoleSession(ctl, { team, handle: "ann", access_code: me.code! });

    const members = await s.page("/console/members");
    expect(members.status).toBe(200);
    expect(members.text).toContain("<strong>ann</strong>");
    expect(members.text).not.toContain(other);
    expect(members.text).toContain(`${team} ·`);

    const added = await s.submit("/console/members", { handle: "bob" });
    expect(added.status).toBe(200);
    expect(await env.DB.prepare("SELECT handle FROM members WHERE handle = ?").bind(`${team}/bob`).first()).toEqual({ handle: `${team}/bob` });
    expect((await s.page("/console/members")).text).toContain("<strong>bob</strong>");

    // The other team's admin does not see bob.
    const theirs = await consoleSession(ctl, { team: other, handle: "ann", access_code: otherCode! });
    const theirMembers = (await theirs.page("/console/members")).text;
    expect(theirMembers).toContain("<strong>ann</strong>");
    expect(theirMembers).not.toContain("<strong>bob</strong>");

    expect((await s.page("/console/ops")).location).toBe("/console/overview");
    expect((await s.page("/console/tenants")).location).toBe("/console/overview");
    // Reset and remove address the team's own member.
    expect((await s.submit(`/console/members/bob/reset`)).status).toBe(200);
    expect((await s.submit(`/console/members/bob/remove`)).status).toBe(303);
    expect(await env.DB.prepare("SELECT handle FROM members WHERE handle = ?").bind(`${team}/bob`).first()).toBeNull();
  });

  it("the wrong team with the right handle and code is refused, at the console and at the OAuth sign-in", async () => {
    const team = `delta-${uid()}`;
    const me = await join(team, "tim");
    const wrong = await fetchAs(ctl, "/console/login", form({ team: `${team}-no`, handle: "tim", access_code: me.code! }));
    expect(wrong.status).toBe(401);
    const noTeam = await fetchAs(ctl, "/console/login", form({ handle: "tim", access_code: me.code! }));
    expect(noTeam.status).toBe(401);

    // OAuth: register a client, sign in with team + handle + code, exchange the code: the token's sub is team/tim.
    const reg = await fetchAs(ctl, "/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://localhost:4321/cb"], client_name: "Test host" }) });
    const client = (await reg.json()) as { client_id: string };
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const oauth = { client_id: client.client_id, redirect_uri: "http://localhost:4321/cb", response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "handoff offline_access" };
    const page = await fetchAs(ctl, `/authorize?${new URLSearchParams(oauth)}`);
    expect(await page.text()).toContain('name="team"');
    const bad = await fetchAs(ctl, "/authorize", form({ ...oauth, team: `${team}-no`, handle: "tim", access_code: me.code! }));
    expect(bad.status).toBe(401);
    const ok = await fetchAs(ctl, "/authorize", form({ ...oauth, team, handle: "tim", access_code: me.code! }));
    expect(ok.status).toBe(302);
    const code = new URL(ok.headers.get("location")!).searchParams.get("code")!;
    const tok = await fetchAs(ctl, "/oauth/token", form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: oauth.redirect_uri }));
    expect(tok.status).toBe(200);
    const { access_token } = (await tok.json()) as { access_token: string };
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0))));
    expect(payload.sub).toBe(`${team}/tim`);
  });

  it("the operator signs in with no team and sees every team on the Tenants page and Ops", async () => {
    const op = { handle: `op-${uid()}`, code: `operator-code-${uid()}` };
    await upsertMember(env.DB, op.handle, op.code);
    await env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES (?)").bind(op.handle).run();
    const team = `zeta-${uid()}`;
    await join(team, "lee");
    const s = await consoleSession(ctl, { team: "", handle: op.handle, access_code: op.code });
    const tenants = await s.page("/console/tenants");
    expect(tenants.status).toBe(200);
    expect(tenants.text).toContain(`<strong>${team}</strong>`);
    expect(tenants.text).toContain("users, 28 days");
    expect((await s.page("/console/ops")).status).toBe(200);
    expect((await s.page("/console/overview")).text).toContain("operator");
    // Sign-up cannot make a bare handle, so nobody else gets in through an empty team.
    expect((await join("", "nobody")).status).toBe(400);
  });
});
