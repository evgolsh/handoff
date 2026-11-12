import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { base64url } from "../src/domain/ids";
import { ORIGIN, call, expectOk, token } from "./helpers";

/**
 * The hosted story, page by page. joe starts on the homepage, adds Handoff to his assistant, creates the team on
 * the sign-in page it opens, invites anna and sends her a handoff. anna opens her invitation, signs in and picks it
 * up. Each page they see uses their names and points to their next step, and none mixes in the private server's
 * tim and tom.
 */
const ctl = { ...env, THREADPACKET_MODE: "control" };
const uid = () => crypto.randomUUID().slice(0, 6);
const ip = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}-${uid()}`;
const fetchAs = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), ctl, createExecutionContext());
const form = (fields: Record<string, string>, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": ip(), ...headers },
  body: new URLSearchParams(fields),
});
const text = async (path: string, cookie?: string) => {
  const res = await fetchAs(path, cookie ? { headers: { cookie } } : {});
  expect(res.status, path).toBe(200);
  return res.text();
};

/** The hosted story's pages never fall back to the private server's names or the old example team. */
function hostedStory(html: string, page: string) {
  expect(html, page).not.toMatch(/\b(tim|tom|acme)\b/);
}
/** The "Try your first handoff" cards on /connect, in order. */
const cards = (html: string) => [...html.matchAll(/<p class="eyebrow">\d · ([^<]+)<\/p>/g)].map((m) => m[1]);

async function signIn(team: string, handle: string, code: string): Promise<string> {
  const res = await fetchAs("/login", form({ team, handle, access_code: code }));
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/packets");
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

describe("the hosted story: joe and anna", () => {
  it("joe starts from his assistant, invites anna and sends a packet; anna picks it up", async () => {
    // The hosted service is open once it has an operator.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES ('operator', 's', 'h', ?)").bind(new Date().toISOString()),
      env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES ('operator')"),
    ]);

    // The homepage: Get started leads to Assistant setup, and the live packet pane tells joe and anna's story.
    const home = await text("/");
    expect(home).toContain('<a class="site-button primary" href="/connect">Get started');
    hostedStory(home.slice(0, home.indexOf('class="courier-window pane-install"')), "/ (hero and live packet pane)");

    // Assistant setup, signed out: a new person creates the team when they sign in.
    const setup = await text("/connect");
    expect(setup).toContain("New to Threadpacket? Create your team when you sign in.");
    expect(setup).toContain("<strong>Create a team</strong> if you&#39;re new");
    expect(cards(setup)).toEqual(["Invite your partner", "Send a packet", "Pick up a packet"]);
    expect(setup).toContain("“Send a packet to anna.”");
    hostedStory(setup, "/connect");

    // joe's assistant opens the sign-in page; he creates the team there and the same sign-in finishes.
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const reg = await fetchAs("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri] }) });
    const { client_id } = (await reg.json()) as { client_id: string };
    const verifier = `verifier-${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const oauth = { client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "threadpacket" };
    const authorize = await text(`/authorize?${new URLSearchParams(oauth)}`);
    expect(authorize).toContain('id="new-team"');
    hostedStory(authorize, "/authorize");
    const team = `smiths-${uid()}`;
    const created = await fetchAs("/authorize", form({ ...oauth, action: "create_team", team, handle: "joe" }));
    expect(created.status).toBe(200);
    const createdPage = await created.text();
    hostedStory(createdPage, "/authorize (team created)");
    const joeCode = /tp-[A-Za-z0-9_-]{16}/.exec(createdPage)![0];
    const fields = Object.fromEntries([...createdPage.matchAll(/<input type="hidden" name="([a-z_]+)" value="([^"]*)">/g)].map((m) => [m[1]!, m[2]!]));
    expect((await fetchAs("/authorize", form(fields))).status).toBe(302);

    // In the browser, joe's Assistant setup shows what an admin does next: invite, then send a packet.
    const joe = await signIn(team, "joe", joeCode);
    const joeSetup = await text("/connect", joe);
    expect(cards(joeSetup)).toEqual(["Invite your partner", "Send a packet"]);
    expect(joeSetup).toContain("“Invite my partner to Threadpacket.”");
    hostedStory(joeSetup, "/connect (joe)");

    // joe's assistant invites anna; her link names joe and tells her what to say.
    const joeToken = await token(`${team}/joe`);
    const invite = expectOk(await call(joeToken, "threadpacket_invite", { username: "anna" }));
    const path = new URL(invite.invite_url as string).pathname;
    const preview = await text(path);
    expect(preview).toContain("joe invited you.");
    hostedStory(preview, "/invite (preview)");
    const opened = await fetchAs(path, { method: "POST" });
    const invitePage = await opened.text();
    expect(invitePage).toContain("“Continue the packet from joe.”");
    hostedStory(invitePage, "/invite (opened)");
    const annaCode = /tp-[A-Za-z0-9_-]{16}/.exec(invitePage)![0];

    // joe sends a packet; anna's Assistant setup puts picking it up first, and Packets and her assistant both have it.
    expectOk(await call(joeToken, "threadpacket_send", { title: "Tax letter", brief: "Call the tax office on Monday.", to: "anna", idempotency_key: crypto.randomUUID() }));
    const anna = await signIn(team, "anna", annaCode);
    const annaSetup = await text("/connect", anna);
    expect(cards(annaSetup)).toEqual(["Pick up a packet", "Send a packet"]);
    expect(annaSetup).not.toContain("Invite my partner");
    hostedStory(annaSetup, "/connect (anna)");
    const packets = await text("/packets", anna);
    expect(packets).toContain("Tax letter");
    expect(packets).toContain("joe");
    const inbox = expectOk(await call(await token(`${team}/anna`), "threadpacket_inbox", {}));
    expect(JSON.stringify(inbox.packets)).toContain('"from":"joe"');

    // The browser route reads the same: /join uses the hosted example names.
    const join = await text("/join");
    expect(join).toContain('placeholder="smiths"');
    expect(join).toContain('placeholder="joe"');
    hostedStory(join, "/join");
  });
});
