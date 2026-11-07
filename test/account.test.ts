import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import worker from "../src/index";
import { upsertMember } from "../src/auth/builtin";
import { numberedName } from "../src/domain/service";
import { ORIGIN, PDF, ZIP_HEAD, call, errorText, expectOk, token } from "./helpers";

/** My account: any member signs in, sees their files and handoffs in one list, uploads a file for their assistant, and downloads their handoffs' files. */
const CODES = { tim: "code-of-tim-1", tom: "code-of-tom-1", amy: "code-of-amy-1" } as const;
type Who = keyof typeof CODES;
const ACCOUNT = "__Host-handoff-account";
const CONSOLE = "__Host-handoff-console";

let ip = 0;
const form = (path: string, fields: Record<string, string>, extra: Record<string, string> = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    redirect: "manual",
    // Each sign-in from its own address, so the 10-per-10-minutes limit never mixes into these tests.
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": `203.0.113.${++ip % 250}`, ...extra },
    body: new URLSearchParams(fields),
  });
const signIn = (handle: string, code: string, extra: Record<string, string> = {}) => form("/account/login", { handle, access_code: code, ...extra });

/** The name=value pairs a response sets, by cookie name. */
const cookiesOf = (res: Response): Record<string, string> =>
  Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(";")[0]!).map((kv) => [kv.slice(0, kv.indexOf("=")), kv]));

interface Sess {
  cookie: string;
  /** Set for an admin: the console session the same sign-in started. */
  console?: string;
  csrf: string;
}
async function sessionOf(who: Who): Promise<Sess> {
  const res = await signIn(who, CODES[who]);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/account");
  const set = cookiesOf(res);
  const cookie = set[ACCOUNT]!;
  const page = await (await SELF.fetch(`${ORIGIN}/account`, { headers: { cookie } })).text();
  return { cookie, console: set[CONSOLE], csrf: /name="csrf" value="([^"]+)"/.exec(page)![1]! };
}

const pageOf = async (s: Sess, query = "") => (await SELF.fetch(`${ORIGIN}/account${query}`, { headers: { cookie: s.cookie } })).text();

async function upload(s: Sess, name: string, bytes: Uint8Array, type: string, note?: string, csrf = s.csrf): Promise<Response> {
  const fd = new FormData();
  fd.append("csrf", csrf);
  fd.append("file", new File([bytes], name, { type }));
  if (note) fd.append("note", note);
  return SELF.fetch(`${ORIGIN}/account/upload`, { method: "POST", redirect: "manual", headers: { origin: ORIGIN, cookie: s.cookie }, body: fd });
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
const send = async (who: Who, to: string | undefined, title: string) =>
  expectOk(await call(await token(who), "handoff_send", { title, brief: "Notes.", ...(to ? { to } : {}), idempotency_key: crypto.randomUUID() }));

describe("My account (/account)", () => {
  beforeEach(async () => {
    // Each test starts with no files or handoffs, whatever the tests before it left.
    await env.DB.batch(["DELETE FROM packet_attachments", "DELETE FROM tickets", "DELETE FROM attachments", "DELETE FROM packets"].map((q) => env.DB.prepare(q)));
    for (const [who, code] of Object.entries(CODES)) await upsertMember(env.DB, who, code);
    await env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES ('tim')").run();
  });

  it("any member signs in with their username and access code; a wrong code or another site's form is refused", async () => {
    const page = await SELF.fetch(`${ORIGIN}/account`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('action="/account/login"');
    expect(html).toContain("<h1>Sign in</h1>");
    expect(html).not.toContain('name="team"');
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");

    expect((await signIn("tom", "wrong-code")).status).toBe(401);
    const foreign = await form("/account/login", { handle: "tom", access_code: CODES.tom }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);

    // tom is not an admin: he gets My account only.
    const ok = await signIn("tom", CODES.tom);
    expect(ok.status).toBe(303);
    expect(ok.headers.getSetCookie()).toEqual([expect.stringMatching(/^__Host-handoff-account=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Strict/)]);
    const s = await sessionOf("tom");
    const mine = await pageOf(s);
    expect(mine).toContain("<strong>tom</strong>");
    expect(mine).toContain("<h1>My assets</h1>");
    expect(mine).toContain('enctype="multipart/form-data"');
    expect(mine).not.toContain("Admin console");
    expect(mine).toContain("Nothing here yet.");
  });

  it("one sign-in: an admin gets My account and the console, a member's session alone never opens the console", async () => {
    const tom = await sessionOf("tom");
    const consoleRes = await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tom.cookie } });
    expect(consoleRes.status).toBe(303);
    expect(consoleRes.headers.get("location")).toBe("/console/login");

    // tim is an admin: the same sign-in started both sessions, each with its own cookie.
    const tim = await sessionOf("tim");
    expect(tim.console).toMatch(/^__Host-handoff-console=/);
    expect(await pageOf(tim)).toContain('<a href="/console/overview">Admin console</a>');
    expect((await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tim.console! } })).status).toBe(200);
    // The account cookie is still not a console session, and the reverse.
    expect((await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tim.cookie } })).status).toBe(303);
    const asAccount = tim.console!.replace(`${CONSOLE}=`, `${ACCOUNT}=`);
    expect(await (await SELF.fetch(`${ORIGIN}/account`, { headers: { cookie: asAccount } })).text()).toContain('action="/account/login"');

    // Signing in on the console also opens My account.
    const viaConsole = cookiesOf(await form("/console/login", { handle: "tim", access_code: CODES.tim }));
    expect(Object.keys(viaConsole).sort()).toEqual([ACCOUNT, CONSOLE]);
    expect(await (await SELF.fetch(`${ORIGIN}/account`, { headers: { cookie: viaConsole[ACCOUNT]! } })).text()).toContain("<h1>My assets</h1>");

    // A console sign-in refused to a member who is not an admin starts no session at all.
    const refused = await form("/console/login", { handle: "tom", access_code: CODES.tom });
    expect(refused.status).toBe(401);
    expect(refused.headers.getSetCookie()).toEqual([]);

    // A revoked admin grant closes the console, but My account stays.
    await env.DB.prepare("DELETE FROM admin_members WHERE handle = 'tim'").run();
    expect((await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tim.console! } })).status).toBe(303);
    expect(await pageOf(tim)).not.toContain("Admin console");
  });

  it("signing out of either area ends both sessions", async () => {
    const tim = await sessionOf("tim");
    // The browser sends both cookies (both Path=/).
    const out = await post({ ...tim, cookie: `${tim.cookie}; ${tim.console}` }, "/account/logout", {});
    expect(out.status).toBe(303);
    expect(out.headers.getSetCookie().join("\n")).toMatch(new RegExp(`${ACCOUNT}=; [^\\n]*Max-Age=0[\\s\\S]*${CONSOLE}=; [^\\n]*Max-Age=0`));
    expect(await pageOf(tim)).toContain('action="/account/login"');
    expect((await SELF.fetch(`${ORIGIN}/console/overview`, { redirect: "manual", headers: { cookie: tim.console! } })).status).toBe(303);

    const again = await sessionOf("tim");
    const consolePage = await (await SELF.fetch(`${ORIGIN}/console/overview`, { headers: { cookie: again.console! } })).text();
    expect(consolePage).toContain('<a href="/account">My account</a>');
    const consoleCsrf = /name="csrf" value="([^"]+)"/.exec(consolePage)![1]!;
    const both = `${again.console}; ${again.cookie}`;
    const consoleOut = await SELF.fetch(`${ORIGIN}/console/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { origin: ORIGIN, cookie: both, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: consoleCsrf }),
    });
    expect(consoleOut.status).toBe(303);
    expect(await pageOf(again)).toContain('action="/account/login"');

    // A reset access code ends the session too.
    const tom = await sessionOf("tom");
    await upsertMember(env.DB, "tom", "a-new-code-for-tom");
    expect(await pageOf(tom)).toContain('action="/account/login"');
  });

  it("an upload is stored like an assistant's upload, owned by the uploader and shown only to them, with no ids", async () => {
    const tom = await sessionOf("tom");
    const id = await uploaded(tom, "vat-q3-summary.pdf", "Signed copy");
    const row = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ owner: "tom", filename: "vat-q3-summary.pdf", state: "ready", mime_type: "application/pdf", source: "upload", size: PDF.byteLength });
    expect(JSON.parse(String(row!.provenance))).toEqual({ via: "web", note: "Signed copy" });

    const page = await pageOf(tom, `?uploaded=${id}`);
    expect(page).toContain("Uploaded <strong>vat-q3-summary.pdf</strong>. Tell your assistant: <q>Hand this off with vat-q3-summary.pdf.</q>");
    expect(page).toContain("Ready for handoff · Only you");
    expect(page).toContain("Expires in 7 days");
    expect(page).toContain("Signed copy");
    // The id is only in the Remove form's hidden field, never in the text people read.
    expect(page.replace(/<input type="hidden"[^>]*>/g, "")).not.toContain(id);
    expect(page).not.toContain("Copy reference");

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
    const text = await zip.text();
    expect(text).toContain("Not uploaded.");
    // The form stays open after an error.
    expect(text).toMatch(/id="upload">/);
    expect((await upload(tom, "vat.pdf", PDF, "application/pdf", undefined, "not-the-csrf")).status).toBe(403);
    const fd = new FormData();
    fd.append("file", new File([PDF], "vat.pdf", { type: "application/pdf" }));
    expect((await SELF.fetch(`${ORIGIN}/account/upload`, { method: "POST", headers: { origin: ORIGIN }, body: fd })).status).toBe(401);
    const ready = await env.DB.prepare("SELECT COUNT(*) AS n FROM attachments WHERE owner = 'tom' AND state = 'ready'").first<{ n: number }>();
    expect(ready?.n).toBe(0);
  });

  it("a second upload with the same name gets a number, so an assistant can always attach by name", async () => {
    const tim = await sessionOf("tim");
    const first = await uploaded(tim, "lease.pdf");
    const res = await upload(tim, "LEASE.pdf", PDF, "application/pdf");
    const location = new URL(res.headers.get("location")!, ORIGIN);
    expect(location.searchParams.get("renamed")).toBe("1");
    const second = location.searchParams.get("uploaded")!;
    expect((await env.DB.prepare("SELECT filename FROM attachments WHERE id = ?").bind(second).first<{ filename: string }>())?.filename).toBe("LEASE (2).pdf");
    expect(await pageOf(tim, location.search)).toContain("Uploaded as <strong>LEASE (2).pdf</strong>, because you already had a file with that name.");
    const third = await uploaded(tim, "lease.pdf");
    expect((await env.DB.prepare("SELECT filename FROM attachments WHERE id = ?").bind(third).first<{ filename: string }>())?.filename).toBe("lease (3).pdf");

    // Each name now matches one file.
    const sent = expectOk(await sendByName("tim", ["lease.pdf", "lease (2).pdf"]));
    expect((sent.attachments as Array<{ attachment_id: string }>).map((a) => a.attachment_id)).toEqual([first, second]);
    // Once the first is sent, its name is free again.
    expect(await uploaded(tim, "lease.pdf")).not.toBe(first);

    expect(numberedName("notes", 2)).toBe("notes (2)");
    expect(numberedName(".env", 2)).toBe(".env (2)");
    expect(numberedName(`${"a".repeat(260)}.pdf`, 12)).toHaveLength(255);
  });

  it("handoff_send attaches an unsent file by name, from the caller's own files only, and never guesses", async () => {
    const tim = await sessionOf("tim");
    const amy = await sessionOf("amy");
    // amy has a file with the same name: tim's send must never pick it up.
    await uploaded(amy, "vat-q3-summary.pdf");

    const none = await sendByName("tim", ["vat-q3-summary.pdf"]);
    expect(errorText(none)).toContain("not_found: attachment_names: none of your unsent files is named");
    expect(errorText(none)).toContain(`${ORIGIN}/account`);

    const first = await uploaded(tim, "vat-q3-summary.pdf");
    const sent = expectOk(await sendByName("tim", ["VAT-Q3-Summary.pdf"]));
    expect((sent.attachments as Array<{ attachment_id: string }>).map((a) => a.attachment_id)).toEqual([first]);

    // Two unsent files with the same name (an assistant's upload is not numbered): nothing is sent, and both are listed.
    const a = await uploaded(tim, "flagged-invoices.pdf", "first draft");
    const b = await uploaded(tim, "flagged-invoices.pdf", "final");
    await env.DB.prepare("UPDATE attachments SET filename = 'flagged-invoices.pdf' WHERE id = ?").bind(b).run();
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

  it("lists handoffs with who sent them to whom, and a sent file stays findable under its handoff", async () => {
    const tim = await sessionOf("tim");
    const tom = await sessionOf("tom");
    await uploaded(tim, "vat-q3-summary.pdf");
    expectOk(await sendByName("tim", ["vat-q3-summary.pdf"]));
    await send("tim", "team", "Store opening checklist");
    await send("tim", undefined, "Notes for my laptop");
    // Distinct send times, an hour apart, so the order is known.
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    for (const [title, h] of [["Q3 VAT for the bakery", 3], ["Store opening checklist", 2], ["Notes for my laptop", 1]] as const) {
      await env.DB.prepare("UPDATE packets SET created_at = ? WHERE title = ?").bind(hoursAgo(h), title).run();
    }

    const mine = await pageOf(tim);
    expect(mine).toContain("Sent to tom · 1 file");
    expect(mine).toContain("Sent to the team · Brief only");
    expect(mine).toContain("To yourself · Brief only");
    expect(mine).toMatch(/class="file-chip"[^>]*>.*vat-q3-summary\.pdf<\/a>/);
    expect(mine).not.toContain("Ready for handoff");
    expect(mine).toMatch(/Expires in \d+ (days|hours)/);
    // One list, newest first: a file uploaded now comes before the handoffs.
    await uploaded(tim, "draft.md");
    const now = await pageOf(tim);
    const at = ["draft.md", "Notes for my laptop", "Store opening checklist", "Q3 VAT for the bakery"].map((t) => now.indexOf(t));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);

    const theirs = await pageOf(tom);
    expect(theirs).toContain("Received from tim · 1 file");
    expect(theirs).toContain("From tim, to the team · Brief only");
    expect(theirs).not.toContain("Notes for my laptop");
  });

  it("shows older handoffs a page at a time, so none are hidden", async () => {
    const tom = await sessionOf("tom");
    for (let i = 1; i <= 21; i++) await send("tim", "tom", `Handoff ${String(i).padStart(2, "0")}`);
    const titles = (html: string) => [...html.matchAll(/<div class="asset-name">(Handoff \d\d)<\/div>/g)].map((m) => m[1]!);
    const first = await pageOf(tom);
    expect(titles(first)).toHaveLength(20);
    const older = /href="\/account\?older=([^"]+)">Show older handoffs<\/a>/.exec(first)![1]!;
    const second = await pageOf(tom, `?older=${older}`);
    expect(second).toContain("<h1>Older handoffs</h1>");
    expect(titles(second)).toHaveLength(1);
    expect(new Set([...titles(first), ...titles(second)]).size).toBe(21);
    expect(second).toContain('href="/account">Back to the newest</a>');
    expect(second).not.toContain("Show older handoffs");

    const bad = await SELF.fetch(`${ORIGIN}/account?older=not-a-cursor`, { redirect: "manual", headers: { cookie: tom.cookie } });
    expect(bad.status).toBe(303);
    expect(bad.headers.get("location")).toBe("/account");
  });

  it("a member downloads the files of their live handoffs; other members and revoked handoffs are refused", async () => {
    const tim = await sessionOf("tim");
    const id = await uploaded(tim, "vat-q3-summary.pdf");
    const sent = expectOk(await sendByName("tim", ["vat-q3-summary.pdf"]));
    const path = `/account/download/${sent.packet_id}/${id}`;

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
    expect((await post(tom, "/account/remove", { id: theirs })).status).toBe(404);
    const removed = await post(tom, "/account/remove", { id: mine });
    expect(removed.status).toBe(303);
    expect(removed.headers.get("location")).toBe("/account?removed=1");
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(mine).first()).toBeNull();

    const sent = await uploaded(tim, "sent.pdf");
    expectOk(await sendByName("tim", ["sent.pdf"]));
    const late = await post(tim, "/account/remove", { id: sent });
    expect(late.status).toBe(410);
    expect(await late.text()).toContain("That file is in a handoff now, or was already removed.");
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(sent).first()).not.toBeNull();
  });

  it("old /files links and open tabs move to /account, keeping a form's method", async () => {
    const page = await SELF.fetch(`${ORIGIN}/files?uploaded=x`, { redirect: "manual" });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("/account?uploaded=x");
    const dl = await SELF.fetch(`${ORIGIN}/files/download/pk_1/at_1`, { redirect: "manual" });
    expect(dl.headers.get("location")).toBe("/account/download/pk_1/at_1");
    const up = await SELF.fetch(`${ORIGIN}/files/upload`, { method: "POST", redirect: "manual", headers: { origin: ORIGIN } });
    expect(up.status).toBe(307);
    expect(up.headers.get("location")).toBe("/account/upload");
  });

  it("the Connect page and the console link to My account", async () => {
    expect(await (await SELF.fetch(`${ORIGIN}/connect`)).text()).toContain('Upload it in <a href="/account">My account</a>');
  });

  it("on the control center the sign-in names the team", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/account`), { ...env, HANDOFF_MODE: "control" }, createExecutionContext());
    const html = await res.text();
    expect(html).toContain('name="team"');
    expect(html).not.toContain("—");
  });
});
