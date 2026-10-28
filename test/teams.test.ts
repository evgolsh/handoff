import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { upsertMember } from "../src/auth/builtin";
import { ORIGIN, PDF, PNG, alice, bob, call, errorText, expectOk, send, sha256Hex, token, uploadBytes, type ToolResult } from "./helpers";

// Members' tokens are signed by the test key, which is this Worker's signing key in the tests (vitest.config.ts).
const teamFetch = (url: string, init?: RequestInit) => SELF.fetch(url, init);
const member = (handle: string) => token(handle);

let rpcId = 1000;
async function teamCall(bearer: string, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const res = await teamFetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: ToolResult }).result;
}
const teamSend = async (bearer: string, overrides: Record<string, unknown>) =>
  expectOk(await teamCall(bearer, "handoff_send", { title: "Q3 VAT", brief: "Purpose: file Q3 VAT.", idempotency_key: crypto.randomUUID(), ...overrides }));
async function teamUpload(bearer: string, filename: string, bytes: Uint8Array, mime: string): Promise<string> {
  const created = await teamFetch(`${ORIGIN}/v1/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ filename, mime_type: mime }),
  });
  const { attachment_id, upload_url } = (await created.json()) as { attachment_id: string; upload_url: string };
  const put = await teamFetch(upload_url, { method: "PUT", headers: { authorization: `Bearer ${bearer}`, "content-type": mime }, body: bytes });
  expect(put.status).toBe(200);
  return attachment_id;
}
const inboxIds = async (bearer: string) =>
  ((expectOk(await teamCall(bearer, "handoff_inbox")).packets as Array<{ packet_id: string }>) ?? []).map((p) => p.packet_id);

async function seedTeam() {
  for (const h of ["alice", "bob", "mallory"]) await upsertMember(env.DB, h, `${h}-passcode-2026`);
}

describe("teammates", () => {
  it("delivers a brief and its files to a named member, and keeps them from other members", async () => {
    await seedTeam();
    const [a, b, m] = await Promise.all([member("alice"), member("bob"), member("mallory")]);
    const pdf = await teamUpload(a, "vat-q3.pdf", PDF, "application/pdf");
    const png = await teamUpload(a, "receipt.png", PNG, "image/png");
    const sent = await teamSend(a, { to: "Bob", attachment_ids: [pdf, png] });
    expect(sent).toMatchObject({ from: "alice", to: "bob" });

    const summary = (expectOk(await teamCall(b, "handoff_inbox")).packets as any[]).find((p) => p.packet_id === sent.packet_id);
    expect(summary).toMatchObject({ from: "alice", to: "bob", attachment_count: 2 });
    const read = await teamCall(b, "handoff_read", { packet_id: sent.packet_id });
    expect(expectOk(read)).toMatchObject({ from: "alice", to: "bob", brief: "Purpose: file Q3 VAT." });
    expect(read.content[0]?.text).toContain("from alice to bob");
    expect(expectOk(await teamCall(b, "handoff_read", { packet_id: sent.packet_id, attachment_id: png })).representation).toBe("image");

    const ticket = expectOk(await teamCall(b, "handoff_read", { packet_id: sent.packet_id, attachment_id: pdf, representation: "original" }));
    const dl = await teamFetch(String(ticket.download_url));
    expect(await sha256Hex(new Uint8Array(await dl.arrayBuffer()))).toBe(await sha256Hex(PDF));
    expect((await teamFetch(`${ORIGIN}/v1/attachments/${pdf}/original`, { headers: { authorization: `Bearer ${b}` } })).status).toBe(200);

    // Another member is not the recipient.
    expect(await inboxIds(m)).not.toContain(sent.packet_id);
    expect(errorText(await teamCall(m, "handoff_read", { packet_id: sent.packet_id }))).toContain("not_found");
    expect(errorText(await teamCall(m, "handoff_revoke", { packet_id: sent.packet_id }))).toContain("not_found");
    expect((await teamFetch(`${ORIGIN}/v1/attachments/${pdf}/original`, { headers: { authorization: `Bearer ${m}` } })).status).toBe(404);

    // The recipient may revoke it when done; the download link stops at once.
    expectOk(await teamCall(b, "handoff_revoke", { packet_id: sent.packet_id }));
    expect((await teamFetch(String(ticket.download_url))).status).toBe(410);
  });

  it("sends to every member with to: team, and only the sender revokes such a packet", async () => {
    await seedTeam();
    const [a, b] = await Promise.all([member("alice"), member("bob")]);
    const sent = await teamSend(a, { title: "Family groceries", to: "team" });
    expect(sent.to).toBe("*");
    expect(await inboxIds(b)).toContain(sent.packet_id);
    expect(expectOk(await teamCall(b, "handoff_read", { packet_id: sent.packet_id })).title).toBe("Family groceries");
    expect(errorText(await teamCall(b, "handoff_revoke", { packet_id: sent.packet_id }))).toContain("only its sender can revoke it");
    expectOk(await teamCall(a, "handoff_revoke", { packet_id: sent.packet_id }));
    expect(await inboxIds(b)).not.toContain(sent.packet_id);
  });

  it("refuses a recipient who is not a member, and stores nothing", async () => {
    await seedTeam();
    const a = await member("alice");
    const title = `to a stranger ${crypto.randomUUID()}`;
    const r = await teamCall(a, "handoff_send", { title, brief: "x", to: "carol", idempotency_key: crypto.randomUUID() });
    expect(errorText(r)).toContain('"carol" is not a member of this server');
    const titles = (expectOk(await teamCall(a, "handoff_inbox")).packets as Array<{ title: string }>).map((p) => p.title);
    expect(titles).not.toContain(title);
  });
});

describe("sign-in", () => {
  it("does not send a code to a client that never registered", async () => {
    await upsertMember(env.DB, "tom", "tom-passcode-2026");
    const res = await teamFetch(`${ORIGIN}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "Claude Code",
        redirect_uri: "https://attacker.example/cb",
        response_type: "code",
        code_challenge: "x".repeat(43),
        code_challenge_method: "S256",
        handle: "tom",
        access_code: "tom-passcode-2026",
      }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    const html = await res.text();
    expect(html).toContain("did not come from an assistant registered with this server");
    expect(html).not.toContain("<form");
    // The error page has the first page's headers, without a form-action that would block the redirect on a retry.
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("form-action");
  });

  it("an unlisted handle cannot sign in", async () => {
    const r = await teamFetch(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:9/cb"] }),
    });
    const { client_id } = (await r.json()) as { client_id: string };
    const res = await teamFetch(`${ORIGIN}/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id,
        redirect_uri: "http://127.0.0.1:9/cb",
        code_challenge: "x".repeat(43),
        handle: "nobody",
        access_code: "whatever-code",
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe("text attachments in the structured result", () => {
  it("carries the text, for hosts that show only structuredContent (Claude Code)", async () => {
    const a = await alice();
    const body = "# Notes\n\nFile-only codeword: KESTREL-1234\n";
    const up = await uploadBytes(a, "notes.md", new TextEncoder().encode(body), "text/markdown");
    const p = await send(a, { attachment_ids: [up.attachment_id] });
    const r = await call(a, "handoff_read", { packet_id: p.packet_id, attachment_id: up.attachment_id, representation: "text" });
    expect(expectOk(r).text).toBe(body);
    expect(r.content[1]?.text).toBe(body);
  });
});
