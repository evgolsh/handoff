import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { base64url, sha256Hex } from "../src/domain/ids";
import { ORIGIN } from "./helpers";

/**
 * Sign-in on the hosted service: a username and access code, no team (the code says which account it is); a
 * browser can be signed in to several teams and switch between them in the account menu; sessions last 30 days
 * and are renewed while used; signing in for an assistant signs in the browser too.
 */
const ctl = { ...env, THREADPACKET_MODE: "control" };
const uid = () => crypto.randomUUID().slice(0, 6);
const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}-${uid()}`;
const fetchAs = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), ctl, createExecutionContext());
const form = (fields: Record<string, string>, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": ip(), ...headers },
  body: new URLSearchParams(fields),
});

/** A browser: it keeps the cookies the site sets, as a browser would. */
class Browser {
  jar = new Map<string, string>();
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  keep(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const [k, v] = [kv!.slice(0, kv!.indexOf("=")), kv!.slice(kv!.indexOf("=") + 1)];
      if (!v || attrs.some((a) => a.trim() === "Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  async get(path: string) {
    const res = this.keep(await fetchAs(path, { headers: { cookie: this.cookie } }));
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  }
  async post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
    return this.keep(await fetchAs(path, form(fields, { cookie: this.cookie, ...headers })));
  }
  async csrf() {
    return /name="csrf" value="([0-9a-f]{64})"/.exec((await this.get("/packets")).text)![1]!;
  }
  tokens() {
    return (this.jar.get("__Host-threadpacket-session") ?? "").split(".").filter(Boolean);
  }
}

/** Creates a team and its admin; returns the access code. */
async function team(name: string, handle = "joe"): Promise<string> {
  const res = await fetchAs("/join", form({ team: name, handle }));
  expect(res.status).toBe(200);
  return /tp-[A-Za-z0-9_-]{16}/.exec(await res.text())![0];
}
const menuOf = (html: string) => /<details class="account">[\s\S]*?<\/details>/.exec(html)![0];
/** Who the account menu says is signed in, as "team/handle". */
const activeIn = (html: string) => {
  const m = /<summary>[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?<span class="acct-team">([^<]+)<\/span>/.exec(menuOf(html))!;
  return `${m[2]}/${m[1]}`;
};

describe("sign-in with a username and access code", () => {
  it("asks for no team: the code finds the account, in whichever team it is", async () => {
    const [smiths, work] = [`smiths-${uid()}`, `work-${uid()}`];
    const [c1, c2] = [await team(smiths), await team(work)];
    const page = (await new Browser().get("/login")).text;
    expect(page).not.toContain('name="team"');
    expect(page).toMatch(/id="handle"[^>]* autofocus/);

    // The same username in two teams: each code signs in to its own team.
    const b = new Browser();
    expect((await b.post("/login", { handle: "joe", access_code: c2 })).headers.get("location")).toBe("/packets");
    expect(activeIn((await b.get("/packets")).text)).toBe(`${work}/joe`);
    const b2 = new Browser();
    await b2.post("/login", { handle: "Joe", access_code: c1 });
    expect(activeIn((await b2.get("/packets")).text)).toBe(`${smiths}/joe`);
    // No cookie other than the session.
    expect([...b.jar.keys()]).toEqual(["__Host-threadpacket-session"]);

    // The right code with another username, or a wrong code, is refused with one message.
    for (const fields of [{ handle: "anna", access_code: c1 }, { handle: "joe", access_code: "tp-wrong-code-000" }]) {
      const res = await fetchAs("/login", form(fields));
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("That username and access code do not match.");
      expect(html).toContain(`value="${fields.handle}"`);
    }
  });

  it("finds a code set before lookups existed by its username, and fills in its lookup", async () => {
    const smiths = `smiths-${uid()}`;
    const code = await team(smiths);
    const lookup = async () => (await env.DB.prepare("SELECT code_lookup FROM members WHERE handle = ?").bind(`${smiths}/joe`).first<{ code_lookup: string | null }>())?.code_lookup;
    expect(await lookup()).toBe((await sha256Hex(code)).slice(0, 4));
    await env.DB.prepare("UPDATE members SET code_lookup = NULL WHERE handle = ?").bind(`${smiths}/joe`).run();
    const b = new Browser();
    expect((await b.post("/login", { handle: "joe", access_code: code })).headers.get("location")).toBe("/packets");
    expect(await lookup()).toBe((await sha256Hex(code)).slice(0, 4));
  });

  it("sign-up needs only a username: the team is named after it, with a number when that name is taken", async () => {
    const handle = `solo.${uid()}`;
    const first = await fetchAs("/join", form({ handle }));
    expect(first.status).toBe(200);
    const html = await first.text();
    const name = handle.replace(".", "-");
    expect(html).toContain(`✓ Team ${name} is ready`);
    expect(html).not.toContain("Team: ");
    const again = await fetchAs("/join", form({ handle }));
    expect(again.status).toBe(200);
    expect(await again.text()).toMatch(new RegExp(`✓ Team ${name}-\\d{3} is ready`));
    // A typed name is used as typed: taken is an error, not a number.
    const typed = await fetchAs("/join", form({ team: name, handle: "anna" }));
    expect(typed.status).toBe(409);
    expect(await typed.text()).toContain(`The team name ${name} is taken.`);
  });

  it("signs in to a second team while staying in the first, and switches between them in the account menu", async () => {
    const [smiths, acme] = [`smiths-${uid()}`, `work-${uid()}`];
    const [c1, c2] = [await team(smiths), await team(acme)];
    const b = new Browser();
    await b.post("/login", { handle: "joe", access_code: c1 });
    const one = menuOf((await b.get("/packets")).text);
    expect(one).toContain('<a href="/login?add=1">Sign in to another team</a>');
    expect(one).toContain(">Sign out</button>");
    expect(one).not.toContain("Switch to");

    // Signed in, the sign-in page goes straight on unless asked to add a team.
    expect((await b.get("/login")).location).toBe("/packets");
    const add = (await b.get("/login?add=1")).text;
    expect(add).toContain("<h1>Sign in to another team.</h1>");
    expect(add).toContain('<input type="hidden" name="add" value="1">');
    expect(add).not.toContain('name="team"');
    expect(add).toContain('<a href="/packets">Back to Dashboard</a>');
    await b.post("/login", { handle: "joe", access_code: c2, add: "1" });
    expect(b.tokens()).toHaveLength(2);

    // acme is active; smiths waits in the menu.
    const packets = (await b.get("/packets")).text;
    expect(activeIn(packets)).toBe(`${acme}/joe`);
    const menu = menuOf(packets);
    expect(menu).toContain("Switch to");
    expect(menu).toContain(`<input type="hidden" name="to" value="${smiths}/joe"><button type="submit" class="acct">${smiths} · joe</button>`);
    expect(menu).toContain(">Sign out of all</button>");

    // Switching needs this site's form and the session's CSRF value.
    expect((await b.post("/switch", { to: `${smiths}/joe` })).status).toBe(403);
    expect((await b.post("/switch", { to: `${smiths}/joe`, csrf: await b.csrf() }, { origin: "https://evil.example" })).status).toBe(403);
    const sw = await b.post("/switch", { to: `${smiths}/joe`, csrf: await b.csrf() });
    expect(sw.status).toBe(303);
    expect(sw.headers.get("location")).toBe("/packets");
    expect(activeIn((await b.get("/packets")).text)).toBe(`${smiths}/joe`);
    // An account this browser is not signed in to changes nothing.
    await b.post("/switch", { to: "someone/else", csrf: await b.csrf() });
    expect(activeIn((await b.get("/packets")).text)).toBe(`${smiths}/joe`);

    // Signing in again as the same person replaces that session instead of adding one.
    await b.post("/login", { handle: "joe", access_code: c1, add: "1" });
    expect(b.tokens()).toHaveLength(2);

    // Sign out of all: both sessions end.
    const hashes = await Promise.all(b.tokens().map((t) => sha256Hex(t)));
    await b.post("/logout", { csrf: await b.csrf() });
    expect(b.tokens()).toEqual([]);
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM member_sessions WHERE token_hash IN (?, ?)`).bind(...hashes).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("keeps at most five accounts in one browser", async () => {
    const b = new Browser();
    for (let i = 0; i < 6; i++) {
      const name = `fam${i}-${uid()}`;
      await b.post("/login", { handle: "joe", access_code: await team(name), add: "1" });
    }
    expect(b.tokens()).toHaveLength(5);
  });

  it("lasts 30 days, renewed while used; the sign-in page clears a cookie whose sessions ended", async () => {
    const smiths = `smiths-${uid()}`;
    const b = new Browser();
    await b.post("/login", { handle: "joe", access_code: await team(smiths) });
    const hash = await sha256Hex(b.tokens()[0]!);
    const expiry = async () => Date.parse((await env.DB.prepare("SELECT expires_at FROM member_sessions WHERE token_hash = ?").bind(hash).first<{ expires_at: string }>())!.expires_at);
    expect(await expiry()).toBeGreaterThan(Date.now() + 29.9 * 86_400_000);

    // Used two days before it ends: it gets 30 days again.
    await env.DB.prepare("UPDATE member_sessions SET expires_at = ? WHERE token_hash = ?").bind(new Date(Date.now() + 2 * 86_400_000).toISOString(), hash).run();
    expect((await b.get("/packets")).status).toBe(200);
    expect(await expiry()).toBeGreaterThan(Date.now() + 29.9 * 86_400_000);

    // Ended: pages send the browser to sign in, and the sign-in page clears the cookie.
    await env.DB.prepare("UPDATE member_sessions SET expires_at = ? WHERE token_hash = ?").bind(new Date(Date.now() - 1000).toISOString(), hash).run();
    expect((await b.get("/packets")).location).toBe("/login?next=%2Fpackets");
    await b.get("/login?next=%2Fpackets");
    expect(b.tokens()).toEqual([]);
  });

  it("the assistant sign-in asks for the username and code only, and signs this browser in", async () => {
    const smiths = `smiths-${uid()}`;
    const code = await team(smiths);
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const reg = await fetchAs("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri] }) });
    const { client_id } = (await reg.json()) as { client_id: string };
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`v-${crypto.randomUUID()}-${crypto.randomUUID()}`))));
    const oauth = { client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "threadpacket" };

    const b = new Browser();
    const page = (await b.get(`/authorize?${new URLSearchParams(oauth)}`)).text;
    const signIn = /<form method="post" action="\/authorize" class="flow-panel">[\s\S]*?<\/form>/.exec(page)![0];
    expect(signIn).not.toContain('name="team"');
    expect(signIn).toMatch(/id="handle"[^>]* autofocus/);

    // From this site's own sign-in page: the assistant gets its code, and the browser opens Packets signed in.
    const ok = await b.post("/authorize", { ...oauth, handle: "joe", access_code: code });
    expect(ok.status).toBe(302);
    expect(new URL(ok.headers.get("location")!).searchParams.get("code")).toMatch(/^hc_/);
    expect(b.tokens()).toHaveLength(1);
    expect(activeIn((await b.get("/packets")).text)).toBe(`${smiths}/joe`);

    // A sign-in form sent from anywhere else still answers the assistant, but signs no browser in.
    const other = new Browser();
    const elsewhere = await other.post("/authorize", { ...oauth, handle: "joe", access_code: code }, { origin: "https://evil.example" });
    expect(elsewhere.status).toBe(302);
    expect(other.tokens()).toEqual([]);
  });
});
