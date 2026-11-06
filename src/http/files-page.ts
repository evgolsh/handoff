import { bytes, document, esc, flowHeader, when, type Html } from "../console/html";
import type { AttachmentDescriptor, PacketSummary, UnsentFile } from "../domain/service";
import { MAX_NOTE_CHARS } from "../domain/service";
import { BRAND_ICON } from "./style";
import { COPY_SCRIPT } from "./clipboard";

/**
 * The member file page (/files): a mailbox with a slot, not a drive. A member drops a file for their assistant
 * to send, and downloads the files of their handoffs. No folders, sharing settings or previews.
 */
const SITE = "Handoff";

const FILES_CSS = `
.files-top{max-width:960px;margin:auto;padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.files-top .brand{font-size:17px}
.files-top .who{display:flex;align-items:center;gap:12px;font-size:13px}
.files-top .who button{font:inherit;font-size:12px;background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer}
main.files{max-width:960px;margin:0 auto 64px;padding:0 24px;display:flex;flex-direction:column;gap:16px}
.files h1{font-size:26px;font-weight:500;letter-spacing:-.02em}
.files .lead{margin:4px 0 0;color:var(--muted)}
.drop{display:block;width:100%;box-sizing:border-box;padding:26px 16px;border:1px dashed var(--faint);border-radius:8px;background:var(--ground);color:var(--muted);font:inherit;cursor:pointer}
.drop:hover,.drop:focus{border-color:var(--accent);outline:none}
.upload{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:end}
.upload .drop{grid-column:1/-1}
.file-name{font-weight:500;overflow-wrap:anywhere}
.file-note{font-size:12px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}
.ref{font-family:var(--mono);font-size:11px;color:var(--muted);user-select:all;-webkit-user-select:all}
.acts{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.dl{display:inline-flex;align-items:center;gap:4px;margin:0 10px 4px 0;text-decoration:underline;text-decoration-color:var(--faint);overflow-wrap:anywhere}
.ask{font-size:12px;color:var(--muted)}
.ask q{color:var(--ink)}
@media(max-width:640px){.files-top,main.files{padding-left:16px;padding-right:16px}.upload{grid-template-columns:1fr}.hide-sm{display:none}
  table.stack thead{display:none}table.stack tr{display:block;padding:10px 14px;border-bottom:1px solid var(--line-soft)}table.stack td{display:block;border:0;padding:2px 0}table.stack .acts{justify-content:flex-start;margin-top:6px}}
`;

export interface FilesViewer {
  handle: string;
  tenant: string;
  csrf: string;
}

export type Flash = { text: Html; ok: boolean } | null;

const csrf = (v: FilesViewer): Html => `<input type="hidden" name="csrf" value="${esc(v.csrf)}">`;

/** The sign-in form. On the control center a member also names their team. */
export function filesLoginPage(opts: { control: boolean; error?: string; team?: string }): Html {
  return document(
    "Your files",
    `${flowHeader("/connect", "Assistant setup")}
<div class="flow-wrap"><div class="flow-grid">
  <section class="flow-intro"><span class="kicker">Your files</span><h1>Sign in to your files.</h1><p>Upload a file for your assistant to send, or download the files of your handoffs.</p><div class="flow-switch"><div><strong>Connecting an assistant?</strong><p class="flow-note">You don't need to sign in here.</p></div><a class="u" href="/connect">Setup guide →</a></div></section>
  <form method="post" action="/files/login" class="flow-panel" autocomplete="off">
    <div class="t">Member sign-in</div>
    ${opts.error ? `<div class="flash" role="alert">${esc(opts.error)}</div>` : ""}
    ${opts.control ? `<div><label class="lbl" for="team">Team name</label><input id="team" name="team" class="field" autofocus autocapitalize="none" spellcheck="false" placeholder="acme" value="${esc(opts.team ?? "")}"></div>` : ""}
    <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required${opts.control ? "" : " autofocus"} autocapitalize="none" spellcheck="false" placeholder="tom"></div>
    <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required></div>
    <button type="submit" class="btn primary">Sign in →</button>
    <div class="flow-note">Use the username and access code you use with your assistants.</div>
  </form>
</div></div>`,
    undefined,
    SITE,
  );
}

const typeLabel = (mime: string | null): string =>
  mime === "application/pdf" ? "PDF" : mime === "image/png" ? "PNG" : mime === "image/jpeg" ? "JPEG" : mime === "text/markdown" ? "Markdown" : mime === "text/plain" ? "Text" : "File";

function unsentTable(v: FilesViewer, files: UnsentFile[], now: number): Html {
  if (files.length === 0) {
    return `<div class="note small muted">Nothing waiting. Files you upload here stay until your assistant sends them in a handoff.</div>`;
  }
  const rows = files
    .map(
      (f) => `<tr>
      <td><div class="file-name">${esc(f.filename)}</div>${f.note ? `<div class="file-note">${esc(f.note)}</div>` : ""}<div class="ref" title="This file's reference">${esc(f.attachment_id)}</div></td>
      <td class="nowrap hide-sm">${esc(typeLabel(f.mime_type))}, ${esc(bytes(f.size))}</td>
      <td class="nowrap">${when(f.uploaded_at, now)}</td>
      <td><div class="acts">
        <button type="button" class="btn sm" data-copy="${esc(`${f.filename} (${f.attachment_id})`)}">Copy reference</button>
        <form method="post" action="/files/remove" class="inline">${csrf(v)}<input type="hidden" name="id" value="${esc(f.attachment_id)}"><button type="submit" class="btn sm danger">Remove</button></form>
      </div></td>
    </tr>`,
    )
    .join("");
  const example = files[0]!.filename;
  return `<div class="scroll"><table class="stack"><thead><tr><th>File</th><th class="hide-sm">Type and size</th><th>Uploaded</th><th class="r"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="note ask">Tell your assistant, for example: <q>Hand this off with ${esc(example)}.</q> It attaches the file by its name.</div>`;
}

function handoffsTable(handoffs: Array<PacketSummary & { attachments: AttachmentDescriptor[] }>, now: number): Html {
  if (handoffs.length === 0) return `<div class="note small muted">No handoffs yet. Handoffs you send or receive appear here until they expire.</div>`;
  const who = (to: string) => (to === "*" ? "team" : to);
  const rows = handoffs
    .map(
      (p) => `<tr>
      <td><div class="file-name">${esc(p.title)}</div><div class="file-note">${p.from === p.to ? `${esc(p.from)}, to self` : `${esc(p.from)} → ${esc(who(p.to))}`}</div></td>
      <td class="nowrap">${when(p.created_at, now)}</td>
      <td>${
        p.attachments.length
          ? p.attachments.map((a) => `<a class="dl" href="/files/download/${esc(p.packet_id)}/${esc(a.attachment_id)}" download>${esc(a.filename)}</a>`).join("")
          : `<span class="faint">No files</span>`
      }</td>
    </tr>`,
    )
    .join("");
  return `<div class="scroll"><table><thead><tr><th>Handoff</th><th>Sent</th><th>Files</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function filesPage(
  v: FilesViewer,
  data: { unsent: UnsentFile[]; handoffs: Array<PacketSummary & { attachments: AttachmentDescriptor[] }>; maxBytes: number; flash: Flash; now: number },
  nonce: string,
): Html {
  return document(
    "Your files",
    `<header class="files-top"><a class="brand" href="/files">${BRAND_ICON}<span>Handoff</span></a>
  <div class="who"><span>${v.tenant ? `<span class="muted">${esc(v.tenant)} ·</span> ` : ""}<strong>${esc(v.handle)}</strong></span><a class="small u" href="/connect">Assistant setup</a><form method="post" action="/files/logout" class="inline">${csrf(v)}<button type="submit">Sign out</button></form></div>
</header>
<main class="files">
  <div><h1>Your files</h1><p class="lead">Upload a file for your assistant to send. Download the files of your handoffs.</p></div>
  ${data.flash ? `<div class="flash${data.flash.ok ? " ok" : ""}" role="${data.flash.ok ? "status" : "alert"}">${data.flash.text}</div>` : ""}
  <section class="panel" aria-labelledby="up-title">
    <div class="t" id="up-title">Upload a file</div>
    <form method="post" action="/files/upload" enctype="multipart/form-data" class="upload">
      ${csrf(v)}
      <label class="sr-only" for="file">File</label>
      <input id="file" name="file" type="file" class="drop" required accept=".pdf,.png,.jpg,.jpeg,.txt,.md,application/pdf,image/png,image/jpeg,text/plain,text/markdown">
      <div><label class="lbl" for="note">Note for your assistant (optional)</label><input id="note" name="note" class="field" maxlength="${MAX_NOTE_CHARS}" placeholder="Signed lease, final version"></div>
      <button type="submit" class="btn primary">Upload</button>
    </form>
    <div class="small muted">PDF, PNG, JPEG, text or Markdown, up to ${esc(bytes(data.maxBytes))}. Only you can see a file until your assistant sends it in a handoff. Files not sent within 7 days are deleted.</div>
  </section>
  <section class="panel flush" aria-labelledby="unsent-title">
    <div class="t" id="unsent-title">Not sent yet</div>
    ${unsentTable(v, data.unsent, data.now)}
  </section>
  <section class="panel flush" aria-labelledby="handoffs-title">
    <div class="t" id="handoffs-title">Your handoffs</div>
    ${handoffsTable(data.handoffs, data.now)}
  </section>
  <span id="copy-status" class="sr-only" aria-live="polite"></span>
</main>`,
    { nonce, script: COPY_SCRIPT, style: FILES_CSS },
    SITE,
  );
}
