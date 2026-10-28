import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { configFrom } from "../src/env";
import { HandoffService, type HostFile } from "../src/domain/service";
import { D1Repository } from "../src/store/d1";
import { R2BlobStore } from "../src/store/blobs";
import { PDF, PNG, alice, call, errorText, expectOk, sha256Hex, token } from "./helpers";

const HOST = "https://files.host-example.com";

// The service downloads host files with the global fetch. Tests and the Worker share one isolate,
// so a stubbed global fetch stands in for the network; anything not registered is refused.
const routes = new Map<string, () => Response | Promise<Response>>();
const hits = new Map<string, number>();
const realFetch = globalThis.fetch;

function route(path: string, status: number, body: BodyInit | null, headers: Record<string, string> = {}) {
  routes.set(`${HOST}${path}`, () => new Response(body, { status, headers }));
}

beforeEach(() => {
  routes.clear();
  hits.clear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const make = routes.get(url);
    if (!make) throw new TypeError(`network disabled in tests: ${new URL(url).host}`);
    hits.set(url, (hits.get(url) ?? 0) + 1);
    void init;
    return await make();
  });
});
afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
  vi.unstubAllGlobals();
});

const sendWithFiles = (bearer: string, files: unknown[], extra: Record<string, unknown> = {}) =>
  call(bearer, "handoff_send", { title: "with files", brief: "see files", idempotency_key: crypto.randomUUID(), files, ...extra });

describe("OpenAI file adapter: server-side import of host file references", () => {
  it("imports originals from the host URL, verifies them and publishes ready attachments", async () => {
    route("/dl/pdf-1", 200, PDF, { "content-type": "application/pdf" });
    route("/dl/png-1", 200, PNG, { "content-type": "image/png" });
    const a = await alice();
    const sent = expectOk(
      await sendWithFiles(a, [
        { download_url: `${HOST}/dl/pdf-1`, file_id: "file-pdf-1", file_name: "codeword.pdf", mime_type: "application/pdf" },
        { download_url: `${HOST}/dl/png-1`, file_id: "file-png-1" }, // host may omit name and type
      ]),
    );
    const atts = sent.attachments as any[];
    expect(atts).toHaveLength(2);
    expect(atts[0]).toMatchObject({ filename: "codeword.pdf", mime_type: "application/pdf", sha256: await sha256Hex(PDF), state: "ready" });
    expect(atts[1]).toMatchObject({ filename: "file-png-1", mime_type: "image/png", sha256: await sha256Hex(PNG), state: "ready" });

    const read = expectOk(await call(a, "handoff_read", { packet_id: sent.packet_id }));
    expect((read.attachments as any[]).map((x) => x.attachment_id)).toEqual(atts.map((x) => x.attachment_id));
  });

  it("a retry with the same idempotency key does not download or publish again", async () => {
    route("/dl/once", 200, PDF, { "content-type": "application/pdf" });
    const a = await alice();
    const key = crypto.randomUUID();
    const files = [{ download_url: `${HOST}/dl/once`, file_id: "file-once" }];
    const first = expectOk(await sendWithFiles(a, files, { idempotency_key: key }));
    const second = expectOk(await sendWithFiles(a, files, { idempotency_key: key }));
    expect(second.packet_id).toBe(first.packet_id);
    expect(second.replayed).toBe(true);
    expect(hits.get(`${HOST}/dl/once`)).toBe(1);
  });

  it("refuses redirects, http, IP hosts and oversize files", async () => {
    const a = await alice();
    route("/dl/redir", 302, "", { location: "https://elsewhere.example/x" });
    expect(errorText(await sendWithFiles(a, [{ download_url: `${HOST}/dl/redir`, file_id: "f-redir" }]))).toContain("redirect");
    expect(errorText(await sendWithFiles(a, [{ download_url: "http://files.host-example.com/x", file_id: "f-http" }]))).toContain("https");
    expect(errorText(await sendWithFiles(a, [{ download_url: "https://10.0.0.5/x", file_id: "f-ip" }]))).toContain("public DNS name");
    expect(errorText(await sendWithFiles(a, [{ download_url: "https://localhost/x", file_id: "f-local" }]))).toContain("public DNS name");
    const big = new Uint8Array(1024 * 1024 + 1).fill(0x41);
    big.set(new TextEncoder().encode("%PDF-1.4"), 0);
    route("/dl/big", 200, big, { "content-type": "application/pdf" });
    expect(errorText(await sendWithFiles(a, [{ download_url: `${HOST}/dl/big`, file_id: "f-big" }]))).toContain("too_large");
  });

  it("refuses an unsupported file and publishes nothing", async () => {
    const a = await alice();
    route("/dl/zip", 200, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), { "content-type": "application/zip" });
    const r = await sendWithFiles(a, [{ download_url: `${HOST}/dl/zip`, file_id: "f-zip" }], { title: "zip attempt" });
    expect(errorText(r)).toContain("unsupported_type");
    const inbox = expectOk(await call(a, "handoff_inbox"));
    expect((inbox.packets as any[]).find((p) => p.title === "zip attempt")).toBeUndefined();
  });
});

// Committee review 2026-10-26, finding 2.2: nothing is downloaded or kept for a send that does not publish it.
describe("imports and the send they belong to", () => {
  const svcWith = (overrides: Record<string, string> = {}) =>
    new HandoffService(new D1Repository(env.DB), new R2BlobStore(env.BLOBS), configFrom({ ...env, ...overrides }));
  const owner = () => ({ subject: `user_${crypto.randomUUID()}`, scopes: [], clientId: "t", token: "" });
  const imports = (subject: string) =>
    env.DB.prepare("SELECT id, state, fail_reason, blob_key FROM attachments WHERE owner = ? AND source = 'import'")
      .bind(subject)
      .all<{ id: string; state: string; fail_reason: string | null; blob_key: string }>()
      .then((r) => r.results);
  const input = (extra: Record<string, unknown> = {}) => ({ title: "t", brief: "b", attachment_ids: [] as string[], idempotency_key: crypto.randomUUID(), ...extra });

  it("an invalid request downloads nothing", async () => {
    route("/dl/never", 200, PDF);
    const a = await token(`user_${crypto.randomUUID()}`);
    const r = await sendWithFiles(a, [{ download_url: `${HOST}/dl/never`, file_id: "f-never" }], { title: "   " });
    expect(errorText(r)).toContain("invalid_input");
    expect(hits.size).toBe(0);
  });

  it("a bad URL in a later file stops the send before the first file is downloaded", async () => {
    route("/dl/first", 200, PDF);
    const p = owner();
    const files: HostFile[] = [
      { download_url: `${HOST}/dl/first`, file_id: "f-first" },
      { download_url: "http://files.host-example.com/second", file_id: "f-second" },
    ];
    await expect(svcWith().sendWithImports(p, input(), files, "openai")).rejects.toMatchObject({ code: "import_rejected" });
    expect(hits.size).toBe(0);
    expect(await imports(p.subject)).toEqual([]);
  });

  it("when a later file fails, the files already imported by that call are deleted with their bytes", async () => {
    route("/dl/ok", 200, PDF, { "content-type": "application/pdf" });
    route("/dl/gone", 404, "no");
    const p = owner();
    const files: HostFile[] = [
      { download_url: `${HOST}/dl/ok`, file_id: "f-ok" },
      { download_url: `${HOST}/dl/gone`, file_id: "f-gone" },
    ];
    await expect(svcWith().sendWithImports(p, input(), files, "openai")).rejects.toMatchObject({ code: "import_rejected" });
    const rows = await imports(p.subject);
    expect(rows.map((r) => r.state)).toEqual(["failed"]); // only the 404 slot, which never held bytes
    expect(await env.BLOBS.list({ prefix: `att/${p.subject}/` }).then((l) => l.objects.length)).toBe(0);
  });

  it("two concurrent identical sends publish one packet and keep one copy of each file", async () => {
    // Both calls must pass the replay check before either publishes: each download waits for the other.
    let arrived = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((r) => (release = r));
    const fallback = setTimeout(() => release(), 3000);
    routes.set(`${HOST}/dl/race`, async () => {
      if (++arrived === 2) release();
      await bothArrived;
      return new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });
    });
    const svc = svcWith();
    const p = owner();
    const req = input();
    const files: HostFile[] = [{ download_url: `${HOST}/dl/race`, file_id: "f-race" }];
    const [r1, r2] = await Promise.all([svc.sendWithImports(p, req, files, "openai"), svc.sendWithImports(p, req, files, "openai")]);
    clearTimeout(fallback);
    expect(arrived).toBe(2);
    expect(r1.packet_id).toBe(r2.packet_id);
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    const rows = await imports(p.subject);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(r1.attachments[0]!.attachment_id);
    expect(await env.BLOBS.list({ prefix: `att/${p.subject}/` }).then((l) => l.objects.map((o) => o.key))).toEqual([rows[0]!.blob_key]);
  });

  it("a download that breaks off mid-stream marks the slot failed, not staging", async () => {
    routes.set(`${HOST}/dl/broken`, () => {
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          c.error(new Error("connection reset"));
        },
      });
      return new Response(body, { status: 200 });
    });
    const p = owner();
    await expect(svcWith().sendWithImports(p, input(), [{ download_url: `${HOST}/dl/broken`, file_id: "f-broken" }], "openai")).rejects.toMatchObject({
      code: "import_rejected",
    });
    const rows = await imports(p.subject);
    expect(rows.map((r) => [r.state, r.fail_reason])).toEqual([["failed", "download failed"]]);
  });

  it("with an empty IMPORT_HOST_ALLOWLIST imports are off, and the error names the host without contacting it", async () => {
    route("/dl/off", 200, PDF);
    const p = owner();
    const err = await svcWith({ IMPORT_HOST_ALLOWLIST: "" })
      .sendWithImports(p, input(), [{ download_url: `${HOST}/dl/off`, file_id: "f-off" }], "openai")
      .catch((e) => e);
    expect(err).toMatchObject({ code: "import_rejected" });
    expect(err.message).toContain("file import is off");
    expect(err.message).toContain("files.host-example.com");
    expect(hits.size).toBe(0);
  });
});
