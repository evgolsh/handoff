// Regression tests for the four-model committee review of 5ca7acf (docs/COMMITTEE_REVIEW.md, 2026-10-26).
import { describe, expect, it, vi } from "vitest";
import { SELF, createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { SignJWT, importJWK } from "jose";
import worker from "../src/index";
import { configFrom, type Config } from "../src/env";
import { HandoffService } from "../src/domain/service";
import { D1Repository } from "../src/store/d1";
import { R2BlobStore } from "../src/store/blobs";
import privateJwk from "./fixtures/test-private-jwk.json";
import { AUDIENCE, ISSUER, ORIGIN, PDF, alice, call, errorText, expectOk, rpc, send, uploadBytes } from "./helpers";

const service = (overrides: Partial<Config> = {}) =>
  new HandoffService(new D1Repository(env.DB), new R2BlobStore(env.BLOBS), { ...configFrom(env), ...overrides });
const owner = () => ({ subject: `user_${crypto.randomUUID()}`, scopes: [], clientId: "t", token: "" });

async function signed(claims: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("user_alice")
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .sign(await importJWK(privateJwk, "ES256"));
}

describe("2.1: only OAuth access tokens are accepted", () => {
  it("refuses a token without client_id, and the challenge says why", async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${await signed({ scope: "openid email" })}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("no client_id");
  });

  it("accepts an access token that names its client", async () => {
    const bearer = await signed({ client_id: "client_test_1", scope: "handoff offline_access", jti: "j1" });
    expect((await rpc(bearer, "tools/list")).status).toBe(200);
  });
});

describe("2.3: replaying a key whose packet is gone", () => {
  it("a revoked packet is not reported as sent; the error asks for a new key", async () => {
    const a = await alice();
    const key = crypto.randomUUID();
    const sent = await send(a, { idempotency_key: key, title: "to revoke" });
    expectOk(await call(a, "handoff_revoke", { packet_id: sent.packet_id }));
    const text = errorText(await call(a, "handoff_send", { title: "to revoke", brief: "Purpose: ship the VAT fix.\nDecision: keep Hono.\nNext: run the tests.", idempotency_key: key }));
    expect(text).toContain("revoked");
    expect(text).toContain(String(sent.packet_id));
    expect(text).toContain("new idempotency_key");
  });

  it("an expired packet is not reported as sent", async () => {
    const a = await alice();
    const key = crypto.randomUUID();
    const sent = await send(a, { idempotency_key: key, title: "to expire" });
    await env.DB.prepare("UPDATE packets SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 60_000).toISOString(), sent.packet_id).run();
    const text = errorText(await call(a, "handoff_send", { title: "to expire", brief: "Purpose: ship the VAT fix.\nDecision: keep Hono.\nNext: run the tests.", idempotency_key: key }));
    expect(text).toContain("expired");
    expect(text).toContain("new idempotency_key");
  });

  it("a repeated attachment id does not change the request: the retry replays", async () => {
    const a = await alice();
    const file = await uploadBytes(a, "dup.pdf", PDF, "application/pdf");
    const key = crypto.randomUUID();
    const first = await send(a, { idempotency_key: key, attachment_ids: [file.attachment_id, file.attachment_id] });
    const again = await send(a, { idempotency_key: key, attachment_ids: [file.attachment_id] });
    expect(again.packet_id).toBe(first.packet_id);
    expect(again.replayed).toBe(true);
  });
});

describe("2.5: limits and cleanup", () => {
  it("refuses a new upload when the owner holds too many unsent files, and sending them frees the room", async () => {
    const svc = service({ maxUnsentFilesPerOwner: 2 });
    const p = owner();
    const one = await svc.createUpload(p, { filename: "1.pdf" });
    await svc.receiveBytes(one, PDF, { mime_type: "application/pdf" });
    await svc.createUpload(p, { filename: "2.pdf" }); // staging counts too
    await expect(svc.createUpload(p, { filename: "3.pdf" })).rejects.toMatchObject({ code: "quota_exceeded", status: 429 });
    await svc.send(p, { title: "t", brief: "b", attachment_ids: [one.id], idempotency_key: crypto.randomUUID() });
    await expect(svc.createUpload(p, { filename: "3.pdf" })).resolves.toMatchObject({ state: "staging" });
  });

  it("cleanup works through more than one batch, and reports a backlog when it stops early", async () => {
    const svc = service({ cleanupBatch: 2, cleanupRounds: 2 });
    const p = owner();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await svc.createUpload(p, { filename: `${i}.pdf` })).id);
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await env.DB.prepare(`UPDATE attachments SET created_at = ? WHERE owner = ?`).bind(old, p.subject).run();
    const left = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner = ?").bind(p.subject).first<{ n: number }>())!.n;

    const first = await svc.cleanup();
    expect(first).toMatchObject({ attachments_deleted: 4, backlog: true });
    expect(await left()).toBe(1);
    const second = await svc.cleanup();
    expect(second).toMatchObject({ attachments_deleted: 1, backlog: false });
    expect(await left()).toBe(0);
  });

  it("a failed scheduled cleanup writes an error line and the run fails", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
    const broken = { ...env, DB: { prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database };
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "17 * * * *" }), broken, ctx);
    const outcome = await waitOnExecutionContext(ctx).then(
      () => "resolved",
      () => "rejected",
    );
    spy.mockRestore();
    const line = lines.map((l) => JSON.parse(l)).find((l) => l.event === "cleanup");
    expect(line).toMatchObject({ level: "error", event: "cleanup", message: "D1 unavailable" });
    expect(outcome).toBe("rejected");
  });
});
