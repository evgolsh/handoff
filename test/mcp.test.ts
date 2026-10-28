import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { alice, bob, call, errorText, expectOk, rpc, send, token } from "./helpers";

describe("tool metadata", () => {
  it("declares truthful annotations and the OpenAI file adapter", async () => {
    const { body } = await rpc(await alice(), "tools/list");
    const tools = Object.fromEntries(body.result.tools.map((t: any) => [t.name, t]));

    expect(tools.handoff_inbox.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tools.handoff_read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tools.handoff_send.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(tools.handoff_revoke.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(tools.handoff_upload_url.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });

    expect(tools.handoff_send._meta["openai/fileParams"]).toEqual(["files"]);
    const files = tools.handoff_send.inputSchema.properties.files;
    const item = files.items.$ref ? resolveRef(tools.handoff_send.inputSchema, files.items.$ref) : files.items;
    expect(Object.keys(item.properties).sort()).toEqual(["download_url", "file_id", "file_name", "mime_type"]);
    expect([...item.required].sort()).toEqual(["download_url", "file_id"]);
    expect(tools.handoff_send.inputSchema.required).not.toContain("files");
    for (const t of Object.values(tools) as any[]) expect(t.outputSchema).toBeTruthy();
  });

  it("initialize returns server instructions with the two triggers", async () => {
    const { body } = await rpc(await alice(), "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(body.result.serverInfo.name).toBe("handoff");
    expect(body.result.instructions).toContain("hand this off");
    expect(body.result.instructions).toContain("continue my handoff");
  });
});

function resolveRef(root: any, ref: string): any {
  return ref.replace(/^#\//, "").split("/").reduce((o, k) => o[k], root);
}

describe("send, inbox, read", () => {
  it("round-trips the brief byte for byte", async () => {
    const a = await alice();
    const brief = "  Décision: garder Hono.\n\n\tTabs and nbsp, emoji 🚀, trailing spaces   \n\n";
    const sent = await send(a, { brief, title: "Exact brief" });
    expect(sent.replayed).toBe(false);
    expect(String(sent.packet_id)).toMatch(/^pk_/);

    const inbox = expectOk(await call(a, "handoff_inbox"));
    expect((inbox.packets as any[]).map((p) => p.packet_id)).toContain(sent.packet_id);
    expect((inbox.packets as any[])[0]).not.toHaveProperty("brief");

    const read = expectOk(await call(a, "handoff_read", { packet_id: sent.packet_id }));
    expect(read.brief).toBe(brief);
    expect(read.title).toBe("Exact brief");
    expect(read.attachments).toEqual([]);
  });

  it("reading does not change the inbox (no read receipts)", async () => {
    const a = await alice();
    const sent = await send(a);
    await call(a, "handoff_read", { packet_id: sent.packet_id });
    await call(a, "handoff_read", { packet_id: sent.packet_id });
    const inbox = expectOk(await call(a, "handoff_inbox"));
    expect((inbox.packets as any[]).find((p) => p.packet_id === sent.packet_id)).toBeTruthy();
  });

  it("pages the inbox newest first with a cursor", async () => {
    const a = await token(`user_pager_${crypto.randomUUID()}`); // a user with no other packets
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(String((await send(a, { title: `n${i}` })).packet_id));
    const p1 = expectOk(await call(a, "handoff_inbox", { limit: 2 }));
    expect((p1.packets as any[]).length).toBe(2);
    expect(p1.next_cursor).toBeTruthy();
    const p2 = expectOk(await call(a, "handoff_inbox", { limit: 2, cursor: p1.next_cursor }));
    const p3 = expectOk(await call(a, "handoff_inbox", { limit: 2, cursor: p2.next_cursor }));
    const seen = [...(p1.packets as any[]), ...(p2.packets as any[]), ...(p3.packets as any[])].map((p) => p.packet_id);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of ids) expect(seen).toContain(id);
    expect(p3.next_cursor).toBeNull();
  });

  it("rejects an empty brief and an over-long title", async () => {
    const a = await alice();
    const r1 = await call(a, "handoff_send", { title: "t", brief: "   ", idempotency_key: crypto.randomUUID() });
    expect(errorText(r1)).toContain("invalid_input");
    const { body } = await rpc(a, "tools/call", { name: "handoff_send", arguments: { title: "x".repeat(201), brief: "b", idempotency_key: "k" } });
    expect(body.result?.isError ?? body.error).toBeTruthy();
  });
});

describe("idempotency", () => {
  it("an identical retry returns the same packet and creates nothing new", async () => {
    const a = await alice();
    const key = crypto.randomUUID();
    const first = await send(a, { idempotency_key: key, title: "once" });
    const again = await send(a, { idempotency_key: key, title: "once" });
    expect(again.packet_id).toBe(first.packet_id);
    expect(again.replayed).toBe(true);
    const inbox = expectOk(await call(a, "handoff_inbox"));
    expect((inbox.packets as any[]).filter((p) => p.title === "once")).toHaveLength(1);
  });

  it("the same key with different content is a conflict", async () => {
    const a = await alice();
    const key = crypto.randomUUID();
    await send(a, { idempotency_key: key, title: "v1" });
    const r = await call(a, "handoff_send", { title: "v2", brief: "changed", idempotency_key: key });
    expect(errorText(r)).toContain("idempotency_conflict");
  });

  it("keys are scoped per owner", async () => {
    const key = crypto.randomUUID();
    const pa = await send(await alice(), { idempotency_key: key });
    const pb = await send(await bob(), { idempotency_key: key });
    expect(pa.packet_id).not.toBe(pb.packet_id);
  });
});

describe("isolation, revocation, expiry", () => {
  it("another identity cannot list or read the packet", async () => {
    const a = await alice();
    const b = await bob();
    const sent = await send(a, { title: "alice only" });
    const inboxB = expectOk(await call(b, "handoff_inbox"));
    expect((inboxB.packets as any[]).map((p) => p.packet_id)).not.toContain(sent.packet_id);
    expect(errorText(await call(b, "handoff_read", { packet_id: sent.packet_id }))).toContain("not_found");
    expect(errorText(await call(b, "handoff_revoke", { packet_id: sent.packet_id }))).toContain("not_found");
    // Still readable by the owner afterwards.
    expectOk(await call(a, "handoff_read", { packet_id: sent.packet_id }));
  });

  it("revoke removes the packet from the inbox and from read", async () => {
    const a = await alice();
    const sent = await send(a);
    const r = expectOk(await call(a, "handoff_revoke", { packet_id: sent.packet_id }));
    expect(r.revoked_at).toBeTruthy();
    expect(errorText(await call(a, "handoff_read", { packet_id: sent.packet_id }))).toContain("revoked");
    const inbox = expectOk(await call(a, "handoff_inbox"));
    expect((inbox.packets as any[]).map((p) => p.packet_id)).not.toContain(sent.packet_id);
    // Revoking twice is harmless.
    expectOk(await call(a, "handoff_revoke", { packet_id: sent.packet_id }));
  });

  it("an expired packet is hidden and reads as expired", async () => {
    const a = await alice();
    const sent = await send(a, { expires_in_hours: 1 });
    const past = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare("UPDATE packets SET expires_at = ? WHERE id = ?").bind(past, sent.packet_id).run();
    expect(errorText(await call(a, "handoff_read", { packet_id: sent.packet_id }))).toContain("expired");
    const inbox = expectOk(await call(a, "handoff_inbox"));
    expect((inbox.packets as any[]).map((p) => p.packet_id)).not.toContain(sent.packet_id);
  });

  it("expiry bounds are enforced", async () => {
    const a = await alice();
    const sent = await send(a, { expires_in_hours: 2 });
    const ms = Date.parse(String(sent.expires_at)) - Date.parse(String(sent.created_at));
    expect(ms).toBe(2 * 3_600_000);
    const { body } = await rpc(a, "tools/call", { name: "handoff_send", arguments: { title: "t", brief: "b", idempotency_key: "k2", expires_in_hours: 100000 } });
    expect(body.result?.isError ?? body.error).toBeTruthy();
  });
});
