import { BASE_CSS, BRAND_ICON, FAVICON_LINK, FONT_PRELOAD } from "../http/style";

/**
 * The console's look: a sidebar, white panels with thin lines on a
 * grey-white ground, status dots, small bars. Server-rendered forms, with optional nonce scripts for setup and copying.
 */
export const CONSOLE_CSS = `
:root{--warn-bg:#fff7ef}
@media (prefers-color-scheme: dark){:root{--warn-bg:#2a2017}}
body{font-size:14px;line-height:1.45}
a{text-decoration:none}a:hover{color:var(--accent)}
a.u{text-decoration:underline;text-decoration-color:var(--faint)}
h1{margin:0;font-size:22px;font-weight:600}
table{border-collapse:collapse;width:100%}
th{font-weight:500;color:var(--muted);text-align:left;font-size:12px;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--line-soft);vertical-align:top}
tr:last-child td{border-bottom:0}
tr.group td{background:var(--ground);font-weight:500;padding:6px 10px;border-bottom:1px solid var(--line-soft)}
.r{text-align:right}
.mono{font-family:var(--mono);font-size:12px}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:12px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.danger{color:var(--danger)}
.nowrap{white-space:nowrap}
.chip{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 6px;color:var(--muted);white-space:nowrap}
.chip.ok{color:var(--ok);border-color:var(--ok)}
.chip.warn{color:var(--warn);border-color:var(--warn)}
.btn{font:inherit;font-size:13px;padding:7px 12px;border:1px solid var(--ink);border-radius:6px;background:var(--panel);color:var(--ink);cursor:pointer;display:inline-block;white-space:nowrap}
.btn:hover{color:var(--ink)}
.btn.sm{padding:4px 10px;font-size:12px}
.btn.primary{background:var(--ink);color:var(--ground)}
.btn.danger{border-color:var(--danger);color:var(--danger)}
.field{font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);width:100%}
label.lbl{font-size:12px;color:var(--muted);display:block;margin-bottom:4px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--faint);vertical-align:middle;flex:none}
.dot.live,.dot.ok{background:var(--ok)}.dot.idle{background:var(--faint)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--danger)}
.dot.never{background:transparent;border:2px solid var(--faint)}
.dot.stale{background:transparent;border:2px solid var(--warn)}

.shell{min-height:100vh;display:flex;flex-wrap:wrap}
nav.side{width:220px;flex:0 1 220px;background:var(--panel);border-right:1px solid var(--line);padding:20px 14px;display:flex;flex-direction:column;gap:4px}
nav.side a.brand{display:flex;padding:4px 8px 18px 8px}nav.side a.brand:hover{color:var(--ink)}
nav.side a{display:block;padding:9px 10px;border-radius:6px}
nav.side a.on{background:var(--ink);color:var(--ground);font-weight:500}
nav.side .sect{margin:14px 10px 4px 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
nav.side .grow{flex-grow:1}
nav.side .who{padding:10px;border-top:1px solid var(--line-soft);display:flex;flex-direction:column;gap:6px}
nav.side .who form{display:inline}
nav.side .who button{font:inherit;font-size:12px;background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;cursor:pointer}
main{flex:999 1 560px;min-width:0;padding:24px 28px;display:flex;flex-direction:column;gap:16px}
@media (max-width:760px){
  nav.side{flex:1 1 100%;width:auto;flex-direction:row;flex-wrap:wrap;align-items:center;border-right:0;border-bottom:1px solid var(--line);padding:12px 16px}
  nav.side a.brand{padding:4px 8px;width:100%}
  nav.side .sect,nav.side .grow{display:none}
  nav.side .who{border-top:0;padding:4px 8px;margin-left:auto}
  main{padding:16px}
}
.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px}
.grow{flex-grow:1}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}
.card .t{display:flex;align-items:center;gap:8px;font-weight:500}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.panel.flush{padding:0;gap:0}
.panel .t{font-weight:500}
.panel.flush>.t,.panel.flush>.note{padding:12px 14px}
.panel.flush>.note{border-top:1px solid var(--line-soft)}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px}
@media (max-width:900px){.grid2{grid-template-columns:1fr}}
.big{font-size:32px;font-weight:600;line-height:1}
.days{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:2px;align-items:end;height:56px;margin-top:6px}
.days i{display:block;background:var(--ink);border-radius:4px 4px 0 0;min-height:2px}
.days i.zero{background:var(--line-soft)}
.bar{height:8px;background:var(--line-soft);border-radius:2px}
.bar i{display:block;height:8px;background:var(--ink);border-radius:2px}
.split{display:flex;gap:2px;height:10px}
.split i{display:block;border-radius:2px}
.split i.a{background:var(--ok)}.split i.b{background:var(--danger)}
.scroll{overflow-x:auto}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted);align-items:center;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:6px}
.flash{background:var(--warn-bg);border:1px solid var(--warn);border-radius:8px;padding:10px 14px}
.flash.ok{background:var(--panel);border-color:var(--ok)}
.login{max-width:420px;margin:12vh auto;padding:0 16px;display:flex;flex-direction:column;gap:14px}
dl.kv{margin:0;display:grid;grid-template-columns:120px minmax(0,1fr);gap:4px 10px;font-size:12px}
dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;overflow-wrap:anywhere}
pre.code{margin:0;font-family:var(--mono);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ground);border:1px dashed var(--line);border-radius:6px;padding:10px}
.secret{font-family:var(--mono);font-size:20px;font-weight:500;letter-spacing:.02em;user-select:all;-webkit-user-select:all;background:var(--ground);border:1px dashed var(--ink);border-radius:6px;padding:12px 14px;overflow-wrap:anywhere}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.row>.field{width:auto;flex:1 1 180px}
form.inline{display:inline}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.flow-top{max-width:1120px;margin:auto;padding:24px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.flow-top .brand{font-size:19px}.flow-top .brand svg{width:26px;height:26px}
.flow-wrap{max-width:1000px;margin:5vh auto 64px;padding:0 28px}
.flow-progress{display:flex;gap:24px;list-style:none;padding:0 0 28px;margin:0;color:var(--muted);font-size:12px}
.flow-progress li{display:flex;gap:8px;align-items:center}.flow-progress span{width:24px;height:24px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;font:11px var(--mono)}
.flow-progress [aria-current=step]{color:var(--ink);font-weight:600}.flow-progress [aria-current=step] span{background:var(--ink);color:var(--ground);border-color:var(--ink)}
.flow-grid{display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:start}
.flow-intro h1{font-size:clamp(32px,4vw,46px);letter-spacing:-.045em;line-height:1.12;font-weight:500;margin:12px 0 20px}
.flow-intro>p{color:var(--muted);max-width:35ch;font-size:16px;line-height:1.6}
.flow-intro>p.flow-note{font-size:12px}
.kicker{font:11px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.flow-panel{padding:28px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:0 12px 32px #00000005;display:flex;flex-direction:column;gap:22px}
.flow-panel .field{min-height:46px;border-radius:8px}.flow-panel label.lbl{color:var(--ink);font-weight:500;font-size:13px;margin-bottom:8px}
.field-help{font-size:12px;color:var(--muted);margin:7px 0 0}.flow-panel .btn{min-height:46px;border-radius:8px;width:100%;text-align:center;font-weight:500}
.flow-panel .secret{font-size:19px;border-style:solid;border-color:var(--line);padding:16px;margin:8px 0}
.flow-note{font-size:12px;color:var(--muted);line-height:1.6}.flow-note a{text-decoration:underline;text-underline-offset:3px}
.flow-switch{border-top:1px solid var(--line);padding-top:18px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px}
.flow-facts{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}.flow-facts span{padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:12px;color:var(--muted)}
.credential-meta{display:grid;grid-template-columns:1fr 1fr;gap:20px}.credential-meta div{min-width:0}.credential-meta dt{color:var(--muted);font-size:12px;margin-bottom:6px}.credential-meta dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.flow-complete{display:flex;align-items:center;gap:8px;color:var(--ok);font-size:13px}
.team-welcome{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:30px 0 12px}
.team-welcome h1{font-size:34px;letter-spacing:-.04em;font-weight:500}.team-welcome p{margin:8px 0;color:var(--muted)}
.team-start{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.team-start>div{padding:32px}.team-start h2{font-size:25px;letter-spacing:-.025em;font-weight:500;margin:12px 0}.team-start p{color:var(--muted);max-width:48ch;line-height:1.6;margin-bottom:24px}.team-start .btn{padding:12px 18px;border-radius:8px}
.team-steps{border-left:1px solid var(--line);background:var(--ground);display:grid;gap:20px}.team-step{display:flex;gap:12px;align-items:start}.team-step>span{border:1px solid var(--line);border-radius:50%;width:26px;height:26px;display:grid;place-items:center;flex:none;font:11px var(--mono)}.team-step strong{font-size:13px;font-weight:500}.team-step p{font-size:12px;margin:4px 0 0}
.team-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.team-shortcuts a{display:flex;align-items:center;justify-content:space-between;padding:22px 24px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.team-shortcuts a:hover{border-color:var(--ink);color:var(--ink)}.team-shortcuts strong{display:block;font-weight:500}.team-shortcuts p{margin:5px 0 0;font-size:12px;color:var(--muted)}
.team-metrics{display:flex;flex-wrap:wrap;gap:28px;padding:8px 0;color:var(--muted);font-size:12px}.team-metrics strong{font-size:18px;color:var(--ink);margin-right:6px}
.team-limits{font-size:12px;color:var(--muted);padding:16px 0;border-top:1px solid var(--line)}
.team-management{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);gap:24px;align-items:start}
.people-list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.person-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 22px;border-bottom:1px solid var(--line-soft);min-width:0}.person-row:last-child{border-bottom:0}.person-row strong{font-weight:500}.person-row p{font-size:12px;color:var(--muted);margin:5px 0 0}.person-row>div{min-width:0;overflow-wrap:anywhere}
.person-actions{position:relative;flex:none}.person-actions summary{cursor:pointer;font-size:12px;padding:7px 10px;border:1px solid var(--line);border-radius:6px;list-style:none}.person-actions summary::-webkit-details-marker{display:none}.person-actions>div{position:absolute;right:0;top:calc(100% + 6px);min-width:150px;display:grid;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:8px;z-index:5;box-shadow:0 8px 24px #00000012}.person-actions a{padding:10px;font-size:12px;white-space:nowrap}
.empty-connections{padding:48px 28px;text-align:center;border:1px dashed var(--line);border-radius:14px}.empty-connections h2{font-size:25px;font-weight:500;letter-spacing:-.025em;margin:0 0 12px}.empty-connections p{color:var(--muted);margin:0 0 24px}.empty-connections .btn{padding:12px 18px}
.troubleshooting{margin-top:12px}.troubleshooting>summary{cursor:pointer;padding:12px 0;color:var(--muted);font-size:12px}.troubleshooting .grid2{margin-top:12px}
nav.side .nav-separator{height:1px;background:var(--line);margin:12px 8px}
@media(max-width:760px){.flow-wrap{margin-top:24px}.flow-grid{grid-template-columns:1fr;gap:24px}.flow-intro h1{margin-top:8px}.flow-intro>p{max-width:none}.flow-progress{gap:12px;flex-wrap:wrap}.flow-facts{margin:16px 0}.team-start{grid-template-columns:1fr}.team-steps{border-left:0;border-top:1px solid var(--line)}.team-shortcuts{grid-template-columns:1fr}.team-welcome{padding-top:8px}.team-welcome h1{font-size:28px}nav.side .nav-separator{display:none}}
@media(max-width:420px){.flow-top{padding:20px}.flow-wrap{padding:0 20px}.flow-panel{padding:22px}.flow-progress{gap:10px;font-size:11px}.flow-progress span{width:20px;height:20px}.flow-grid{gap:20px}.team-start>div{padding:24px}.credential-meta{gap:12px}}
@media(max-width:1000px){.team-management{grid-template-columns:1fr}}
@media(prefers-reduced-motion:no-preference){.btn,.field,.team-shortcuts a{transition:border-color .15s,background .15s,box-shadow .15s}}
`;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapes text for HTML content and attribute values. */
export const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/** A trusted HTML fragment. */
export type Html = string;

export const CONSOLE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  // Not no-referrer: with that policy a browser sends "Origin: null" on a form POST, and the console checks Origin.
  // same-origin sends nothing to other sites.
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

// ---- formatting ---------------------------------------------------------------------------------------------

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 90 * 60) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** "2026-10-26 14:03 UTC", for title attributes. */
export const utc = (iso: string | null | undefined): string => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "");

/** A relative time with the exact UTC time on hover. */
export const when = (iso: string | null | undefined, now: number): Html =>
  iso ? `<span title="${esc(utc(iso))}">${esc(ago(iso, now))}</span>` : `<span class="faint">never</span>`;

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(v < 10_000 ? 2 : 1)} s`;
}

export function bytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`;
}

export const num = (n: number): string => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many = `${one}s`): string => `${num(n)} ${n === 1 ? one : many}`;

export type Liveness = "live" | "idle" | "stale" | "never";
/** Seen within an hour, within 7 days, longer ago, or never. */
export function liveness(iso: string | null | undefined, now: number): Liveness {
  if (!iso) return "never";
  const age = now - Date.parse(iso);
  if (age < 3_600_000) return "live";
  if (age < 7 * 86_400_000) return "idle";
  return "stale";
}

export const LIVENESS_LEGEND: Html = `<div class="legend">
  <span><span class="dot live"></span>seen &lt; 1 h</span>
  <span><span class="dot idle"></span>seen &lt; 7 d</span>
  <span><span class="dot stale"></span>quiet &gt; 7 d</span>
  <span><span class="dot never"></span>never seen</span>
</div>`;

/** An outcome in words and colour: "ok" in green, anything else in red with its code. */
export const outcome = (o: string): Html => (o === "ok" ? `<span class="ok">ok</span>` : `<span class="danger">${esc(o)}</span>`);

// ---- layout -------------------------------------------------------------------------------------------------

export type Page = "overview" | "connect" | "members" | "assistants" | "ops" | "tenants";
const NAV: Array<[Page, string]> = [
  ["overview", "Overview"],
  ["connect", "Connect an assistant"],
  ["members", "Members"],
  ["assistants", "Assistants"],
  ["ops", "Ops"],
  ["tenants", "Tenants"],
];

export interface Viewer {
  /** The handle people see. */
  handle: string;
  /** The stored identity (`tenant/handle` on the control center). */
  identity: string;
  /** "" for the operator of this deployment (a private install's admins, or the control center's operator). */
  tenant: string;
  /** True on the control center. With tenant "", the viewer is its operator and gets Ops and Tenants. */
  control: boolean;
  csrf: string;
}

/** Which pages this viewer gets: Ops for the deployment's operator only; Tenants for the control center's operator. */
export const pagesFor = (v: Viewer): Page[] =>
  NAV.map(([p]) => p).filter((p) => (p === "ops" ? v.tenant === "" : p === "tenants" ? v.tenant === "" && v.control : true));

/** A hidden form field with the session's CSRF value. Every console form that changes something carries it. */
export const csrfField = (v: Viewer): Html => `<input type="hidden" name="csrf" value="${esc(v.csrf)}">`;

export const flowHeader = (link = "/console/login", label = "Sign in"): Html => `<header class="flow-top"><a class="brand" href="/">${BRAND_ICON}<span>Handoff</span></a><a class="small u" href="${esc(link)}">${esc(label)} ↗</a></header>`;
export const flowProgress = (step: number): Html => `<ol class="flow-progress" aria-label="Team setup">${["Create team", "Save sign-in", "Connect"].map((label, i) => `<li${step === i + 1 ? ' aria-current="step"' : ""}><span>${step > i + 1 ? "✓" : i + 1}</span>${label}</li>`).join("")}</ol>`;

export interface PageEnhancement { nonce: string; script: string; style?: string }

/** Only interactive setup/copy pages opt into a nonce script. Other console pages remain script-free. */
export const interactiveHeaders = (nonce: string): Record<string, string> => ({
  ...CONSOLE_HEADERS,
  "content-security-policy": `${CONSOLE_HEADERS["content-security-policy"]}; script-src 'nonce-${nonce}'`,
});

export function document(title: string, body: Html, enhancement?: PageEnhancement): Html {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Handoff console</title>
${FAVICON_LINK}
${FONT_PRELOAD}
<style>${BASE_CSS}${CONSOLE_CSS}${enhancement?.style ?? ""}</style>
</head>
<body>
${body}
${enhancement ? `<script nonce="${esc(enhancement.nonce)}">${enhancement.script}</script>` : ""}
</body>
</html>`;
}

export function shell(page: Page, v: Viewer, title: string, body: Html, enhancement?: PageEnhancement): Html {
  const allowed = new Set(pagesFor(v));
  const links = NAV.filter(([p]) => allowed.has(p))
    .map(([p, label]) => `<a href="/console/${p}"${p === page ? ' class="on" aria-current="page"' : ""}>${v.tenant && p === "overview" ? "Your team" : v.tenant && p === "assistants" ? "Connections" : label}</a>`)
    .join("\n    ");
  return document(
    v.control ? `${title} · ${v.tenant || "operator"}` : title,
    `<div class="shell">
  <nav class="side" aria-label="Console">
    <a class="brand" href="/console/overview">${BRAND_ICON}<span>Handoff</span></a>
    ${links}
    <div class="nav-separator"></div>
    <div class="grow"></div>
    <div class="who">
      <div><span class="dot live"></span> ${v.tenant ? `<span class="muted">${esc(v.tenant)} ·</span> ` : ""}<strong>${esc(v.handle)}</strong> <span class="chip">${v.tenant || !v.control ? "admin" : "operator"}</span></div>
      <div class="small muted"><form method="post" action="/console/logout">${csrfField(v)}<button type="submit">${v.control ? "Sign out / switch account" : "sign out"}</button></form></div>
    </div>
  </nav>
  <main>
${v.control ? `    <div class="small muted" style="margin-bottom:12px">${v.tenant ? `Team administration · <strong>${esc(v.tenant)}</strong>` : "Playground operator"}</div>\n` : ""}${body}
  </main>
</div>`, enhancement,
  );
}

export function loginPage(error?: string, opts: { needsSetup?: boolean; control?: boolean; team?: string; next?: "connect" | "overview" } = {}): Html {
  return document("Sign in", `${flowHeader(opts.control ? "/join" : "/connect", opts.control ? "Create a team" : "Assistant setup")}
<div class="flow-wrap"><div class="flow-grid">
  <section class="flow-intro"><span class="kicker">${opts.control ? "Team administration" : "Your Handoff server"}</span><h1>Sign in.</h1><p>Manage the members and the assistants connected to Handoff.</p><div class="flow-switch"><div><strong>Just connecting an assistant?</strong><p class="flow-note">You don't need to sign in here.</p></div><a class="u" href="/connect">Setup guide →</a></div></section>
  <form method="post" action="/console/login" class="flow-panel" autocomplete="off">
    <div class="t">${opts.control ? "Team admin sign-in" : "Admin sign-in"}</div>
    ${error ? `<div class="flash" role="alert">${esc(error)}</div>` : ""}
    <input type="hidden" name="next" value="${opts.next === "connect" ? "connect" : "overview"}">
    ${opts.control ? `<div><label class="lbl" for="team">Team name</label><input id="team" name="team" class="field" autofocus autocapitalize="none" spellcheck="false" placeholder="acme" value="${esc(opts.team ?? "")}"></div>` : ""}
    <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required${opts.control ? "" : " autofocus"} autocapitalize="none" spellcheck="false" placeholder="tim"></div>
    <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required></div>
    <button type="submit" class="btn primary">Sign in →</button>
    <div class="flow-note">Use the access code you saved when your account was created. Only ${opts.control ? "team admins" : "admins"} can enter.</div>
    ${opts.needsSetup ? `<div class="flow-note">Deployed this server? <a href="/console/setup">Complete the initial setup</a>.</div>` : ""}
  </form>
</div></div>`);
}

/** Setup codes shorter than this do not open /console/setup. */
export const SETUP_CODE_MIN = 12;

/**
 * The first-admin page. `ready`: HANDOFF_SETUP_CODE is set, so the form is shown; otherwise the page says how
 * to set it, or how to make an admin from a terminal.
 */
export function setupPage(ready: boolean, error?: string, opts: { tooShort?: boolean } = {}): Html {
  const why = opts.tooShort
    ? `the <span class="mono">HANDOFF_SETUP_CODE</span> secret is set but shorter than ${SETUP_CODE_MIN} characters, so it is not accepted`
    : "no setup code is set";
  const body = ready
    ? `<form method="post" action="/console/setup" class="panel" autocomplete="off">
    <div class="t">Set up this server</div>
    <div class="small muted">This server has no admin yet. Enter the setup code you chose when you deployed it (the <span class="mono">HANDOFF_SETUP_CODE</span> secret) and the username you want. You become a member and the console's admin, and get your access code on the next page. This page closes once an admin exists.</div>
    ${error ? `<div class="flash" role="alert">${esc(error)}</div>` : ""}
    <div><label class="lbl" for="setup_code">setup code</label><input id="setup_code" name="setup_code" type="password" class="field" required autofocus></div>
    <div><label class="lbl" for="handle">your username</label><input id="handle" name="handle" class="field" required autocapitalize="none" spellcheck="false" placeholder="for example: tim"></div>
    <div><button type="submit" class="btn primary">Create my admin account</button></div>
  </form>`
    : `<div class="panel">
    <div class="t">Set up this server</div>
    <div class="small">This server has no admin yet, and ${why}. Do one of these:</div>
    <div class="small"><strong>In the Cloudflare dashboard:</strong> open this Worker, then Settings, then Variables and Secrets. ${opts.tooShort ? "Replace" : "Add"} the secret named <span class="mono">HANDOFF_SETUP_CODE</span> with one of ${SETUP_CODE_MIN} characters or more, deploy, and reload this page.</div>
    <div class="small"><strong>From a copy of the repository:</strong> <span class="mono">npm run member:add -- &lt;you&gt;</span>, then <span class="mono">npm run admin -- &lt;you&gt;</span>, and sign in at <a class="u" href="/console/login">/console/login</a>.</div>
  </div>`;
  return document(
    "Set up",
    `<div class="login">
  <div class="brand" style="font-size:18px">${BRAND_ICON}<span>Handoff console</span></div>
  ${body}
  <div class="small muted"><a class="u" href="/connect">Connect page</a></div>
</div>`,
  );
}

/** After setup: the new admin's access code, shown once. */
export function setupDonePage(handle: string, code: string): Html {
  return document(
    "Set up",
    `<div class="login">
  <div class="brand" style="font-size:18px">${BRAND_ICON}<span>Handoff console</span></div>
  <div class="panel">
    <div class="t">You are this server's admin</div>
    <div class="small muted">access code for <strong>${esc(handle)}</strong></div>
    <div class="secret" aria-label="access code">${esc(code)}</div>
    <div class="small">Copy it now: this page will not show it again. Sign in to the console and to each of your assistants with username <span class="mono">${esc(handle)}</span> and this code. If you lose it, another admin can reset it, or run <span class="mono">npm run member:add -- ${esc(handle)}</span>.</div>
    <div class="small muted">The setup code no longer opens anything. You may delete the <span class="mono">HANDOFF_SETUP_CODE</span> secret.</div>
    <div><a class="btn primary" href="/console/members">Add your teammates</a></div>
  </div>
</div>`,
  );
}

/** A plain page for a refused request (bad origin, stale form). */
export function problemPage(title: string, text: string): Html {
  return document(
    title,
    `<div class="login"><div class="brand" style="font-size:18px">${BRAND_ICON}<span>Handoff console</span></div>
  <div class="panel"><div class="t">${esc(title)}</div><div class="small">${esc(text)}</div><div><a class="btn sm" href="/console">Back to the console</a></div></div></div>`,
  );
}
