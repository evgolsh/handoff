import { ago, bytes, document, esc, plural, sideNav, utc, when, type Html, type NavUser } from "../console/html";
import type { Delivery, HandoffWithFiles, PacketView, Pickup, UnsentFile } from "../domain/service";
import { MAX_NOTE_CHARS } from "../domain/service";
import { COPY_SCRIPT } from "./clipboard";
import { FILE_ICON } from "./style";

/**
 * Assets (/assets): the member's files waiting to be sent, handoffs others sent them that they have not opened
 * yet, and all their handoffs with who picked each one up. A handoff opens to its brief and its files, each shown
 * in the page: PDFs in the browser's viewer, images, text and Markdown. An unsent upload opens the same way.
 * Every page has the left menu: Assets first, Assistant setup, and an admin's team.
 */
const SITE = "Handoff";

const svg = (paths: string): Html =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const HANDOFF_ICON = svg('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>');
const PLUS_ICON = svg('<path d="M5 12h14"/><path d="M12 5v14"/>');
const BACK_ICON = svg('<path d="m15 18-6-6 6-6"/>');
const CHECK_ICON = svg('<path d="M20 6 9 17l-5-5"/>');
const EYE_ICON = svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');

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
.assets-sect{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.sect-head{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}
.sect-h{margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500}
.sect-note{font-size:13px;color:var(--muted);flex:1 1 300px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:7px;padding:2px;background:var(--panel)}
.seg a{font-size:13px;color:var(--muted);padding:5px 12px;border-radius:5px;text-decoration:none}
.seg a:hover{color:var(--ink)}
.seg a[aria-current]{background:var(--line-soft);color:var(--ink);font-weight:500}
.asset{display:grid;grid-template-columns:32px minmax(0,1fr) minmax(150px,auto);gap:12px;padding:18px 20px;border-bottom:1px solid var(--line-soft)}
.asset-status{display:flex;flex-direction:column;align-items:flex-end;text-align:right;gap:2px;font-size:13px}
.st{display:inline-flex;align-items:center;gap:6px;font-weight:500;white-space:nowrap}
.st svg{width:14px;height:14px;flex:none}
.st.ok{color:var(--ok)}.st.new{color:var(--accent)}
.st-meta{font-size:12px;color:var(--muted)}
.st-soon{font-size:12px;color:var(--warn)}
.hollow{width:10px;height:10px;border-radius:50%;border:2px solid var(--muted);flex:none}
.dot.new{background:var(--accent)}
.say-box{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;margin-top:8px;font-size:12px;color:var(--muted)}
.say-box q{color:var(--ink);font-weight:500;overflow-wrap:anywhere}
.say-box .btn.sm{padding:2px 8px;font-size:11px;border-color:var(--line)}
.say-box .btn.sm:hover{border-color:var(--accent);color:var(--accent)}
.asset.unread{box-shadow:inset 3px 0 0 var(--accent)}
.asset.unread:first-child{border-top-left-radius:7px}.asset.unread:last-child{border-bottom-left-radius:7px}
.first-steps{list-style:none;margin:0;padding:0;border-top:1px solid var(--line-soft)}
.first-steps>li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:14px;padding:18px 20px;border-bottom:1px solid var(--line-soft)}
.first-steps>li:last-child{border-bottom:0}
.num{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;border:1.5px solid var(--line);color:var(--muted)}
.num.done{background:var(--ok);border-color:var(--ok);color:var(--panel)}
.num svg{width:14px;height:14px}
.first-head{padding:20px 20px 12px}
.first-head h2{margin:0;font-size:17px;font-weight:500}
.first-head p,.step-sub{margin:4px 0 0;font-size:13px;color:var(--muted)}
.step-t{font-weight:500}
.status-panel{padding:20px 24px}
.status-panel>.t{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 12px;font-weight:500}
.timeline{list-style:none;margin:0;padding:0}
.tl{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:12px;align-items:start;position:relative;padding-bottom:16px}
.tl:last-child{padding-bottom:0}
.tl:not(:last-child)::before{content:"";position:absolute;left:8px;top:18px;bottom:0;width:2px;background:var(--line-soft)}
.pt{width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--panel);position:relative;border:2px solid var(--muted)}
.pt.ok{background:var(--ok);border-color:var(--ok);color:var(--panel)}
.pt.wait{border-style:dashed}
.pt.done{border:0}.pt.done::after{content:"";width:10px;height:10px;border-radius:50%;background:var(--muted)}
.pt svg{width:11px;height:11px;stroke-width:3.2}
.tl.ok>span:nth-child(2){font-weight:500;color:var(--ok)}
.tl .when{font-size:13px;color:var(--muted);white-space:nowrap}
.status-foot{display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;margin-top:18px;padding-top:14px;border-top:1px solid var(--line-soft);font-size:13px;color:var(--muted)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
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
  .asset-meta,.asset-status{grid-column:2;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px 12px;text-align:left;white-space:normal}
  .say-box .btn.sm{padding:4px 10px;font-size:12px}
  .seg{display:flex;width:100%}.seg a{flex:1;text-align:center;padding:8px 10px}
  .tl{grid-template-columns:18px minmax(0,1fr)}.tl .when{grid-column:2}
  .first-steps>li{padding:16px 14px}
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
})();
${COPY_SCRIPT}`;

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
  document(
    title,
    `<div class="shell">\n  ${sideNav(nav(v), "assets")}\n  <main class="assets" id="main"><div class="assets-wrap">${body}</div><p id="copy-status" class="sr-only" aria-live="polite"></p></main>\n</div>`,
    { nonce, script: ASSETS_SCRIPT, style: ASSETS_CSS },
    SITE,
  );

const typeLabel = (mime: string | null): string =>
  mime === "application/pdf" ? "PDF" : mime === "image/png" ? "PNG" : mime === "image/jpeg" ? "JPEG" : mime === "text/markdown" ? "Markdown" : mime === "text/plain" ? "Text" : "File";

/** "40 min", "19 hours", "7 days": how long until this time. */
function until(iso: string, now: number): string {
  const s = Math.max(0, (Date.parse(iso) - now) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 48 * 3600 ? plural(Math.round(s / 3600), "hour") : plural(Math.round(s / 86400), "day");
}

/** "Expires in 7 days", with the exact time on hover. */
const expires = (iso: string, now: number): Html => `<span title="${esc(utc(iso))}">Expires in ${until(iso, now)}</span>`;

/** Lists show a handoff's expiry only when it is close: under two days. */
const SOON_MS = 48 * 3_600_000;
const expiresSoon = (iso: string, now: number): Html =>
  Date.parse(iso) - now < SOON_MS ? `<span class="st-soon" title="${esc(utc(iso))}">Expires in ${until(iso, now)}</span>` : "";

/** Who a handoff went from and to, from the viewer's side. The team recipient is "*". */
function direction(me: string, h: { from: string; to: string }): string {
  if (h.from === me) return h.to === me ? "To yourself" : h.to === "*" ? "To the team" : `To ${h.to}`;
  return h.to === "*" ? `From ${h.from}, to the team` : `From ${h.from}`;
}

const handoffHref = (packetId: string): string => `/assets/handoff/${encodeURIComponent(packetId)}`;
const fileHref = (attachmentId: string): string => `/assets/file/${encodeURIComponent(attachmentId)}`;

/** A sentence to say to your assistant, with a button that copies it. */
const sayBox = (sentence: string, lead = "Tell your assistant"): Html =>
  `<div class="say-box"><span class="muted">${esc(lead)}</span><q>${esc(sentence)}</q><button type="button" class="btn sm" data-copy="${esc(sentence)}" aria-label="Copy: ${esc(sentence)}">Copy</button></div>`;

/** "anna", "anna and ben", "anna, ben and 3 more". */
const names = (list: string[]): string => (list.length <= 2 ? list.join(" and ") : `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`);
const unique = (ks: Pickup[]): string[] => [...new Set(ks.map((k) => k.by))];
const where = (k: Pickup): string => (k.via === "browser" ? "in the browser" : k.client ? `in ${k.client}` : "in an assistant");

/** A handoff's state from the viewer's side: picked up (in an assistant), opened (in the browser), waiting, or new. */
export interface Status {
  tone: "ok" | "seen" | "wait" | "new";
  label: string;
  meta: string[];
}

export function statusOf(me: string, h: PacketViewLike & Delivery, now: number): Status {
  const picked = h.pickups.filter((k) => k.via === "assistant");
  const opened = h.pickups.filter((k) => k.via === "browser" && !picked.some((p) => p.by === k.by));
  const last = (ks: Pickup[]) => ks[ks.length - 1]!;
  const sent = h.from === me;
  if (!sent || h.to === me) {
    // A handoff to the viewer (or to themselves): their own pickups.
    if (picked.length) return { tone: "ok", label: sent ? "Picked up" : "You picked it up", meta: [`${where(last(picked))} · ${ago(last(picked).at, now)}`] };
    if (opened.length) return { tone: "seen", label: sent ? "Opened" : "You opened it", meta: [`in the browser · ${ago(last(opened).at, now)}`] };
    return sent ? { tone: "wait", label: "Not picked up yet", meta: [] } : { tone: "new", label: "New", meta: [] };
  }
  const meta: string[] = [];
  const waiting = h.waiting.length ? [`${names(h.waiting)} not yet`] : [];
  if (picked.length) {
    const who = unique(picked);
    if (who.length === 1) meta.push(`${where(last(picked))} · ${ago(last(picked).at, now)}`);
    if (opened.length) meta.push(`Opened by ${names(unique(opened))}`);
    return { tone: "ok", label: `Picked up by ${names(who)}`, meta: [...meta, ...waiting] };
  }
  if (opened.length) {
    const who = unique(opened);
    if (who.length === 1) meta.push(`in the browser · ${ago(last(opened).at, now)}`);
    return { tone: "seen", label: `Opened by ${names(who)}`, meta: [...meta, ...waiting] };
  }
  return { tone: "wait", label: "Not picked up yet", meta: [] };
}

type PacketViewLike = { from: string; to: string; created_at: string };

const MARK: Record<Status["tone"], Html> = { ok: CHECK_ICON, seen: EYE_ICON, wait: '<span class="hollow"></span>', new: '<span class="dot new"></span>' };

function statusBlock(st: Status, expiresAt: string, now: number): Html {
  return `<div class="asset-status">
      <span class="st ${st.tone}">${MARK[st.tone]}${esc(st.label)}</span>
      ${st.meta.length ? `<span class="st-meta">${esc(st.meta.join(" · "))}</span>` : ""}
      ${expiresSoon(expiresAt, now)}
    </div>`;
}

const fileChips = (h: HandoffWithFiles): Html =>
  h.attachments
    .map((a) => `<a class="file-chip" href="${handoffHref(h.packet_id)}#f-${esc(a.attachment_id)}" title="Open ${esc(a.filename)} (${esc(typeLabel(a.mime_type))}, ${esc(bytes(a.size))})">${FILE_ICON}${esc(a.filename)}</a>`)
    .join("");
const fileCount = (n: number): string => (n ? plural(n, "file") : "Brief only");

function fileRow(v: AssetsViewer, f: UnsentFile, now: number, unsentTtlMs: number): Html {
  const gone = new Date(Date.parse(f.uploaded_at) + unsentTtlMs).toISOString();
  return `<article class="asset">
    <span class="asset-icon">${FILE_ICON}</span>
    <div>
      <a class="asset-name" href="${fileHref(f.attachment_id)}">${esc(f.filename)}</a>
      <div class="asset-sub">${esc(typeLabel(f.mime_type))}, ${esc(bytes(f.size))} · uploaded ${when(f.uploaded_at, now)}</div>
      ${f.note ? `<div class="asset-note">${esc(f.note)}</div>` : ""}
      ${sayBox(`Hand this off with ${f.filename}.`)}
    </div>
    <div class="asset-meta"><span title="${esc(utc(gone))}">Deleted in ${until(gone, now)}</span><form method="post" action="/assets/remove">${csrf(v)}<input type="hidden" name="id" value="${esc(f.attachment_id)}"><button type="submit" class="link-btn" aria-label="Remove ${esc(f.filename)}">Remove</button></form></div>
  </article>`;
}

function handoffRow(v: AssetsViewer, h: HandoffWithFiles, now: number, unread = false): Html {
  const files = fileChips(h);
  return `<article class="asset${unread ? " unread" : ""}">
    <span class="asset-icon">${HANDOFF_ICON}</span>
    <div>
      <a class="asset-name" href="${handoffHref(h.packet_id)}">${esc(h.title)}</a>
      <div class="asset-sub">${esc(direction(v.handle, h))} · ${fileCount(h.attachments.length)} · ${when(h.created_at, now)}</div>
      ${files ? `<div class="asset-files">${files}</div>` : ""}
      ${unread ? sayBox(`Continue the handoff from ${h.from}.`) : ""}
    </div>
    ${statusBlock(statusOf(v.handle, h, now), h.expires_at, now)}
  </article>`;
}

export type AssetsFilter = "all" | "sent" | "received";

/** What a new member's empty Assets shows: their next steps. */
export interface FirstDay {
  /** Names of the assistants connected with this member's account. */
  assistants: string[];
  /** The sentence that invites someone, for an admin; otherwise null. */
  invite: string | null;
  /** The sentence that sends a first handoff. */
  send: string;
}

export interface AssetsData {
  /** Empty on the pages of older handoffs. */
  unsent: UnsentFile[];
  /** Handoffs others sent the member that they have not opened yet. Empty on older pages and under Sent. */
  unseen: HandoffWithFiles[];
  handoffs: HandoffWithFiles[];
  filter: AssetsFilter;
  /** For "Show older handoffs". */
  nextCursor: string | null;
  /** This page continues from a cursor: older handoffs only. */
  older: boolean;
  uploadOpen: boolean;
  maxBytes: number;
  unsentTtlMs: number;
  flash: Flash;
  now: number;
  /** Set when the member has nothing here yet. */
  firstDay?: FirstDay;
}

const flashBox = (f: Flash): Html => (f ? `<div class="flash${f.ok ? " ok" : ""}" role="${f.ok ? "status" : "alert"}">${f.text}</div>` : "");

const FILTERS: Array<[AssetsFilter, string]> = [["all", "All"], ["received", "Received"], ["sent", "Sent"]];
const filterHref = (f: AssetsFilter): string => (f === "all" ? "/assets" : `/assets?show=${f}`);

function firstDayPanel(fd: FirstDay, control: boolean): Html {
  const done = `<span class="num done">${CHECK_ICON}</span>`;
  const steps: Html[] = [
    fd.assistants.length
      ? `<li>${done}<div><div class="step-t">Handoff is in your assistant</div><p class="step-sub">${esc(names(fd.assistants))} connected. <a class="u" href="/connect">Add another assistant</a></p></div></li>`
      : `<li><span class="num">1</span><div><div class="step-t">Add Handoff to your assistant</div><p class="step-sub">Claude, ChatGPT and others take a couple of minutes. <a class="u" href="/connect">Assistant setup</a></p></div></li>`,
  ];
  if (fd.invite) {
    steps.push(
      `<li><span class="num">${steps.length + 1}</span><div><div class="step-t">Invite your ${control ? "partner" : "teammate"}</div><p class="step-sub">Your assistant makes an invitation link to send them.</p>${sayBox(fd.invite)}</div></li>`,
    );
  }
  steps.push(
    `<li><span class="num">${steps.length + 1}</span><div><div class="step-t">Hand off</div><p class="step-sub">In any chat, when the next step is someone else's or another assistant's. A letter on paper? Scan it with your phone and upload it here first.</p>${sayBox(fd.send)}</div></li>`,
  );
  return `<section class="panel" aria-labelledby="first-h" style="padding:0;gap:0">
    <div class="first-head"><h2 id="first-h">Your first handoff</h2><p>Nothing here yet. Handoffs you send or receive show up here, with who picked them up.</p></div>
    <ol class="first-steps">${steps.join("")}</ol>
  </section>`;
}

export function assetsPage(v: AssetsViewer, d: AssetsData, nonce: string): Html {
  const shownNew = new Set(d.unseen.map((h) => h.packet_id));
  const rows = d.handoffs
    .filter((h) => !shownNew.has(h.packet_id))
    .map((h) => handoffRow(v, h, d.now))
    .join("");
  const ttlDays = plural(Math.max(1, Math.round(d.unsentTtlMs / 86_400_000)), "day");
  const ready = d.unsent.length
    ? `<section class="assets-sect" aria-labelledby="ready-h">
    <div class="sect-head"><h2 class="sect-h" id="ready-h">Ready to send</h2><span class="sect-note">Private to you until sent</span></div>
    <div class="assets-list">${d.unsent.map((f) => fileRow(v, f, d.now, d.unsentTtlMs)).join("")}</div>
  </section>`
    : "";
  const fresh = d.unseen.length
    ? `<section class="assets-sect" aria-labelledby="new-h">
    <div class="sect-head"><h2 class="sect-h" id="new-h">New for you</h2></div>
    <div class="assets-list">${d.unseen.map((h) => handoffRow(v, h, d.now, true)).join("")}</div>
  </section>`
    : "";
  const empty = d.older
    ? "No older handoffs."
    : d.filter === "sent"
      ? "You have not sent a handoff yet."
      : d.filter === "received"
        ? (shownNew.size ? "Nothing else received." : "Nothing received yet. Handoffs others send you show up here.")
        : "No other handoffs.";
  const seg = `<nav class="seg" aria-label="Show">${FILTERS.map(([f, label]) => `<a href="${filterHref(f)}"${f === d.filter ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
  const more =
    d.older || d.nextCursor
      ? `<div class="assets-more">${d.older ? `<a class="u" href="${filterHref(d.filter)}">Back to the newest</a>` : "<span></span>"}${d.nextCursor ? `<a class="u" href="${filterHref(d.filter)}${d.filter === "all" ? "?" : "&"}older=${encodeURIComponent(d.nextCursor)}">Show older handoffs</a>` : ""}</div>`
      : "";
  const list = d.firstDay
    ? firstDayPanel(d.firstDay, v.control)
    : `<section class="assets-sect" aria-labelledby="handoffs-h">
    <div class="sect-head"><h2 class="sect-h" id="handoffs-h">${d.older ? "Older handoffs" : "Handoffs"}</h2>${seg}</div>
    <div class="assets-list" aria-label="Handoffs">${rows || `<div class="assets-empty">${empty}</div>`}</div>
    ${more}
  </section>`;
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
    <p class="small muted">PDF, PNG, JPEG, text or Markdown, up to ${esc(bytes(d.maxBytes))}. Only you can see it until your assistant sends it in a handoff. A file not sent within ${ttlDays} is deleted.</p>
    <div class="assets-actions"><button type="submit" class="btn primary lg">Upload</button><a class="btn lg" href="/assets" data-cancel>Cancel</a></div>
  </form>
  ${ready}
  ${fresh}
  ${list}`,
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

/** One line of a handoff's timeline, from the viewer's side. */
function pickupLine(me: string, k: Pickup): string {
  const you = k.by === me;
  if (k.via === "browser") return you ? "You opened it in the browser" : `Opened by ${k.by} in the browser`;
  const app = k.client ? ` in ${k.client}` : "";
  return you ? `You picked it up${app}` : `Picked up by ${k.by}${app}`;
}

const DOT: Html = '<span class="pt done"></span>';

/** Sent, each pickup in time order, and (for the sender) the recipients still to pick it up. */
function timeline(me: string, h: PacketView, d: Delivery & { sent_via: string | null }, now: number): Html {
  const items = [
    `<li class="tl">${DOT}<span>Sent by ${h.from === me ? "you" : esc(h.from)}${d.sent_via ? ` from ${esc(d.sent_via)}` : ""}</span><span class="when">${when(h.created_at, now)}</span></li>`,
    ...d.pickups.map((k) =>
      k.via === "assistant"
        ? `<li class="tl ok"><span class="pt ok">${CHECK_ICON}</span><span>${esc(pickupLine(me, k))}</span><span class="when">${when(k.at, now)}</span></li>`
        : `<li class="tl">${DOT}<span>${esc(pickupLine(me, k))}</span><span class="when">${when(k.at, now)}</span></li>`,
    ),
    ...d.waiting.map((w) => `<li class="tl"><span class="pt wait"></span><span class="muted">Waiting for ${esc(w)}</span><span></span></li>`),
  ];
  return `<ol class="timeline">${items.join("")}</ol>`;
}

const revokeHref = (packetId: string): string => `${handoffHref(packetId)}/revoke`;

export function handoffPage(v: AssetsViewer, h: PacketView, d: Delivery & { sent_via: string | null }, brief: Html, files: FileCard[], now: number, nonce: string): Html {
  const count = files.length ? plural(files.length, "file") : "Brief only";
  const sender = h.from === v.handle;
  // The sender keeps the hint while a recipient has not picked it up in an assistant (opening it here is not that).
  const inAssistant = new Set(d.pickups.filter((k) => k.via === "assistant").map((k) => k.by));
  const notYet = d.waiting.length > 0 || d.pickups.some((k) => !inAssistant.has(k.by));
  const waitingSay = !sender || h.to === v.handle || notYet;
  return appPage(
    v,
    h.title,
    `<a class="back" href="/assets">${BACK_ICON}Assets</a>
  <header>
    <p class="eyebrow">${esc(direction(v.handle, h))} · ${count}</p>
    <h1>${esc(h.title)}</h1>
    <p class="lead">Sent ${when(h.created_at, now)} · ${expires(h.expires_at, now)}</p>
  </header>
  <section class="panel status-panel" aria-label="Status">
    <h2 class="t">Status</h2>
    ${timeline(v.handle, h, d, now)}
    ${sender ? `<div class="status-foot"><span>Revoking it means no one can open it again.</span><a class="btn sm danger" href="${revokeHref(h.packet_id)}">Revoke</a></div>` : ""}
  </section>
  <section class="panel brief" aria-label="Brief"><h2 class="t">Brief</h2><div class="md">${brief}</div></section>
  ${files.length ? `<h2 class="files-h">Files</h2>${files.map(fileCard).join("")}` : ""}
  ${waitingSay ? `<p class="say">${nextStep(v.handle, h)}</p>` : ""}`,
    nonce,
  );
}

/** Asks before revoking: a page of its own, as the console does for actions that cannot be undone. */
export function revokePage(v: AssetsViewer, h: PacketView, d: Delivery, nonce: string): Html {
  const got = unique(d.pickups.filter((k) => k.via === "assistant"));
  return appPage(
    v,
    `Revoke ${h.title}`,
    `<a class="back" href="${handoffHref(h.packet_id)}">${BACK_ICON}${esc(h.title)}</a>
  <header>
    <p class="eyebrow">${esc(direction(v.handle, h))}</p>
    <h1>Revoke “${esc(h.title)}”?</h1>
    <p class="lead">No one can open it again, in an assistant or here.${got.length ? ` ${esc(names(got))} already picked it up: what their assistant read stays in that chat.` : ""} This cannot be undone.</p>
  </header>
  <form method="post" action="${revokeHref(h.packet_id)}" class="assets-actions">${csrf(v)}<button type="submit" class="btn danger lg">Revoke</button><a class="btn lg" href="${handoffHref(h.packet_id)}">Cancel</a></form>`,
    nonce,
  );
}

export function filePage(v: AssetsViewer, f: UnsentFile, card: FileCard, now: number, unsentTtlMs: number, nonce: string): Html {
  const gone = new Date(Date.parse(f.uploaded_at) + unsentTtlMs).toISOString();
  return appPage(
    v,
    f.filename,
    `<a class="back" href="/assets">${BACK_ICON}Assets</a>
  <header>
    <p class="eyebrow">Ready to send · Only you</p>
    <h1>${esc(f.filename)}</h1>
    <p class="lead">Uploaded ${when(f.uploaded_at, now)} · <span title="${esc(utc(gone))}">Deleted in ${until(gone, now)} if not sent</span></p>
  </header>
  ${f.note ? `<p class="asset-note">${esc(f.note)}</p>` : ""}
  ${fileCard(card)}
  ${sayBox(`Hand this off with ${f.filename}.`, "To send it, tell your assistant")}
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

