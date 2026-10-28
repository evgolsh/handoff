import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { upsertMember, verifyMemberCode } from "../src/auth/builtin";
import { sha256Hex } from "../src/domain/ids";
import { ORIGIN, call, expectOk, rpc, send, token } from "./helpers";

const uid = () => crypto.randomUUID().slice(0, 8);
const ip = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}-${uid()}`;

async function admin(handle = `adm-${uid()}`, code = `code-${uid()}-${uid()}`): Promise<{ handle: string; code: string }> {
  await upsertMember(env.DB, handle, code);
  await env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES (?)").bind(handle).run();
  return { handle, code };
}

function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": ip(), ...headers },
    body: new URLSearchParams(fields),
  });
}

interface Browser {
  cookie: string;
  get(path: string): Promise<Response>;
  page(path: string): Promise<string>;
  csrf(): Promise<string>;
  submit(path: string, fields?: Record<string, string>): Promise<Response>;
}

async function signIn(who: { handle: string; code: string }): Promise<Browser> {
  const res = await post("/console/login", { handle: who.handle, access_code: who.code });
  expect(res.status).toBe(303);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]!;
  const get = (path: string) => SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual", headers: { cookie } });
  const page = async (path: string) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    return r.text();
  };
  const csrf = async () => /name="csrf" value="([0-9a-f]{64})"/.exec(await page("/console/overview"))![1]!;
  return {
    cookie,
    get,
    page,
    csrf,
    submit: async (path, fields = {}) => post(path, { csrf: await csrf(), ...fields }, { cookie }),
  };
}

/** Events are written after the response; wait for them. */
async function eventually<T>(f: () => Promise<T | null | undefined | false>, tries = 40): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met");
}

const codeOn = (html: string) => /<div class="secret"[^>]*>([^<]+)<\/div>/.exec(html)?.[1];

describe("console sign-in", () => {
  it("serves a sign-in page with no script, and sends signed-out visitors there", async () => {
    const res = await SELF.fetch(`${ORIGIN}/console/login`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("script-src");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // With no-referrer, browsers send "Origin: null" on the form POST and the origin check refuses the sign-in.
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    const html = await res.text();
    expect(html).not.toContain("<script");
    expect(html).toContain('action="/console/login"');

    for (const path of ["/console/overview", "/console/members", "/console/assistants", "/console/ops"]) {
      const r = await SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual" });
      expect(r.status).toBe(303);
      expect(r.headers.get("location")).toBe("/console/login");
    }
    const old = await SELF.fetch(`${ORIGIN}/admin`, { redirect: "manual" });
    expect(old.headers.get("location")).toBe("/console");
  });

  it("lets an admin in with a __Host- cookie whose token D1 keeps only as a hash; a member who is not an admin stays out", async () => {
    const a = await admin();
    const res = await post("/console/login", { handle: a.handle.toUpperCase(), access_code: a.code });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/console/overview");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-handoff-console=[A-Za-z0-9_-]{40,};/);
    for (const flag of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Max-Age=43200"]) expect(setCookie).toContain(flag);
    const raw = /^__Host-handoff-console=([^;]+)/.exec(setCookie)![1]!;
    const stored = await env.DB.prepare("SELECT token_hash FROM admin_sessions WHERE handle = ?").bind(a.handle).all<{ token_hash: string }>();
    expect(stored.results.map((r) => r.token_hash)).toContain(await sha256Hex(raw));
    expect(JSON.stringify(stored.results)).not.toContain(raw);

    const plain = `member-${uid()}`;
    await upsertMember(env.DB, plain, "plain-member-code-1");
    const refused = await post("/console/login", { handle: plain, access_code: "plain-member-code-1" });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect((await post("/console/login", { handle: a.handle, access_code: "wrong-code-123" })).status).toBe(401);
  });

  it("refuses a sign-in posted from another site, and stops after 10 attempts from one address", async () => {
    const a = await admin();
    expect((await post("/console/login", { handle: a.handle, access_code: a.code }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/console/login", { handle: a.handle, access_code: a.code }, { origin: "" })).status).toBe(403);

    const from = ip();
    for (let i = 0; i < 10; i++) expect((await post("/console/login", { handle: a.handle, access_code: "nope-nope" }, { "cf-connecting-ip": from })).status).toBe(401);
    const limited = await post("/console/login", { handle: a.handle, access_code: a.code }, { "cf-connecting-ip": from });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("600");
  });

  it("refuses a change without the session's CSRF value or from another origin, and signs out", async () => {
    const b = await signIn(await admin());
    const handle = `x-${uid()}`;
    expect((await post("/console/members", { handle }, { cookie: b.cookie })).status).toBe(403);
    expect((await post("/console/members", { handle, csrf: "0".repeat(64) }, { cookie: b.cookie })).status).toBe(403);
    expect((await post("/console/members", { handle, csrf: await b.csrf() }, { cookie: b.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect(await env.DB.prepare("SELECT 1 FROM members WHERE handle = ?").bind(handle).first()).toBeNull();

    const out = await b.submit("/console/logout");
    expect(out.status).toBe(303);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await b.get("/console/overview")).status).toBe(303);
  });
});

describe("console members", () => {
  it("adds a member and shows the code once; the code signs in; a taken or reserved handle is refused", async () => {
    const b = await signIn(await admin());
    const handle = `new-${uid()}`;
    const res = await b.submit("/console/members", { handle: handle.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const code = codeOn(await res.text());
    expect(code).toMatch(/^hf-[A-Za-z0-9_-]{16}$/);
    expect(await verifyMemberCode(env.DB, handle, code!)).toBe(handle);
    // D1 keeps a hash, and no console page shows the code again.
    const row = await env.DB.prepare("SELECT * FROM members WHERE handle = ?").bind(handle).first();
    expect(JSON.stringify(row)).not.toContain(code);
    expect(await b.page("/console/members")).not.toContain(code);

    expect((await b.submit("/console/members", { handle })).status).toBe(409);
    for (const reserved of ["team", "all", "Team"]) expect((await b.submit("/console/members", { handle: reserved })).status).toBe(400);
  });

  it("reset gives a new code and signs out every assistant of that member", async () => {
    const b = await signIn(await admin());
    const handle = `reset-${uid()}`;
    await upsertMember(env.DB, handle, "old-code-for-reset");
    const before = await token(handle);
    expectOk(await call(before, "handoff_inbox"));
    await env.DB.prepare("INSERT INTO oauth_refresh_tokens (token_hash, client_id, subject, scope, expires_at) VALUES (?, 'c1', ?, 'handoff', ?)")
      .bind(`h-${uid()}`, handle, new Date(Date.now() + 86_400_000).toISOString())
      .run();

    expect(await b.page(`/console/members/${handle}/reset`)).toContain(`Reset the code of ${handle}?`);
    const res = await b.submit(`/console/members/${handle}/reset`);
    expect(res.status).toBe(200);
    const code = codeOn(await res.text())!;
    expect(await verifyMemberCode(env.DB, handle, code)).toBe(handle);
    expect(await verifyMemberCode(env.DB, handle, "old-code-for-reset")).toBeNull();

    const refused = await rpc(before, "tools/call", { name: "handoff_inbox", arguments: {} });
    expect(refused.status).toBe(401);
    expect(refused.body.error_description).toContain("revoked");
    const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_refresh_tokens WHERE subject = ? AND revoked_at IS NULL").bind(handle).first<{ n: number }>();
    expect(live?.n).toBe(0);
  });

  it("an admin's own reset ends their console session", async () => {
    const a = await admin();
    const b = await signIn(a);
    expect((await b.submit(`/console/members/${a.handle}/reset`)).status).toBe(200);
    expect((await b.get("/console/overview")).status).toBe(303);
  });

  it("remove signs the member out, revokes their packets, and cannot remove yourself", async () => {
    const a = await admin();
    const b = await signIn(a);
    const handle = `gone-${uid()}`;
    await upsertMember(env.DB, handle, "gone-member-code");
    const t = await token(handle);
    const p = await send(t, { title: "private notes" });

    expect(await b.page(`/console/members/${handle}/remove`)).toContain(`Remove ${handle}?`);
    const res = await b.submit(`/console/members/${handle}/remove`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/console/members?did=removed&member=${handle}`);
    expect(await env.DB.prepare("SELECT 1 FROM members WHERE handle = ?").bind(handle).first()).toBeNull();
    expect((await env.DB.prepare("SELECT revoked_at FROM packets WHERE id = ?").bind(p.packet_id).first<{ revoked_at: string | null }>())?.revoked_at).toBeTruthy();
    expect((await rpc(t, "tools/call", { name: "handoff_inbox", arguments: {} })).status).toBe(401);

    expect((await b.get(`/console/members/${a.handle}/remove`)).status).toBe(400);
    expect((await b.submit(`/console/members/${a.handle}/remove`)).status).toBe(400);
    expect((await b.get("/console/members/nobody-here/remove")).status).toBe(404);
  });
});

describe("console assistants and activity", () => {
  it("shows what assistants did, without titles, briefs or tokens, and disconnects one assistant only", async () => {
    const b = await signIn(await admin());
    const handle = `act-${uid()}`;
    await upsertMember(env.DB, handle, "activity-code-1");
    const clientA = `client-a-${uid()}`;
    const clientB = `client-b-${uid()}`;
    await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at, last_used_at) VALUES (?, ?, 'Hermes Agent', ?, ?)")
      .bind(clientA, JSON.stringify(["http://127.0.0.1:8765/cb"]), new Date().toISOString(), new Date().toISOString())
      .run();
    const ta = await token(handle, { clientId: clientA });
    const tb = await token(handle, { clientId: clientB });
    const init = await rpc(ta, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hermes-agent", version: "0.9.1" } });
    expect(init.status).toBe(200);
    const secretTitle = `Title-${uid()}`;
    const secretBrief = `Brief-${uid()}`;
    await send(ta, { title: secretTitle, brief: secretBrief });
    await call(ta, "handoff_read", { packet_id: "pk_aaaaaaaaaaaaaaaaaaaa" });
    expectOk(await call(tb, "handoff_inbox"));

    await eventually(async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE subject = ? AND kind IN ('tool', 'initialize')").bind(handle).first<{ n: number }>())!.n >= 4,
    );
    const outcomes = await env.DB.prepare("SELECT kind, name, outcome, client_id FROM events WHERE subject = ? ORDER BY id").bind(handle).all();
    expect(outcomes.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "initialize", name: "hermes-agent", outcome: "ok", client_id: clientA }),
        expect.objectContaining({ kind: "tool", name: "handoff_send", outcome: "ok" }),
        expect.objectContaining({ kind: "tool", name: "handoff_read", outcome: "not_found" }),
        expect.objectContaining({ kind: "tool", name: "handoff_inbox", outcome: "ok", client_id: clientB }),
      ]),
    );

    const pages = [await b.page("/console/overview"), await b.page("/console/assistants"), await b.page("/console/members"), await b.page("/console/ops")];
    for (const html of pages) {
      expect(html).not.toContain(secretTitle);
      expect(html).not.toContain(secretBrief);
      expect(html).not.toContain(ta);
      expect(html).not.toContain("activity-code-1");
      expect(html).not.toContain("<script");
    }
    expect(pages[0]).toContain("handoff_send");
    expect(pages[1]).toContain("Hermes Agent");
    expect(pages[1]).toContain("hermes-agent 0.9.1");
    expect(pages[1]).toContain("127.0.0.1:8765");
    expect(pages[3]).toContain("not_found");

    // Disconnect client A: its token is refused at once; client B goes on.
    await env.DB.prepare("INSERT INTO oauth_refresh_tokens (token_hash, client_id, subject, scope, expires_at) VALUES (?, ?, ?, 'handoff', ?)")
      .bind(`h-${uid()}`, clientA, handle, new Date(Date.now() + 86_400_000).toISOString())
      .run();
    const confirm = await b.page(`/console/assistants/disconnect?member=${handle}&client=${clientA}`);
    expect(confirm).toContain("Disconnect Hermes Agent?");
    const res = await b.submit("/console/assistants/disconnect", { member: handle, client: clientA });
    expect(res.status).toBe(303);
    expect((await rpc(ta, "tools/call", { name: "handoff_inbox", arguments: {} })).status).toBe(401);
    expectOk(await call(tb, "handoff_inbox"));
    const refresh = await env.DB.prepare("SELECT revoked_at FROM oauth_refresh_tokens WHERE subject = ? AND client_id = ?").bind(handle, clientA).first<{ revoked_at: string | null }>();
    expect(refresh?.revoked_at).toBeTruthy();

    // The refused token is counted, with its member, and the action is in the console's own record.
    await eventually(async () => (await env.DB.prepare("SELECT 1 FROM events WHERE kind = 'auth' AND subject = ?").bind(handle).first()) !== null);
    expect(await b.page("/console/assistants")).toContain("access was revoked; sign in again");
    expect(await b.page("/console/ops")).toContain("disconnected an assistant of");
  });

  it("records a wrong sign-in code and refuses tokens for a removed member at refresh", async () => {
    const handle = `oauth-${uid()}`;
    await upsertMember(env.DB, handle, "oauth-member-code");
    const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1:9911/callback"] }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const bad = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id, redirect_uri: "http://127.0.0.1:9911/callback", code_challenge: "x".repeat(43), handle, access_code: "wrong-code" }),
    });
    expect(bad.status).toBe(401);
    const ev = await env.DB.prepare("SELECT outcome FROM events WHERE kind = 'sign_in' AND subject = ? ORDER BY id DESC").bind(handle).first<{ outcome: string }>();
    expect(ev?.outcome).toBe("bad_code");

    await env.DB.prepare("INSERT INTO oauth_refresh_tokens (token_hash, client_id, subject, scope, expires_at) VALUES (?, ?, ?, 'handoff', ?)")
      .bind(await sha256Hex("hr_refresh-of-removed"), client_id, handle, new Date(Date.now() + 86_400_000).toISOString())
      .run();
    await env.DB.prepare("DELETE FROM members WHERE handle = ?").bind(handle).run();
    const res = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "hr_refresh-of-removed", client_id }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_description: string }).error_description).toBe("this member was removed");
  });

  it("reserves team and all as handles", async () => {
    await expect(upsertMember(env.DB, "team", "some-code-123")).rejects.toThrow();
    await expect(upsertMember(env.DB, "all", "some-code-123")).rejects.toThrow();
  });
});

describe("console ops", () => {
  it("runs cleanup now, records it, and prunes records that do nothing", async () => {
    const a = await admin();
    const b = await signIn(a);
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const stale = `stale-${uid()}`;
    await env.DB.prepare("INSERT INTO events (ts, kind, name, outcome) VALUES (?, 'tool', 'handoff_inbox', 'ok')").bind(old).run();
    await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at) VALUES (?, '[]', 'never used', ?)").bind(stale, old).run();
    const used = `used-${uid()}`;
    await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at, last_used_at) VALUES (?, '[]', 'used once', ?, ?)").bind(used, old, old).run();

    const res = await b.submit("/console/ops/cleanup");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/console/ops?did=cleanup");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE ts < ?").bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).first<{ n: number }>())?.n).toBe(0);
    expect(await env.DB.prepare("SELECT 1 FROM oauth_clients WHERE client_id = ?").bind(stale).first()).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM oauth_clients WHERE client_id = ?").bind(used).first()).not.toBeNull();

    const html = await b.page("/console/ops?did=cleanup");
    expect(html).toContain("Cleanup ran.");
    expect(html).toContain(a.handle);
    expect(html).toContain("ran cleanup");
    const run = await env.DB.prepare("SELECT name, subject, outcome FROM events WHERE kind = 'cleanup' ORDER BY id DESC").first();
    expect(run).toMatchObject({ name: "console", subject: a.handle, outcome: "ok" });
  });
});
