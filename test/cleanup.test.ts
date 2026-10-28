import { describe, expect, it } from "vitest";
import { SELF, createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { ORIGIN, PDF, alice, call, expectOk, send, uploadBytes } from "./helpers";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe("scheduled cleanup", () => {
  it("removes stale staging uploads, old unattached files and long-expired packets with their blobs", async () => {
    const a = await alice();
    // Staging upload from two days ago.
    const created = await SELF.fetch(`${ORIGIN}/v1/uploads`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: JSON.stringify({ filename: "never.pdf" }) });
    const staging = ((await created.json()) as any).attachment_id as string;
    await env.DB.prepare("UPDATE attachments SET created_at = ? WHERE id = ?").bind(daysAgo(2), staging).run();

    // Ready but never attached, eight days old.
    const loose = await uploadBytes(a, "loose.pdf", PDF, "application/pdf");
    await env.DB.prepare("UPDATE attachments SET created_at = ? WHERE id = ?").bind(daysAgo(8), loose.attachment_id).run();

    // Fresh ready, unattached: must survive.
    const fresh = await uploadBytes(a, "fresh.pdf", PDF, "application/pdf");

    // Packet expired eight days ago, with an attachment used only there.
    const old = await uploadBytes(a, "old.pdf", PDF, "application/pdf");
    const dead = await send(a, { attachment_ids: [old.attachment_id] });
    await env.DB.prepare("UPDATE packets SET expires_at = ? WHERE id = ?").bind(daysAgo(8), dead.packet_id).run();

    // Live packet sharing an attachment with an expired one: the attachment must survive.
    const shared = await uploadBytes(a, "shared.pdf", PDF, "application/pdf");
    const live = await send(a, { attachment_ids: [shared.attachment_id] });
    const deadToo = await send(a, { attachment_ids: [shared.attachment_id] });
    await env.DB.prepare("UPDATE packets SET expires_at = ? WHERE id = ?").bind(daysAgo(9), deadToo.packet_id).run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "17 3 * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    const row = (id: string) => env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(id).first();
    expect(await row(staging)).toBeNull();
    expect(await row(loose.attachment_id)).toBeNull();
    expect(await row(old.attachment_id)).toBeNull();
    expect(await row(fresh.attachment_id)).not.toBeNull();
    expect(await row(shared.attachment_id)).not.toBeNull();
    expect(await env.DB.prepare("SELECT id FROM packets WHERE id = ?").bind(dead.packet_id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM packets WHERE id = ?").bind(deadToo.packet_id).first()).toBeNull();

    const blobKey = (id: string) => `att/user_alice/${id}`;
    expect(await env.BLOBS.head(blobKey(old.attachment_id))).toBeNull();
    expect(await env.BLOBS.head(blobKey(loose.attachment_id))).toBeNull();
    expect(await env.BLOBS.head(blobKey(shared.attachment_id))).not.toBeNull();

    const view = expectOk(await call(a, "handoff_read", { packet_id: live.packet_id, attachment_id: shared.attachment_id, representation: "original" }));
    expect((await SELF.fetch(String(view.download_url))).status).toBe(200);
  });
});
