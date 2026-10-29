import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import { runCleanup } from "../src/cleanup";
import { KvBlobStore, R2BlobStore, blobStore } from "../src/store/blobs";
import { alice, ORIGIN, PDF, sha256Hex } from "./helpers";

/**
 * A self-hosted install keeps files in Workers KV (no payment method needed on Cloudflare); R2 is optional.
 * The suite otherwise runs on R2, so these tests take the R2 bucket away and go through the HTTP app.
 */
const kvOnly = { ...env, BLOBS: undefined } as unknown as typeof env;
const ctx = createExecutionContext();
const fetchKv = (input: string, init?: RequestInit) => worker.fetch(new Request(input, init), kvOnly, ctx);

async function upload(bearer: string, bytes: Uint8Array) {
  const created = await fetchKv(`${ORIGIN}/v1/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ filename: "brief.pdf", mime_type: "application/pdf" }),
  });
  expect(created.status).toBe(201);
  const { attachment_id, upload_url } = (await created.json()) as { attachment_id: string; upload_url: string };
  const put = await fetchKv(upload_url, { method: "PUT", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/pdf" }, body: bytes });
  expect(put.status).toBe(200);
  return attachment_id;
}

async function rpc(bearer: string, name: string, args: Record<string, unknown>) {
  const res = await fetchKv(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:")) ?? text;
  const msg = JSON.parse(line.replace(/^data:\s*/, ""));
  expect(msg.result?.isError, JSON.stringify(msg.result?.content)).toBeFalsy();
  return msg.result.structuredContent as Record<string, any>;
}

describe("Workers KV as the file store", () => {
  it("picks the R2 bucket when one is bound, otherwise the KV namespace, and refuses to run with neither", () => {
    expect(blobStore(env)).toBeInstanceOf(R2BlobStore);
    expect(blobStore({ FILES: env.FILES })).toBeInstanceOf(KvBlobStore);
    expect(() => blobStore({})).toThrow(/FILES.*BLOBS/);
  });

  it("stores an upload in KV with its type and size, serves it back by download ticket, and cleanup deletes it", async () => {
    const bearer = await alice();
    const id = await upload(bearer, PDF);
    const sent = await rpc(bearer, "handoff_send", { title: "KV test", brief: "Files live in KV on this server.", attachment_ids: [id], idempotency_key: crypto.randomUUID() });
    const packetId = sent.packet_id as string;

    // The bytes are in the KV namespace, under the attachment's key, with the metadata the download needs.
    const keys = (await env.FILES.list()).keys;
    expect(keys.length).toBe(1);
    const stored = await env.FILES.getWithMetadata<{ contentType: string; sha256: string; size: number }>(keys[0]!.name, "arrayBuffer");
    expect(stored.metadata).toEqual({ contentType: "application/pdf", sha256: await sha256Hex(PDF), size: PDF.byteLength });
    expect(new Uint8Array(stored.value!)).toEqual(PDF);
    expect(await env.BLOBS.list().then((l) => l.objects.length)).toBe(0);

    const read = await rpc(bearer, "handoff_read", { packet_id: packetId, attachment_id: id, representation: "original" });
    const dl = await fetchKv(read.download_url as string);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect(dl.headers.get("content-length")).toBe(String(PDF.byteLength));
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF);

    // Revoked eight days ago: the scheduled cleanup removes the packet and its bytes from KV.
    await env.DB.prepare("UPDATE packets SET revoked_at = ? WHERE id = ?").bind(new Date(Date.now() - 8 * 86_400_000).toISOString(), packetId).run();
    const result = await runCleanup(kvOnly, "console");
    expect(result.packets_deleted).toBe(1);
    expect((await env.FILES.list()).keys.length).toBe(0);
  });
});
