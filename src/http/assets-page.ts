import { bytes, document, esc, plural, sideNav, utc, when, type Html, type NavUser } from "../console/html";
import type { HandoffWithFiles, PacketView, UnsentFile } from "../domain/service";
import { MAX_NOTE_CHARS } from "../domain/service";
import { FILE_ICON } from "./style";

/**
 * Assets (/assets): the member's handoffs and the files they uploaded, in one list. A handoff opens to its brief
 * and its files, each shown in the page: PDFs in the browser's viewer, images, text and Markdown. An unsent
 * upload opens the same way. Every page has the left menu: Assets first, Assistant setup, and an admin's team.
 */
const SITE = "Handoff";

const svg = (paths: string): Html =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const HANDOFF_ICON = svg('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>');
const PLUS_ICON = svg('<path d="M5 12h14"/><path d="M12 5v14"/>');
const BACK_ICON = svg('<path d="m15 18-6-6 6-6"/>');

const ASSETS_CSS = `
main.assets{align-items:stretch}
.assets-wrap{width:100%;max-width:920px;display:flex;flex-direction:column;gap:16px}
.assets-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.eyebrow{margin:0;font-size:13px;color:var(--muted)}
.assets h1{margin:2px 0 0;font-size:28px;font-weight:500;letter-spacing:-.03em;line-height:1.2;overflow-wrap:anywhere}
.lead{margin:4px 0 0;color:var(--muted);font-size:14px}
.btn.lg{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:8px 14px;font-size:14px;text-decoration:none}
.btn svg{width:16px;height:16px}
.assets-upload{gap:14px;padding:18px 20px}
.assets-upload[hidden]{display:none}
.assets-upload input[type=file]{background:var(--ground)}
.assets-actions{display:flex;gap:8px;flex-wrap:wrap}
.assets-list{background:var(--panel);border:1px solid var(--line);border-radius:8px}
.asset{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;padding:18px 20px;border-bottom:1px solid var(--line-soft)}
.asset:last-child{border-bottom:0}
.asset-icon{display:flex;align-items:center;justify-content:center;width:32px;height:36px;border:1px solid var(--line-soft);border-radius:6px;background:var(--ground);color:var(--muted)}
.asset-icon svg{width:16px;height:16px}
a.asset-name{font-weight:500;overflow-wrap:anywhere;color:var(--ink);text-decoration:none}
a.asset-name:hover{text-decoration:underline;text-underline-offset:3px}
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
.assets-empty{padding:28px 20px;color:var(--muted);font-size:14px}
.assets-more{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px}
.flash q,.say q{font-weight:500}
.back{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--muted);text-decoration:none;align-self:flex-start}
.back svg{width:15px;height:15px}.back:hover{color:var(--ink)}
.brief{padding:20px 24px}
.brief>.t{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;font-weight:500}
.md{font-size:15px;line-height:1.65;overflow-wrap:anywhere;max-width:72ch}
.md>:first-child{margin-top:0}.md>:last-child{margin-bottom:0}
.md p{margin:0 0 12px}.md ul,.md ol{margin:0 0 12px;padding-left:22px}.md li{margin:4px 0}
.md h3,.md h4,.md h5,.md h6{font-size:15px;font-weight:600;margin:18px 0 6px}
.md a{text-decoration:underline;text-underline-offset:3px}
.md code{font:13px var(--mono);background:var(--ground);border:1px solid var(--line-soft);border-radius:4px;padding:0 4px}
.md pre{background:var(--ground);border:1px solid var(--line-soft);border-radius:6px;padding:12px 14px;overflow:auto;margin:0 0 12px}
.md pre code{border:0;padding:0;background:none}
.md blockquote{margin:0 0 12px;padding-left:12px;border-left:2px solid var(--line);color:var(--muted)}
.md hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.files-h{margin:8px 0 0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500}
.preview{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;scroll-margin-top:16px}
.preview-head{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--line-soft)}
.preview-name{display:inline-flex;align-items:center;gap:8px;font:500 13px var(--mono);overflow-wrap:anywhere;min-width:0;flex:1 1 220px}
.preview-name svg{width:15px;height:15px;flex:none;color:var(--accent)}
.preview-actions{display:flex;gap:8px;margin-left:auto}
.preview-body{background:var(--ground)}
.preview-body iframe{display:block;width:100%;height:78vh;min-height:420px;border:0;background:#fff}
.pdf-tap{display:none}
.preview-body img{display:block;max-width:100%;max-height:80vh;margin:0 auto;object-fit:contain}
.preview-body.image{padding:12px}
.preview-body pre.text{margin:0;padding:16px 18px;font:13px/1.55 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:70vh;overflow:auto;color:var(--ink)}
.preview-body .md{padding:18px 22px;max-height:70vh;overflow:auto;max-width:none}
.preview-cut{padding:8px 16px;font-size:12px;color:var(--muted);border-top:1px solid var(--line-soft);background:var(--panel)}
.say{font-size:14px;color:var(--muted);margin:4px 0 0}
@media(max-width:640px){
  .assets h1{font-size:24px}
  .asset{grid-template-columns:28px minmax(0,1fr);padding:16px 14px;gap:10px}
  .asset-icon{width:28px;height:32px}
  .asset-meta{grid-column:2;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 14px;text-align:left;white-space:normal}
  .btn.lg{min-height:44px}
  .assets-upload .field{font-size:16px}
  .brief{padding:16px}
  /* Phones show no PDF inside a page (Android shows nothing; iPhone one page). Opening it uses the phone's own viewer. */
  .preview-body.pdf iframe{display:none}
  .pdf-tap{display:flex;align-items:center;gap:12px;padding:18px 16px;color:var(--ink);text-decoration:none;min-height:64px}
  .pdf-tap svg{width:22px;height:22px;flex:none;color:var(--accent)}
  .pdf-tap strong{display:block;font-weight:500;overflow-wrap:anywhere}
  .preview-actions{margin-left:0}
}
`;

/** Upload file opens the form and the file picker in one tap; Cancel closes it. */
const ASSETS_SCRIPT = `(function () {
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
})();`;

export interface AssetsViewer {
  /** The handle people see. */
  handle: string;
  tenant: string;
  control: boolean;
  /** Has the admin grant: the menu adds the team's pages. */
  admin: boolean;
  csrf: string;
  /** The other accounts this browser is signed in to (identities), for the account menu. */
  others: string[];
}

export type Flash = { text: Html; ok: boolean } | null;

const csrf = (v: AssetsViewer): Html => `<input type="hidden" name="csrf" value="${esc(v.csrf)}">`;
const nav = (v: AssetsViewer): NavUser => ({
  handle: v.handle,
  tenant: v.tenant,
  control: v.control,
  admin: v.admin,
  csrf: v.csrf,
  others: v.others,
});

/** A signed-in page: the left menu and the page's content. */
const appPage = (v: AssetsViewer, title: string, body: Html, nonce: string): Html =>
  document(title, `<div class="shell">\n  ${sideNav(nav(v), "assets")}\n  <main class="assets" id="main"><div class="assets-wrap">${body}</div></main>\n</div>`, { nonce, script: ASSETS_SCRIPT, style: ASSETS_CSS }, SITE);

const typeLabel = (mime: string | null): string =>
  mime === "application/pdf" ? "PDF" : mime === "image/png" ? "PNG" : mime === "image/jpeg" ? "JPEG" : mime === "text/markdown" ? "Markdown" : mime === "text/plain" ? "Text" : "File";

/** "Expires in 40 min", "in 19 hours", "in 7 days", with the exact time on hover. */
function expires(iso: string, now: number): Html {
  const s = Math.max(0, (Date.parse(iso) - now) / 1000);
  const text = s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 48 * 3600 ? plural(Math.round(s / 3600), "hour") : plural(Math.round(s / 86400), "day");
  return `<span title="${esc(utc(iso))}">Expires in ${text}</span>`;
}

/** Who a handoff went from and to, from the viewer's side. The team recipient is "*". */
function direction(me: string, h: { from: string; to: string }): string {
  if (h.from === me) return h.to === me ? "To yourself" : h.to === "*" ? "Sent to the team" : `Sent to ${h.to}`;
  return h.to === "*" ? `From ${h.from}, to the team` : `Received from ${h.from}`;
}

const handoffHref = (packetId: string): string => `/assets/handoff/${encodeURIComponent(packetId)}`;
const fileHref = (attachmentId: string): string => `/assets/file/${encodeURIComponent(attachmentId)}`;

function fileRow(v: AssetsViewer, f: UnsentFile, now: number, unsentTtlMs: number): Html {
  const until = new Date(Date.parse(f.uploaded_at) + unsentTtlMs).toISOString();
  return `<article class="asset">
    <span class="asset-icon">${FILE_ICON}</span>
    <div>
      <a class="asset-name" href="${fileHref(f.attachment_id)}">${esc(f.filename)}</a>
      <div class="asset-sub"><span class="ready">Ready for handoff · Only you</span> · ${esc(typeLabel(f.mime_type))}, ${esc(bytes(f.size))}</div>
      ${f.note ? `<div class="asset-note">${esc(f.note)}</div>` : ""}
    </div>
    <div class="asset-meta">${when(f.uploaded_at, now)}${expires(until, now)}<form method="post" action="/assets/remove">${csrf(v)}<input type="hidden" name="id" value="${esc(f.attachment_id)}"><button type="submit" class="link-btn" aria-label="Remove ${esc(f.filename)}">Remove</button></form></div>
  </article>`;
}

function handoffRow(v: AssetsViewer, h: HandoffWithFiles, now: number): Html {
  const href = handoffHref(h.packet_id);
  const files = h.attachments
    .map((a) => `<a class="file-chip" href="${href}#f-${esc(a.attachment_id)}" title="Open ${esc(a.filename)} (${esc(typeLabel(a.mime_type))}, ${esc(bytes(a.size))})">${FILE_ICON}${esc(a.filename)}</a>`)
    .join("");
  return `<article class="asset">
    <span class="asset-icon">${HANDOFF_ICON}</span>
    <div>
      <a class="asset-name" href="${href}">${esc(h.title)}</a>
      <div class="asset-sub">${esc(direction(v.handle, h))} · ${h.attachments.length ? plural(h.attachments.length, "file") : "Brief only"}</div>
      ${files ? `<div class="asset-files">${files}</div>` : ""}
    </div>
    <div class="asset-meta">${when(h.created_at, now)}${expires(h.expires_at, now)}</div>
  </article>`;
}

export interface AssetsData {
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

const flashBox = (f: Flash): Html => (f ? `<div class="flash${f.ok ? " ok" : ""}" role="${f.ok ? "status" : "alert"}">${f.text}</div>` : "");

export function assetsPage(v: AssetsViewer, d: AssetsData, nonce: string): Html {
  // One list, newest first: an unsent file by its upload time, a handoff by its send time.
  const rows = [
    ...d.unsent.map((f) => ({ at: f.uploaded_at, html: fileRow(v, f, d.now, d.unsentTtlMs) })),
    ...d.handoffs.map((h) => ({ at: h.created_at, html: handoffRow(v, h, d.now) })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map((r) => r.html)
    .join("");
  const empty = d.older
    ? `<div class="assets-empty">No older handoffs.</div>`
    : `<div class="assets-empty">Nothing here yet. Handoffs you send or receive, and files you upload, show up here until they expire.</div>`;
  const more =
    d.older || d.nextCursor
      ? `<div class="assets-more">${d.older ? `<a class="u" href="/assets">Back to the newest</a>` : "<span></span>"}${d.nextCursor ? `<a class="u" href="/assets?older=${encodeURIComponent(d.nextCursor)}">Show older handoffs</a>` : ""}</div>`
      : "";
  return appPage(
    v,
    "Assets",
    `<div class="assets-head">
    <div><h1>${d.older ? "Older handoffs" : "Assets"}</h1><p class="lead">Handoffs you sent or received, and files you uploaded.</p></div>
    <a class="btn primary lg" href="/assets?upload=1#upload" data-upload>${PLUS_ICON}Upload file</a>
  </div>
  ${flashBox(d.flash)}
  <form method="post" action="/assets/upload" enctype="multipart/form-data" class="panel assets-upload" id="upload"${d.uploadOpen ? "" : " hidden"}>
    ${csrf(v)}
    <div class="t">Upload a file</div>
    <div><label class="lbl" for="file">File</label><input id="file" name="file" type="file" class="field" required accept=".pdf,.png,.jpg,.jpeg,.txt,.md,application/pdf,image/png,image/jpeg,text/plain,text/markdown"></div>
    <div><label class="lbl" for="note">Note for your assistant (optional)</label><input id="note" name="note" class="field" maxlength="${MAX_NOTE_CHARS}" placeholder="Signed lease, final version"></div>
    <p class="small muted">PDF, PNG, JPEG, text or Markdown, up to ${esc(bytes(d.maxBytes))}. Only you can see it until your assistant sends it in a handoff. A file not sent within 7 days is deleted.</p>
    <div class="assets-actions"><button type="submit" class="btn primary lg">Upload</button><a class="btn lg" href="/assets" data-cancel>Cancel</a></div>
  </form>
  <section class="assets-list" aria-label="Assets">${rows || empty}</section>
  ${more}`,
    nonce,
  );
}

/** How a file shows in the page. Text and Markdown arrive already read, cut to a length a page can hold. */
export type Preview =
  | { kind: "pdf" | "image" }
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "markdown"; html: Html; cut: boolean }
  | { kind: "none" };

export interface FileCard {
  attachment_id: string;
  filename: string;
  mime_type: string | null;
  size: number | null;
  /** The bytes shown in the page (inline). */
  view: string;
  download: string;
  preview: Preview;
}

const cutNote = (cut: boolean): Html => (cut ? `<div class="preview-cut">Shows the beginning of the file. Download it for the rest.</div>` : "");

function fileCard(f: FileCard): Html {
  const p = f.preview;
  const body =
    p.kind === "pdf"
      ? `<div class="preview-body pdf"><iframe src="${esc(f.view)}" title="${esc(f.filename)}" loading="lazy"></iframe><a class="pdf-tap" href="${esc(f.view)}" target="_blank" rel="noopener">${FILE_ICON}<span><strong>Open ${esc(f.filename)}</strong><span class="small muted">Opens in your phone's PDF viewer</span></span></a></div>`
      : p.kind === "image"
        ? `<div class="preview-body image"><img src="${esc(f.view)}" alt="${esc(f.filename)}" loading="lazy"></div>`
        : p.kind === "text"
          ? `<div class="preview-body"><pre class="text">${esc(p.text)}</pre></div>${cutNote(p.cut)}`
          : p.kind === "markdown"
            ? `<div class="preview-body"><div class="md">${p.html}</div></div>${cutNote(p.cut)}`
            : "";
  return `<article class="preview" id="f-${esc(f.attachment_id)}">
    <header class="preview-head">
      <span class="preview-name">${FILE_ICON}<span>${esc(f.filename)}</span></span>
      <span class="small muted">${esc(typeLabel(f.mime_type))}, ${esc(bytes(f.size))}</span>
      <span class="preview-actions"><a class="btn" href="${esc(f.view)}" target="_blank" rel="noopener">Open ↗</a><a class="btn" href="${esc(f.download)}" download>Download</a></span>
    </header>
    ${body}
  </article>`;
}

/** What to say in your own assistant to pick the handoff up. */
function nextStep(me: string, h: PacketView): Html {
  if (h.from !== me) return `To continue in your assistant, say <q>Continue the handoff from ${esc(h.from)}.</q>`;
  if (h.to === me) return `In your other assistant, say <q>Continue my handoff.</q>`;
  const who = h.to === "*" ? "Your team" : esc(h.to);
  return `${who} picks it up by saying <q>Continue the handoff from ${esc(me)}.</q>`;
}

export function handoffPage(v: AssetsViewer, h: PacketView, brief: Html, files: FileCard[], now: number, nonce: string): Html {
  const count = files.length ? plural(files.length, "file") : "Brief only";
  return appPage(
    v,
    h.title,
    `<a class="back" href="/assets">${BACK_ICON}Assets</a>
  <header>
    <p class="eyebrow">${esc(direction(v.handle, h))} · ${count}</p>
    <h1>${esc(h.title)}</h1>
    <p class="lead">Sent ${when(h.created_at, now)} · ${expires(h.expires_at, now)}</p>
  </header>
  <section class="panel brief" aria-label="Brief"><h2 class="t">Brief</h2><div class="md">${brief}</div></section>
  ${files.length ? `<h2 class="files-h">Files</h2>${files.map(fileCard).join("")}` : ""}
  <p class="say">${nextStep(v.handle, h)}</p>`,
    nonce,
  );
}

export function filePage(v: AssetsViewer, f: UnsentFile, card: FileCard, now: number, unsentTtlMs: number, nonce: string): Html {
  const until = new Date(Date.parse(f.uploaded_at) + unsentTtlMs).toISOString();
  return appPage(
    v,
    f.filename,
    `<a class="back" href="/assets">${BACK_ICON}Assets</a>
  <header>
    <p class="eyebrow">Ready for handoff · Only you</p>
    <h1>${esc(f.filename)}</h1>
    <p class="lead">Uploaded ${when(f.uploaded_at, now)} · ${expires(until, now)}</p>
  </header>
  ${f.note ? `<p class="asset-note">${esc(f.note)}</p>` : ""}
  ${fileCard(card)}
  <p class="say">To send it, tell your assistant: <q>Hand this off with ${esc(f.filename)}.</q></p>
  <form method="post" action="/assets/remove">${csrf(v)}<input type="hidden" name="id" value="${esc(f.attachment_id)}"><button type="submit" class="btn">Remove this file</button></form>`,
    nonce,
  );
}

/** The kind of preview a stored type gets. Only types the upload checks admit are shown in the page. */
export function previewKind(mime: string | null): "pdf" | "image" | "text" | "markdown" | "none" {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png" || mime === "image/jpeg") return "image";
  if (mime === "text/markdown") return "markdown";
  if (mime === "text/plain") return "text";
  return "none";
}

