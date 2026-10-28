import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { JPEG_HEAD, ORIGIN, PDF, PNG, ZIP_HEAD, alice, bob, call, errorText, expectOk, send, sha256Hex, uploadBytes } from "./helpers";

describe("upload and verification", () => {
  it("stores a PDF and reports its real checksum", async () => {
    const a = await alice();
    const up = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    expect(up.status).toBe(200);
    expect(up.body.state).toBe("ready");
    expect(up.body.mime_type).toBe("application/pdf");
    expect(up.body.size).toBe(PDF.byteLength);
    expect(up.body.sha256).toBe(await sha256Hex(PDF));
  });

  it("decides the type from the bytes, not the label", async () => {
    const a = await alice();
    const png = await uploadBytes(a, "pixel.png", PNG); // no content-type sent
    expect(png.body.mime_type).toBe("image/png");
    const jpg = await uploadBytes(a, "photo.jpg", JPEG_HEAD, "image/jpeg");
    expect(jpg.body.mime_type).toBe("image/jpeg");
    const md = await uploadBytes(a, "notes.md", new TextEncoder().encode("# Notes\n\nhello"));
    expect(md.body.mime_type).toBe("text/markdown");
    const txt = await uploadBytes(a, "notes", new TextEncoder().encode("plain words"));
    expect(txt.body.mime_type).toBe("text/plain");
  });

  it("rejects a label that contradicts the bytes", async () => {
    const a = await alice();
    const r = await uploadBytes(a, "fake.png", PDF, "image/png");
    expect(r.status).toBe(415);
    const att = await SELF.fetch(`${ORIGIN}/v1/attachments/${r.attachment_id}`, { headers: { authorization: `Bearer ${a}` } });
    expect(((await att.json()) as any).state).toBe("failed");
  });

  it("rejects unsupported types and oversize bodies", async () => {
    const a = await alice();
    expect((await uploadBytes(a, "archive.zip", ZIP_HEAD, "application/zip")).status).toBe(415);
    expect((await uploadBytes(a, "binary.bin", new Uint8Array([0, 1, 2, 3, 0xff, 0xfe]))).status).toBe(415);
    const big = new Uint8Array(1024 * 1024 + 1).fill(0x41);
    big.set(new TextEncoder().encode("%PDF-1.4"), 0);
    expect((await uploadBytes(a, "big.pdf", big, "application/pdf")).status).toBe(413);
  });

  it("verifies a declared checksum", async () => {
    const a = await alice();
    const ok = await uploadBytes(a, "a.pdf", PDF, "application/pdf", { "x-checksum-sha256": await sha256Hex(PDF) });
    expect(ok.status).toBe(200);
    const bad = await uploadBytes(a, "b.pdf", PDF, "application/pdf", { "x-checksum-sha256": "00".repeat(32) });
    expect(bad.status).toBe(400);
  });

  it("the owner downloads the identical bytes through a live packet, and not before it is sent", async () => {
    const a = await alice();
    const up = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    const original = `${ORIGIN}/v1/attachments/${up.attachment_id}/original`;
    expect((await SELF.fetch(original, { headers: { authorization: `Bearer ${a}` } })).status).toBe(410);
    const p = await send(a, { attachment_ids: [up.attachment_id] });
    const res = await SELF.fetch(`${original}?packet_id=${p.packet_id}`, { headers: { authorization: `Bearer ${a}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-checksum-sha256")).toBe(await sha256Hex(PDF));
    expect(res.headers.get("content-disposition")).toContain("codeword.pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  it("another identity cannot see or download the attachment", async () => {
    const a = await alice();
    const b = await bob();
    const up = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    const meta = await SELF.fetch(`${ORIGIN}/v1/attachments/${up.attachment_id}`, { headers: { authorization: `Bearer ${b}` } });
    expect(meta.status).toBe(404);
    const dl = await SELF.fetch(`${ORIGIN}/v1/attachments/${up.attachment_id}/original`, { headers: { authorization: `Bearer ${b}` } });
    expect(dl.status).toBe(404);
  });
});

describe("attachments in packets", () => {
  it("publishes only ready, owned attachments", async () => {
    const a = await alice();
    const b = await bob();
    const ready = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    const sent = await send(a, { attachment_ids: [ready.attachment_id] });
    expect((sent.attachments as any[])[0]).toMatchObject({ attachment_id: ready.attachment_id, state: "ready", sha256: await sha256Hex(PDF) });

    // staging: created but no bytes
    const created = await SELF.fetch(`${ORIGIN}/v1/uploads`, { method: "POST", headers: { authorization: `Bearer ${a}`, "content-type": "application/json" }, body: JSON.stringify({ filename: "x.pdf" }) });
    const staging = ((await created.json()) as any).attachment_id;
    expect(errorText(await call(a, "handoff_send", { title: "t", brief: "b", idempotency_key: crypto.randomUUID(), attachment_ids: [staging] }))).toContain("attachment_not_ready");

    // Bob cannot bind Alice's attachment just by knowing the id.
    expect(errorText(await call(b, "handoff_send", { title: "t", brief: "b", idempotency_key: crypto.randomUUID(), attachment_ids: [ready.attachment_id] }))).toContain("not_found");

    // Unknown id
    expect(errorText(await call(a, "handoff_send", { title: "t", brief: "b", idempotency_key: crypto.randomUUID(), attachment_ids: ["at_nope"] }))).toContain("not_found");
  });

  it("reads an attachment only through a packet it belongs to", async () => {
    const a = await alice();
    const pdf = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    const png = await uploadBytes(a, "pixel.png", PNG, "image/png");
    const p1 = await send(a, { attachment_ids: [pdf.attachment_id] });
    const p2 = await send(a, { attachment_ids: [png.attachment_id] });

    const okRead = expectOk(await call(a, "handoff_read", { packet_id: p1.packet_id, attachment_id: pdf.attachment_id }));
    expect(okRead.representation).toBe("original");

    // Substitution: same owner, wrong packet.
    expect(errorText(await call(a, "handoff_read", { packet_id: p1.packet_id, attachment_id: png.attachment_id }))).toContain("not_found");

    // Substitution through an expired packet of the same owner.
    const past = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare("UPDATE packets SET expires_at = ? WHERE id = ?").bind(past, p2.packet_id).run();
    expect(errorText(await call(a, "handoff_read", { packet_id: p2.packet_id, attachment_id: png.attachment_id }))).toContain("expired");

    // Other identity.
    expect(errorText(await call(await bob(), "handoff_read", { packet_id: p1.packet_id, attachment_id: pdf.attachment_id }))).toContain("not_found");
  });

  it("returns images inline and text inline, and refuses a text derivative of a PDF", async () => {
    const a = await alice();
    const png = await uploadBytes(a, "pixel.png", PNG, "image/png");
    const txt = await uploadBytes(a, "notes.md", new TextEncoder().encode("# Notes\nThe code word is PELICAN.\n"));
    const pdf = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    const p = await send(a, { attachment_ids: [png.attachment_id, txt.attachment_id, pdf.attachment_id] });

    const img = await call(a, "handoff_read", { packet_id: p.packet_id, attachment_id: png.attachment_id });
    expectOk(img);
    const imageBlock = img.content.find((c) => c.type === "image")!;
    expect(imageBlock.mimeType).toBe("image/png");
    expect(new Uint8Array(Uint8Array.from(atob(imageBlock.data!), (ch) => ch.charCodeAt(0)))).toEqual(PNG);

    const text = await call(a, "handoff_read", { packet_id: p.packet_id, attachment_id: txt.attachment_id });
    expectOk(text);
    expect(text.content.map((c) => c.text).join("\n")).toContain("The code word is PELICAN.");

    expect(errorText(await call(a, "handoff_read", { packet_id: p.packet_id, attachment_id: pdf.attachment_id, representation: "text" }))).toContain("no_representation");
  });

  it("the original download ticket serves identical bytes and dies with the packet", async () => {
    const a = await alice();
    const pdf = await uploadBytes(a, "codeword.pdf", PDF, "application/pdf");
    const p = await send(a, { attachment_ids: [pdf.attachment_id] });
    const r = expectOk(await call(a, "handoff_read", { packet_id: p.packet_id, attachment_id: pdf.attachment_id, representation: "original" }));
    const url = String(r.download_url);
    expect(url.startsWith(`${ORIGIN}/v1/dl/`)).toBe(true);
    expect(Date.parse(String(r.download_expires_at)) - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    const dl = await SELF.fetch(url); // no bearer: the ticket is the capability
    expect(dl.status).toBe(200);
    expect(dl.headers.get("x-checksum-sha256")).toBe(await sha256Hex(PDF));
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF);

    // Still inside the window, but the packet is revoked: access stops at once.
    expectOk(await call(a, "handoff_revoke", { packet_id: p.packet_id }));
    expect((await SELF.fetch(url)).status).toBe(410);

    expect((await SELF.fetch(`${ORIGIN}/v1/dl/not-a-ticket`)).status).toBe(401);
  });

  it("upload tickets are single use and bound to one attachment", async () => {
    const a = await alice();
    const t = expectOk(await call(a, "handoff_upload_url", { filename: "codeword.pdf", mime_type: "application/pdf" }));
    expect(String(t.curl)).toContain("curl");
    const url = String(t.upload_url);

    const put = await SELF.fetch(url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: PDF });
    expect(put.status).toBe(200);
    expect(((await put.json()) as any).sha256).toBe(await sha256Hex(PDF));

    const again = await SELF.fetch(url, { method: "PUT", headers: { "content-type": "application/pdf" }, body: PDF });
    expect(again.status).toBe(401);

    // Ticket for attachment X cannot be used on attachment Y.
    const t2 = expectOk(await call(a, "handoff_upload_url", { filename: "other.pdf" }));
    const ticket2 = new URL(String(t2.upload_url)).searchParams.get("ticket");
    const cross = await SELF.fetch(`${ORIGIN}/v1/uploads/${t.attachment_id}?ticket=${ticket2}`, { method: "PUT", body: PDF });
    expect(cross.status).toBe(401);

    // Without ticket or bearer: challenge.
    const bare = await SELF.fetch(`${ORIGIN}/v1/uploads/${t2.attachment_id}`, { method: "PUT", body: PDF });
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toContain("resource_metadata");

    // The attachment from the ticket flow is usable in a packet.
    const sent = await send(a, { attachment_ids: [t.attachment_id] });
    expect((sent.attachments as any[])[0].state).toBe("ready");
  });
});
