import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { upsertMember } from "../src/auth/builtin";
import { ORIGIN, call, errorText, expectOk, token } from "./helpers";

/**
 * Assets, redesigned around "Did she get it?": a recipient's first read in an assistant is a pickup, opening it in
 * the browser is "Opened", and the sender sees both in Assets, on the handoff's page and in their assistant's
 * inbox. A handoff not yet opened is new for its recipient. The sender can revoke it in the browser. A member with
 * nothing yet sees their next steps.
 */
const ctl = { ...env, HANDOFF_MODE: "control" };
const uid = () => crypto.randomUUID().slice(0, 6);
const ip = () => `192.0.2.${Math.floor(Math.random() * 250) + 1}-${uid()}`;
const fetchAs = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), ctl, createExecutionContext());
const form = (fields: Record<string, string>, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": ip(), ...headers },
  body: new URLSearchParams(fields),
});

/** An assistant as the server knows it: a registered OAuth client with a name. */
async function assistant(name: string): Promise<string> {
  const id = `client-${uid()}`;
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, JSON.stringify(["https://example.com/callback"]), name, new Date().toISOString())
    .run();
  return id;
}

interface Person {
  handle: string;
  identity: string;
  cookie: string;
  page: (path?: string) => Promise<string>;
  csrf: () => Promise<string>;
  /** This person's assistant: Claude for joe, ChatGPT for the others. */
  mcp: (tool: string, args?: Record<string, unknown>) => ReturnType<typeof call>;
}

/** A team: joe creates it (admin); the others are members. Each signs in in the browser and has an assistant. */
async function family(...others: string[]): Promise<{ team: string; people: Record<string, Person> }> {
  const team = `smiths-${uid()}`;
  const created = await fetchAs("/join", form({ team, handle: "joe" }));
  const codes: Record<string, string> = { joe: /hf-[A-Za-z0-9_-]{16}/.exec(await created.text())![0] };
  for (const h of others) {
    codes[h] = `code-for-${h}-${uid()}`;
    await upsertMember(env.DB, `${team}/${h}`, codes[h]!);
  }
  const [claude, chatgpt] = [await assistant("Claude"), await assistant("ChatGPT")];
  const people: Record<string, Person> = {};
  for (const handle of ["joe", ...others]) {
    const res = await fetchAs("/login", form({ team, handle, access_code: codes[handle]! }));
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-handoff-session="))!.split(";")[0]!;
    const page = async (path = "") => (await fetchAs(`/assets${path}`, { headers: { cookie } })).text();
    const identity = `${team}/${handle}`;
    const bearer = await token(identity, { clientId: handle === "joe" ? claude : chatgpt });
    people[handle] = {
      handle,
      identity,
      cookie,
      page,
      csrf: async () => /name="csrf" value="([0-9a-f]{64})"/.exec(await page())![1]!,
      mcp: (tool, args = {}) => call(bearer, tool, args),
    };
  }
  return { team, people };
}

const sendTo = async (from: Person, to: string | undefined, title: string): Promise<string> =>
  expectOk(await from.mcp("handoff_send", { title, brief: `Brief for ${title}.`, ...(to ? { to } : {}), idempotency_key: crypto.randomUUID() })).packet_id as string;

/** The Assets row of a handoff, by its title. */
const rowOf = (html: string, title: string) => {
  const rows = html.split('<article class="asset">');
  return rows.find((r) => r.includes(`>${title}</a>`)) ?? "";
};
const pickupCount = async (packetId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM packet_pickups WHERE packet_id = ?").bind(packetId).first<{ n: number }>())!.n;

describe("pickups: did she get it?", () => {
  it("anna picks up joe's handoff in her assistant; joe sees it in Assets, on its page and in his own assistant", async () => {
    const { people } = await family("anna");
    const { joe, anna } = people as Record<"joe" | "anna", Person>;
    const id = await sendTo(joe, "anna", "Tax letter");

    // Before: joe waits, anna has it as new.
    expect(rowOf(await joe.page(), "Tax letter")).toContain("Not picked up yet");
    const before = expectOk(await joe.mcp("handoff_inbox"));
    expect((before.packets as Array<{ waiting: string[] }>)[0]!.waiting).toEqual(["anna"]);
    expect((await joe.mcp("handoff_inbox")).content[0]!.text).toContain("; not picked up yet by anna)");
    const annaBefore = await anna.page();
    expect(annaBefore).toContain(">New for you</h2>");
    expect(annaBefore).toContain("<q>Continue the handoff from joe.</q>");

    // joe reading his own handoff is not a pickup.
    expectOk(await joe.mcp("handoff_read", { packet_id: id }));
    expect(await pickupCount(id)).toBe(0);

    // anna's assistant reads it, twice: one pickup, named after her assistant.
    expectOk(await anna.mcp("handoff_read", { packet_id: id }));
    expectOk(await anna.mcp("handoff_read", { packet_id: id }));
    expect(await pickupCount(id)).toBe(1);

    const row = rowOf(await joe.page(), "Tax letter");
    expect(row).toContain("Picked up by anna</span>");
    expect(row).toContain("in ChatGPT · just now");
    const page = await (await fetchAs(`/assets/handoff/${id}`, { headers: { cookie: joe.cookie } })).text();
    expect(page).toContain("<p class=\"lead\">Sent <span");
    expect(page).toContain("Sent by you from Claude");
    expect(page).toContain("<span>Picked up by anna in ChatGPT</span>");
    expect(page).not.toContain("anna picks it up by saying");

    // joe's assistant can answer "Did anna get it?".
    const inbox = await joe.mcp("handoff_inbox");
    expect(inbox.content[0]!.text).toMatch(/"Tax letter" \(from joe -> anna, sent [^,]+, 0 attachments; picked up by anna in ChatGPT at \d{4}-/);
    const p = (inbox.structuredContent!.packets as Array<{ pickups: unknown[]; waiting: string[] }>)[0]!;
    expect(p.pickups).toMatchObject([{ by: "anna", via: "assistant", assistant: "ChatGPT" }]);
    expect(p.waiting).toEqual([]);

    // anna's side: picked up by her, no longer new.
    const annaAfter = await anna.page();
    expect(annaAfter).not.toContain("New for you");
    expect(rowOf(annaAfter, "Tax letter")).toContain("You picked it up</span>");
    expect((await anna.mcp("handoff_inbox")).content[0]!.text).toContain("; picked up by you in ChatGPT at ");
  });

  it("opening it in the browser is Opened, not picked up, and it is no longer new", async () => {
    const { people } = await family("anna");
    const { joe, anna } = people as Record<"joe" | "anna", Person>;
    const id = await sendTo(joe, "anna", "Weekend plan");
    expect(await anna.page()).toContain(">Weekend plan</a>");
    expect(await anna.page()).toContain(">New for you</h2>");

    expect((await fetchAs(`/assets/handoff/${id}`, { headers: { cookie: anna.cookie } })).status).toBe(200);
    const row = rowOf(await joe.page(), "Weekend plan");
    expect(row).toContain("Opened by anna</span>");
    expect(row).toContain("in the browser · just now");
    const annaPage = await anna.page();
    expect(annaPage).not.toContain("New for you");
    expect(rowOf(annaPage, "Weekend plan")).toContain("You opened it</span>");
    // joe still sees what anna says to pick it up, until her assistant does.
    const page = await (await fetchAs(`/assets/handoff/${id}`, { headers: { cookie: joe.cookie } })).text();
    expect(page).toContain("<span>Opened by anna in the browser</span>");
    expect(page).toContain("anna picks it up by saying <q>Continue the handoff from joe.</q>");
  });

  it("a team handoff shows who picked it up and who has not yet", async () => {
    const { people } = await family("anna", "ben");
    const { joe, anna } = people as Record<"joe" | "anna" | "ben", Person>;
    const id = await sendTo(joe, "team", "Holiday packing list");
    expectOk(await anna.mcp("handoff_read", { packet_id: id }));
    const row = rowOf(await joe.page(), "Holiday packing list");
    expect(row).toContain("To the team · Brief only");
    expect(row).toContain("Picked up by anna</span>");
    expect(row).toContain("ben not yet");
    const page = await (await fetchAs(`/assets/handoff/${id}`, { headers: { cookie: joe.cookie } })).text();
    expect(page).toContain("Waiting for ben");
    expect((await joe.mcp("handoff_inbox")).content[0]!.text).toContain("picked up by anna in ChatGPT at ");
    expect((await joe.mcp("handoff_inbox")).content[0]!.text).toContain("; not picked up yet by ben)");
    // A teammate sees only their own pickup, not who else picked it up.
    const ben = (people as Record<string, Person>).ben!;
    expect((expectOk(await ben.mcp("handoff_inbox")).packets as Array<{ pickups: unknown[] }>)[0]!.pickups).toEqual([]);
  });

  it("filters show what joe sent or what he received; a handoff to himself counts as sent", async () => {
    const { people } = await family("anna");
    const { joe, anna } = people as Record<"joe" | "anna", Person>;
    await sendTo(joe, "anna", "Tax letter");
    await sendTo(joe, undefined, "Budget notes");
    await sendTo(anna, "joe", "Summer camp options");
    const sent = await joe.page("?show=sent");
    expect(sent).toContain('<a href="/assets?show=sent" aria-current="page">Sent</a>');
    expect(sent).toContain(">Tax letter</a>");
    expect(sent).toContain(">Budget notes</a>");
    expect(sent).not.toContain("Summer camp options");
    const received = await joe.page("?show=received");
    expect(received).toContain("Summer camp options");
    expect(received).not.toContain(">Tax letter</a>");
    expect(received).not.toContain(">Budget notes</a>");
  });

  it("only the sender can revoke in the browser, after a page that asks first", async () => {
    const { people } = await family("anna");
    const { joe, anna } = people as Record<"joe" | "anna", Person>;
    const id = await sendTo(joe, "anna", "Old bank details");
    expectOk(await anna.mcp("handoff_read", { packet_id: id }));
    const path = `/assets/handoff/${id}/revoke`;
    expect(await (await fetchAs(`/assets/handoff/${id}`, { headers: { cookie: joe.cookie } })).text()).toContain(`<a class="btn sm danger" href="${path}">Revoke</a>`);
    expect(await (await fetchAs(`/assets/handoff/${id}`, { headers: { cookie: anna.cookie } })).text()).not.toContain(path);

    // anna received it: she cannot revoke it here.
    expect((await fetchAs(path, { headers: { cookie: anna.cookie } })).status).toBe(404);
    expect((await fetchAs(path, form({ csrf: await anna.csrf() }, { cookie: anna.cookie }))).status).toBe(404);

    const seen = await pickupCount(id);
    const ask = await (await fetchAs(path, { headers: { cookie: joe.cookie } })).text();
    expect(ask).toContain("<h1>Revoke “Old bank details”?</h1>");
    expect(ask).toContain("anna already picked it up: what their assistant read stays in that chat.");
    // The page that asks records nothing.
    expect(await pickupCount(id)).toBe(seen);

    expect((await fetchAs(path, form({}, { cookie: joe.cookie }))).status).toBe(403);
    expect((await fetchAs(path, form({ csrf: await joe.csrf() }, { cookie: joe.cookie, origin: "https://evil.example" }))).status).toBe(403);
    const done = await fetchAs(path, form({ csrf: await joe.csrf() }, { cookie: joe.cookie }));
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/assets?revoked=1");
    expect(await joe.page("?revoked=1")).toContain("Handoff revoked. No one can open it now.");
    expect(errorText(await anna.mcp("handoff_read", { packet_id: id }))).toContain("revoked");
    expect(await anna.page()).not.toContain("Old bank details");
  });

  it("a first day shows next steps: connect an assistant, invite (admins), hand off", async () => {
    const { team, people } = await family();
    const joe = people.joe!;
    const first = await joe.page();
    expect(first).toContain("<h2 id=\"first-h\">Your first handoff</h2>");
    expect(first).toContain("Add Handoff to your assistant");
    expect(first).toContain("<q>Invite my partner to Handoff.</q>");
    expect(first).toContain("<q>Hand this off.</q>");
    expect(first).not.toContain("aria-label=\"Handoffs\"");

    // anna joins and joe's Claude is connected: the steps say so.
    await upsertMember(env.DB, `${team}/anna`, `code-for-anna-${uid()}`);
    const claude = await assistant("Claude");
    await env.DB.prepare("INSERT INTO oauth_refresh_tokens (token_hash, client_id, subject, scope, expires_at) VALUES (?, ?, ?, 'handoff', ?)")
      .bind(`h-${uid()}`, claude, `${team}/joe`, new Date(Date.now() + 86_400_000).toISOString())
      .run();
    const next = await joe.page();
    expect(next).toContain("Handoff is in your assistant");
    expect(next).toContain("Claude connected.");
    expect(next).toContain("<q>Hand this off to anna.</q>");

    // Once there is a handoff, the list replaces the steps.
    await sendTo(joe, "anna", "Tax letter");
    expect(await joe.page()).not.toContain("Your first handoff");
  });

  it("a member who is not an admin is not asked to invite anyone", async () => {
    const { people } = await family("anna");
    const anna = people.anna!;
    const page = await anna.page();
    expect(page).toContain("Your first handoff");
    expect(page).not.toContain("Invite my partner");
    expect(page).toContain("<q>Hand this off to joe.</q>");
  });
});
