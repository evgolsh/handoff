import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import worker from "../src/index";
import { upsertMember } from "../src/auth/builtin";
import { ORIGIN, PDF, ZIP_HEAD, call, errorText, expectOk, token } from "./helpers";

/** The member file page: any member signs in, drops a file for their assistant, and downloads their handoffs' files. */
const CODES = { tim: "code-of-tim-1", tom: "code-of-tom-1", amy: "code-of-amy-1" } as const;
type Who = keyof typeof CODES;

let ip = 0;
const signIn = (handle: string, code: string, extra: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}/files/login`, {
    method: "POST",
    redirect: "manual",
    // Each sign-in from its own address, so the 10-per-10-minutes limit never mixes into these tests.
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": `203.0.113.${++ip % 250}` },
    body: new URLSearchParams({ handle, access_code: code, ...extra }),
  });

interface Sess {
  cookie: string;
  csrf: string;
}
async function sessionOf(who: Who): Promise<Sess> {
  const res = await signIn(who, CODES[who]);
  expect(res.status).toBe(303);
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const page = await (await SELF.fetch(`${ORIGIN}/files`, { headers: { cookie } })).text();
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(page)![1]! };
}

const pageOf = async (s: Sess) => (await SELF.fetch(`${ORIGIN}/files`, { headers: { cookie: s.cookie } })).text();

async function upload(s: Sess, name: string, bytes: Uint8Array, type: string, note?: string, csrf = s.csrf): Promise<Response> {
  const fd = new FormData();
  fd.append("csrf", csrf);
  fd.append("file", new File([bytes], name, { type }));
  if (note) fd.append("note", note);
  return SELF.fetch(`${ORIGIN}/files/upload`, { method: "POST", redirect: "manual", headers: { origin: ORIGIN, cookie: s.cookie }, body: fd });
}
async function uploaded(s: Sess, name: string, note?: string): Promise<string> {
  const res = await upload(s, name, PDF, "application/pdf", note);
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location")!, ORIGIN).searchParams.get("uploaded")!;
}

const post = (s: Sess, path: string, fields: Record<string, string>) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin: ORIGIN, cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf: s.csrf, ...fields }),
  });

const sendByName = async (who: Who, names: string[], extra: Record<string, unknown> = {}) =>
  call(await token(who), "handoff_send", { title: "Q3 VAT for the bakery", brief: "Fix the two flagged invoices.", to: "tom", attachment_names: names, idempotency_key: crypto.randomUUID(), ...extra });

describe("member file page (/files)", () => {
  beforeEach(async () => {
    // Each test starts with no files or handoffs, whatever the tests before it left.
    await env.DB.batch(["DELETE FROM packet_attachments", "DELETE FROM tickets", "DELETE FROM attachments", "DELETE FROM packets"].map((q) => env.DB.prepare(q)));
    for (const [who, code] of Object.entries(CODES)) await upsertMember(env.DB, who, code);
    await env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES ('tim')").run();
  });

  it("any member signs in with their username and access code; a wrong code or another site's form is refused", async () => {
    const form = await SELF.fetch(`${ORIGIN}/files`);
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('action="/files/login"');
    expect(html).not.toContain('name="team"');
    expect(form.headers.get("content-security-policy")).toContain("default-src 'none'");

    expect((await signIn("tom", "wrong-code")).status).toBe(401);
    const foreign = await SELF.fetch(`${ORIGIN}/files/login`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ handle: "tom", access_code: CODES.tom }),
    });
    expect(foreign.status).toBe(403);

    // tom is not an admin: the file page lets him in.
    const ok = await signIn("tom", CODES.tom);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("set-cookie")).toMatch(/^__Host-handoff-files=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Strict/);
    const s = await sessionOf("tom");
    const page = await pageOf(s);
    expect(page).toContain("<strong>tom</strong>");
    expect(page).toContain('enctype="multipart/form-data"');
  });

  it("a file-page session never opens the console, and a console session does not open the file page", async () => {
    const tom = await sessionOf("tom");
    const consoleRes = await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tom.cookie } });
    expect(consoleRes.status).toBe(303);
    expect(consoleRes.headers.get("location")).toBe("/console/login");
    // Even for an admin, the cookies are separate: a file-page session is not a console session.
    const tim = await sessionOf("tim");
    expect((await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tim.cookie } })).status).toBe(303);
    const consoleCookie = tim.cookie.replace("__Host-handoff-files=", "__Host-handoff-console=");
    expect(await (await SELF.fetch(`${ORIGIN}/files`, { headers: { cookie: consoleCookie } })).text()).toContain('action="/files/login"');
  });

  it("an upload is stored like an assistant's upload, owned by the uploader and shown only to them", async () => {
    const tom = await sessionOf("tom");
    const id = await uploaded(tom, "vat-q3-summary.pdf", "Signed copy");
    const row = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ owner: "tom", filename: "vat-q3-summary.pdf", state: "ready", mime_type: "application/pdf", source: "upload", size: PDF.byteLength });
    expect(JSON.parse(String(row!.provenance))).toEqual({ via: "web", note: "Signed copy" });

    const page = await (await SELF.fetch(`${ORIGIN}/files?uploaded=${id}`, { headers: { cookie: tom.cookie } })).text();
    expect(page).toContain("Uploaded <strong>vat-q3-summary.pdf</strong>");
    expect(page).toContain(`data-copy="vat-q3-summary.pdf (${id})"`);
    expect(page).toContain("Signed copy");

    // tom's assistant sees it in the inbox; amy's does not, on the page or over MCP.
    const inbox = expectOk(await call(await token("tom"), "handoff_inbox", {}));
    expect(inbox.unsent_files).toEqual([expect.objectContaining({ attachment_id: id, filename: "vat-q3-summary.pdf", note: "Signed copy" })]);
    expect(expectOk(await call(await token("amy"), "handoff_inbox", {})).unsent_files).toEqual([]);
    expect(await pageOf(await sessionOf("amy"))).not.toContain("vat-q3-summary.pdf");
  });

  it("refuses an unsupported file, an upload without the form's CSRF value, and an upload with no session", async () => {
    const tom = await sessionOf("tom");
    const zip = await upload(tom, "invoices.zip", ZIP_HEAD, "application/zip");
    expect(zip.status).toBe(415);
    expect(await zip.text()).toContain("Not uploaded.");
    expect((await upload(tom, "vat.pdf", PDF, "application/pdf", undefined, "not-the-csrf")).status).toBe(403);
    const fd = new FormData();
    fd.append("file", new File([PDF], "vat.pdf", { type: "application/pdf" }));
    expect((await SELF.fetch(`${ORIGIN}/files/upload`, { method: "POST", headers: { origin: ORIGIN }, body: fd })).status).toBe(401);
    const ready = await env.DB.prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner = 'tom' AND state = 'ready'").first<{ n: number }>();
    expect(ready?.n).toBe(0);
  });

  it("handoff_send attaches an unsent file by name, from the caller's own files only, and never guesses", async () => {
    const tim = await sessionOf("tim");
    const amy = await sessionOf("amy");
    // amy has a file with the same name: tim's send must never pick it up.
    await uploaded(amy, "vat-q3-summary.pdf");

    const none = await sendByName("tim", ["vat-q3-summary.pdf"]);
    expect(errorText(none)).toContain("not_found: attachment_names: none of your unsent files is named");
    expect(errorText(none)).toContain(`${ORIGIN}/files`);

    const first = await uploaded(tim, "vat-q3-summary.pdf");
    const sent = expectOk(await sendByName("tim", ["VAT-Q3-Summary.pdf"]));
    expect((sent.attachments as Array<{ attachment_id: string }>).map((a) => a.attachment_id)).toEqual([first]);

    // Two unsent files with the same name: nothing is sent, and both are listed.
    const a = await uploaded(tim, "flagged-invoices.pdf", "first draft");
    const b = await uploaded(tim, "flagged-invoices.pdf", "final");
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM packets").first<{ n: number }>();
    const two = errorText(await sendByName("tim", ["flagged-invoices.pdf"]));
    expect(two).toContain("ambiguous: attachment_names:");
    expect(two).toContain(a);
    expect(two).toContain(b);
    expect(two).toContain('note: "final"');
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM packets").first<{ n: number }>())?.n).toBe(before?.n);
    // The id settles it.
    expectOk(await call(await token("tim"), "handoff_send", { title: "Invoices", brief: "The final one.", to: "tom", attachment_ids: [b], idempotency_key: crypto.randomUUID() }));
  });

  it("a retried send by name returns the packet it already sent, though the file is no longer unsent", async () => {
    const tim = await sessionOf("tim");
    const id = await uploaded(tim, "lease.pdf");
    const key = crypto.randomUUID();
    const first = expectOk(await sendByName("tim", ["lease.pdf"], { idempotency_key: key }));
    const again = expectOk(await sendByName("tim", ["lease.pdf"], { idempotency_key: key }));
    expect(again.replayed).toBe(true);
    expect(again.packet_id).toBe(first.packet_id);
    expect((again.attachments as Array<{ attachment_id: string }>)[0]?.attachment_id).toBe(id);
  });

  it("a member downloads the files of their live handoffs; other members and revoked handoffs are refused", async () => {
    const tim = await sessionOf("tim");
    const id = await uploaded(tim, "vat-q3-summary.pdf");
    const sent = expectOk(await sendByName("tim", ["vat-q3-summary.pdf"]));
    const path = `/files/download/${sent.packet_id}/${id}`;

    const tom = await sessionOf("tom");
    const page = await pageOf(tom);
    expect(page).toContain("Q3 VAT for the bakery");
    expect(page).toContain(`href="${path}"`);
    const dl = await SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: tom.cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain("vat-q3-summary.pdf");
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF);

    expect((await SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: (await sessionOf("amy")).cookie } })).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual" })).status).toBe(303);
    expectOk(await call(await token("tim"), "handoff_revoke", { packet_id: sent.packet_id }));
    expect((await SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: tom.cookie } })).status).toBe(410);
  });

  it("a member removes their own unsent file, but not a sent file or a teammate's", async () => {
    const tim = await sessionOf("tim");
    const tom = await sessionOf("tom");
    const mine = await uploaded(tom, "draft.pdf");
    const theirs = await uploaded(tim, "draft.pdf");
    expect((await post(tom, "/files/remove", { id: theirs })).status).toBe(404);
    const removed = await post(tom, "/files/remove", { id: mine });
    expect(removed.status).toBe(303);
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(mine).first()).toBeNull();

    const sent = await uploaded(tim, "sent.pdf");
    expectOk(await sendByName("tim", ["sent.pdf"]));
    expect((await post(tim, "/files/remove", { id: sent })).status).toBe(410);
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(sent).first()).not.toBeNull();
  });

  it("signing out, or a reset access code, ends the session", async () => {
    const tom = await sessionOf("tom");
    const out = await post(tom, "/files/logout", {});
    expect(out.status).toBe(303);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await pageOf(tom)).toContain('action="/files/login"');

    const again = await sessionOf("tom");
    await upsertMember(env.DB, "tom", "a-new-code-for-tom");
    expect(await pageOf(again)).toContain('action="/files/login"');
  });

  it("the Connect page and the console link to the files page", async () => {
    expect(await (await SELF.fetch(`${ORIGIN}/connect`)).text()).toContain('Upload it on <a href="/files">your files page</a>');
  });

  it("on the control center the sign-in names the team", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/files`), { ...env, HANDOFF_MODE: "control" }, createExecutionContext());
    const html = await res.text();
    expect(html).toContain('name="team"');
    expect(html).not.toContain("—");
  });
});
