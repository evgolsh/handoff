import { bytes, document, esc, flowHeader, plural, utc, when, type Html } from "../console/html";
import type { HandoffWithFiles, UnsentFile } from "../domain/service";
import { MAX_NOTE_CHARS } from "../domain/service";
import { BRAND_ICON, FILE_ICON } from "./style";

/**
 * My account (/account): one list of the member's assets. Files they uploaded that no handoff carries yet, and
 * the live handoffs they sent or received with their files. Each row says who can see it and when it expires.
 * A mailbox with a slot, not a drive: no folders, previews or ids. Administration stays in /console.
 */
const SITE = "Handoff";

const svg = (paths: string): Html =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const HANDOFF_ICON = svg('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>');
const PLUS_ICON = svg('<path d="M5 12h14"/><path d="M12 5v14"/>');
const CHEVRON_ICON = svg('<path d="m6 9 6 6 6-6"/>');

const ACCOUNT_CSS = `
.acct-top{background:var(--panel);border-bottom:1px solid var(--line)}
.acct-top>div{max-width:880px;margin:auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.acct-top .brand{font-size:17px;text-decoration:none}
.acct-menu{position:relative}
.acct-menu summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:6px;min-height:40px;font-size:14px}
.acct-menu summary::-webkit-details-marker{display:none}
.acct-menu summary svg{width:16px;height:16px;color:var(--muted)}
.acct-menu .menu{position:absolute;right:0;top:100%;z-index:5;min-width:200px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px;box-shadow:0 8px 24px #00000014;display:flex;flex-direction:column}
.acct-menu .menu a,.acct-menu .menu button{display:block;width:100%;text-align:left;font:inherit;font-size:14px;padding:10px;border:0;border-radius:5px;background:none;color:var(--ink);text-decoration:none;cursor:pointer}
.acct-menu .menu a:hover,.acct-menu .menu button:hover{background:var(--ground);color:var(--ink)}
.acct-menu .menu form{margin:0;border-top:1px solid var(--line-soft);margin-top:4px;padding-top:4px}
main.acct{max-width:880px;margin:0 auto 64px;padding:32px 24px 0;display:flex;flex-direction:column;gap:16px}
.acct-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.eyebrow{margin:0;font-size:13px;color:var(--muted)}
.acct h1,.acct-signin h1{margin:2px 0 0;font-size:28px;font-weight:500;letter-spacing:-.03em;line-height:1.2}
.btn.lg{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:8px 14px;font-size:14px}
.btn svg{width:16px;height:16px}
.acct-upload{gap:14px;padding:18px 20px}
.acct-upload[hidden]{display:none}
.acct-upload input[type=file]{background:var(--ground)}
.acct-actions{display:flex;gap:8px;flex-wrap:wrap}
.acct-list{background:var(--panel);border:1px solid var(--line);border-radius:8px}
.asset{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line-soft)}
.asset:last-child{border-bottom:0}
.asset-icon{display:flex;align-items:center;justify-content:center;width:32px;height:36px;border:1px solid var(--line-soft);border-radius:6px;background:var(--ground);color:var(--muted)}
.asset-icon svg{width:16px;height:16px}
.asset-name{font-weight:500;overflow-wrap:anywhere}
.asset-sub{font-size:13px;color:var(--muted);margin-top:2px}
.asset-sub .ready{color:var(--ok)}
.asset-note{font-size:13px;margin-top:4px;overflow-wrap:anywhere}
.asset-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.file-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:4px 8px;border:1px solid var(--line);border-radius:4px;background:var(--ground);font:12px/1.5 var(--mono);color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
.file-chip svg{width:13px;height:13px;flex:none;color:var(--accent)}
.file-chip:hover{border-color:var(--accent);color:var(--ink)}
.asset-meta{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px;align-items:flex-end;text-align:right;white-space:nowrap}
.asset-meta form{margin:0}
.link-btn{font:inherit;font-size:12px;background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;text-decoration-color:var(--faint);text-underline-offset:3px;cursor:pointer}
.link-btn:hover{color:var(--danger)}
.acct-empty{padding:28px 20px;color:var(--muted);font-size:14px}
.acct-more{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px}
.flash q{font-weight:500}
.acct-signin{max-width:440px;margin:4vh auto 64px;padding:0 16px}
.acct-signin .lead{margin:6px 0 0;color:var(--muted)}
@media(max-width:640px){
  .acct-top>div{padding:10px 16px}
  main.acct{padding:24px 16px 0}
  .acct h1{font-size:26px}
  .asset{grid-template-columns:28px minmax(0,1fr);padding:16px 14px;gap:10px}
  .asset-icon{width:28px;height:32px}
  .asset-meta{grid-column:2;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 14px;text-align:left;white-space:normal}
  .btn.lg{min-height:44px}
  .acct-upload .field{font-size:16px}
}
`;

/** Upload file opens the form and the file picker in one tap; Cancel closes it; the account menu closes on a click outside or Escape. */
const ACCOUNT_SCRIPT = `(function () {
  var form = document.getElementById("upload");
  var open = document.querySelector("[data-upload]");
  var cancel = document.querySelector("[data-cancel]");
  if (form && open) open.addEventListener("click", function (e) {
    e.preventDefault();
    form.hidden = false;
    var input = document.getElementById("file");
    if (input) { input.focus(); input.click(); }
  });
  if (form && cancel) cancel.addEventListener("click", function (e) { e.preventDefault(); form.reset(); form.hidden = true; });
  var menu = document.querySelector("details.acct-menu");
  if (!menu) return;
  document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
  });
})();`;

const page = (title: string, body: Html, nonce: string): Html => document(title, body, { nonce, script: ACCOUNT_SCRIPT, style: ACCOUNT_CSS }, SITE);

export interface AccountViewer {
  handle: string;
  tenant: string;
  csrf: string;
  /** Has the admin grant: the menu links to the console. */
  admin: boolean;
}

export type Flash = { text: Html; ok: boolean } | null;

const csrf = (v: AccountViewer): Html => `<input type="hidden" name="csrf" value="${esc(v.csrf)}">`;

/** The sign-in form. On the control center a member also names their team. */
export function accountLoginPage(opts: { control: boolean; error?: string; team?: string }, nonce: string): Html {
  return page(
    "My account",
    `${flowHeader("/connect", "Assistant setup")}
<main class="acct-signin">
  <form method="post" action="/account/login" class="flow-panel" autocomplete="off">
    <div><p class="eyebrow">My account</p><h1>Sign in</h1><p class="lead">Your files and handoffs, in one place.</p></div>
    ${opts.error ? `<div class="flash" role="alert">${esc(opts.error)}</div>` : ""}
    ${opts.control ? `<div><label class="lbl" for="team">Team name</label><input id="team" name="team" class="field" autofocus autocapitalize="none" spellcheck="false" placeholder="acme" value="${esc(opts.team ?? "")}"></div>` : ""}
    <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required${opts.control ? "" : " autofocus"} autocapitalize="none" spellcheck="false" placeholder="tom"></div>
    <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required></div>
    <button type="submit" class="btn primary">Sign in</button>
    <p class="flow-note">Use the username and access code you use with your assistants. Admins reach the console from here too.</p>
  </form>
</main>`,
    nonce,
  );
}

const typeLabel = (mime: string | null): string =>
  mime === "application/pdf" ? "PDF" : mime === "image/png" ? "PNG" : mime === "image/jpeg" ? "JPEG" : mime === "text/markdown" ? "Markdown" : mime === "text/plain" ? "Text" : "File";

/** "Expires in 40 min", "in 19 hours", "in 7 days", with the exact time on hover. */
function expires(iso: string, now: number): Html {
  const s = Math.max(0, (Date.parse(iso) - now) / 1000);
  const text = s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 48 * 3600 ? plural(Math.round(s / 3600), "hour") : plural(Math.round(s / 86400), "day");
  return `<span title="${esc(utc(iso))}">Expires in ${text}</span>`;
}

/** Who a handoff went from and to, from the viewer's side. The team recipient is "*". */
function direction(me: string, h: HandoffWithFiles): string {
  if (h.from === me) return h.to === me ? "To yourself" : h.to === "*" ? "Sent to the team" : `Sent to ${h.to}`;
  return h.to === "*" ? `From ${h.from}, to the team` : `Received from ${h.from}`;
}

function fileRow(v: AccountViewer, f: UnsentFile, now: number, unsentTtlMs: number): Html {
  const until = new Date(Date.parse(f.uploaded_at) + unsentTtlMs).toISOString();
  return `<article class="asset">
    <span class="asset-icon">${FILE_ICON}</span>
    <div>
      <div class="asset-name">${esc(f.filename)}</div>
      <div class="asset-sub"><span class="ready">Ready for handoff · Only you</span> · ${esc(typeLabel(f.mime_type))}, ${esc(bytes(f.size))}</div>
      ${f.note ? `<div class="asset-note">${esc(f.note)}</div>` : ""}
    </div>
    <div class="asset-meta">${when(f.uploaded_at, now)}${expires(until, now)}<form method="post" action="/account/remove">${csrf(v)}<input type="hidden" name="id" value="${esc(f.attachment_id)}"><button type="submit" class="link-btn" aria-label="Remove ${esc(f.filename)}">Remove</button></form></div>
  </article>`;
}

function handoffRow(v: AccountViewer, h: HandoffWithFiles, now: number): Html {
  const files = h.attachments
    .map(
      (a) =>
        `<a class="file-chip" href="/account/download/${esc(h.packet_id)}/${esc(a.attachment_id)}" download title="Download ${esc(a.filename)} (${esc(typeLabel(a.mime_type))}, ${esc(bytes(a.size))})">${FILE_ICON}${esc(a.filename)}</a>`,
    )
    .join("");
  return `<article class="asset">
    <span class="asset-icon">${HANDOFF_ICON}</span>
    <div>
      <div class="asset-name">${esc(h.title)}</div>
      <div class="asset-sub">${esc(direction(v.handle, h))} · ${h.attachments.length ? plural(h.attachments.length, "file") : "Brief only"}</div>
      ${files ? `<div class="asset-files">${files}</div>` : ""}
    </div>
    <div class="asset-meta">${when(h.created_at, now)}${expires(h.expires_at, now)}</div>
  </article>`;
}

export interface AccountData {
  /** Empty on the pages of older handoffs. */
  unsent: UnsentFile[];
  handoffs: HandoffWithFiles[];
  /** For "Show older handoffs". */
  nextCursor: string | null;
  /** This page continues from a cursor: older handoffs only. */
  older: boolean;
  uploadOpen: boolean;
  maxBytes: number;
  unsentTtlMs: number;
  flash: Flash;
  now: number;
}

export function accountPage(v: AccountViewer, d: AccountData, nonce: string): Html {
  // One list, newest first: an unsent file by its upload time, a handoff by its send time.
  const rows = [
    ...d.unsent.map((f) => ({ at: f.uploaded_at, html: fileRow(v, f, d.now, d.unsentTtlMs) })),
    ...d.handoffs.map((h) => ({ at: h.created_at, html: handoffRow(v, h, d.now) })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((r) => r.html)
    .join("");
  const empty = d.older
    ? `<div class="acct-empty">No older handoffs.</div>`
    : `<div class="acct-empty">Nothing here yet. Files you upload, and handoffs you send or receive, show up here until they expire.</div>`;
  const more = d.older || d.nextCursor
    ? `<div class="acct-more">${d.older ? `<a class="u" href="/account">Back to the newest</a>` : "<span></span>"}${d.nextCursor ? `<a class="u" href="/account?older=${encodeURIComponent(d.nextCursor)}">Show older handoffs</a>` : ""}</div>`
    : "";
  return page(
    "My account",
    `<header class="acct-top"><div>
  <a class="brand" href="/account">${BRAND_ICON}<span>Handoff</span></a>
  <details class="acct-menu">
    <summary><span><strong>${esc(v.handle)}</strong>${v.tenant ? `<span class="muted"> · ${esc(v.tenant)}</span>` : ""}</span>${CHEVRON_ICON}<span class="sr-only">Account menu</span></summary>
    <div class="menu">
      ${v.admin ? `<a href="/console/overview">Admin console</a>` : ""}
      <a href="/connect">Assistant setup</a>
      <form method="post" action="/account/logout">${csrf(v)}<button type="submit">Sign out</button></form>
    </div>
  </details>
</div></header>
<main class="acct">
  <div class="acct-head">
    <div><p class="eyebrow">My account</p><h1>${d.older ? "Older handoffs" : "My assets"}</h1></div>
    <a class="btn primary lg" href="/account?upload=1#upload" data-upload>${PLUS_ICON}Upload file</a>
  </div>
  ${d.flash ? `<div class="flash${d.flash.ok ? " ok" : ""}" role="${d.flash.ok ? "status" : "alert"}">${d.flash.text}</div>` : ""}
  <form method="post" action="/account/upload" enctype="multipart/form-data" class="panel acct-upload" id="upload"${d.uploadOpen ? "" : " hidden"}>
    ${csrf(v)}
    <div class="t">Upload a file</div>
    <div><label class="lbl" for="file">File</label><input id="file" name="file" type="file" class="field" required accept=".pdf,.png,.jpg,.jpeg,.txt,.md,application/pdf,image/png,image/jpeg,text/plain,text/markdown"></div>
    <div><label class="lbl" for="note">Note for your assistant (optional)</label><input id="note" name="note" class="field" maxlength="${MAX_NOTE_CHARS}" placeholder="Signed lease, final version"></div>
    <p class="small muted">PDF, PNG, JPEG, text or Markdown, up to ${esc(bytes(d.maxBytes))}. Only you can see it until your assistant sends it in a handoff. A file not sent within 7 days is deleted.</p>
    <div class="acct-actions"><button type="submit" class="btn primary lg">Upload</button><a class="btn lg" href="/account" data-cancel>Cancel</a></div>
  </form>
  <section class="acct-list" aria-label="My assets">${rows || empty}</section>
  ${more}
</main>`,
    nonce,
  );
}
