import { CONTROL_CENTER_URL, type Config } from "../env";
import { BASE_CSS, BRAND_ICON, FAVICON_LINK, FONT_PRELOAD } from "./style";
import { DEPLOY_PATH, GITHUB_URL, PAGE_HEADER_CSS, pageFooter, pageHeader } from "./header";
import { CLAUDE_ICON, CLOUDFLARE_ICON, GITHUB_ICON, HERMES_MASK, OPENAI_ICON } from "./assistant-icons";

/**
 * The Connect page: how to add Handoff to each assistant. Steps are only those that the host documents or
 * that we tested; each host says which. There is no one-click install: every host asks the person to add
 * the server and to approve the sign-in.
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A step is plain text with `code` spans, optionally followed by a command to copy. */
interface Step {
  text: string;
  command?: string;
}

/**
 * tested: these steps worked with Handoff: sign-in and sending, with files. Revoking is not part of the test.
 * partial: some of it was tested (another route, or only the sign-in); the status says what.
 * docs: the host's own documentation, not yet tried with Handoff.
 */
type Level = "tested" | "partial" | "docs";
const LEGEND: Record<Level, string> = {
  tested: "Tested: sign-in and sending worked with Handoff.",
  partial: "Partly tested: the guide says which part.",
  docs: "From the assistant’s documentation.",
};

interface Host {
  id: string;
  name: string;
  level: Level;
  /** A few words for the tab and the badge. */
  tag: string;
  status: string;
  steps: Step[];
  /** A step people miss, in orange text. */
  warn?: string;
  note?: string;
  source: { label: string; url: string };
}

function hosts(url: string, control = false): Host[] {
  const signIn = control ? "your team, handle and access code" : "your handle and access code";
  const host = new URL(url).host;
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      level: "tested",
      tag: "Tested",
      status: "Tested with Handoff on macOS: sign-in, send, read and revoke.",
      steps: [
        { text: "In a terminal, add the server:", command: `claude mcp add --transport http --scope user handoff ${url}` },
        { text: "In Claude Code, type `/mcp`, select **handoff**, then select **Authenticate**." },
        { text: `Sign in with ${signIn} and approve access.` },
      ],
      source: { label: "Claude Code MCP docs", url: "https://code.claude.com/docs/en/mcp" },
    },
    {
      id: "hermes",
      name: "Hermes",
      level: "tested",
      tag: "Tested",
      status: "Tested with Handoff on macOS (Hermes Agent CLI and gateway): sign-in, files, send, read and revoke.",
      steps: [
        { text: "In a terminal, add the server with OAuth:", command: `hermes mcp add handoff --url ${url} --auth oauth` },
        { text: "Sign in and approve access:", command: "hermes mcp login handoff" },
        { text: "Start a new Hermes chat or run `/reload-mcp`, so it loads the Handoff tools." },
      ],
      note: "On a remote or headless gateway (such as Telegram), approve the sign-in from the Hermes dashboard under MCP Servers, or run the remote gateway OAuth flow.",
      source: { label: "Hermes Agent MCP docs", url: "https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp" },
    },
    {
      id: "claude",
      name: "Claude",
      level: "tested",
      tag: "Tested",
      status:
        "Claude on the web, in the desktop app and in Cowork. Add it once: the connector follows your Claude account to every computer. Tested with Handoff in the Claude desktop app on Windows: sign-in, send, and files once the server is an allowed domain (below).",
      steps: [
        { text: "Open [Customize > Connectors](https://claude.ai/customize/connectors)." },
        { text: "Select **+ Add**, then **Add custom connector**." },
        { text: "Name it Handoff, paste the server address, and select **Continue**." },
        { text: "Keep the recommended sign-in settings and select **Add**." },
        { text: `Select **Connect**, sign in with ${signIn}, and approve access.` },
      ],
      warn: `To attach files, add \`${host}\` to the allowed domains in Claude's Settings > Capabilities. Without it, uploads fail with a 403 error.`,
      note: "On a Team or Enterprise plan, an owner first adds the connector in Organization settings > Connectors. Free plans allow one custom connector.",
      source: { label: "Claude help: custom connectors", url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" },
    },
    {
      id: "codex",
      name: "Codex",
      level: "tested",
      tag: "Tested",
      status:
        "The Codex app: add Handoff once in ChatGPT (ChatGPT tab) and it appears in the Codex app on every computer. Tested with Handoff in the Codex app on macOS and Windows: sign-in, send, read and files. The commands below are for the Codex CLI and IDE extension.",
      steps: [
        { text: "In a terminal, add the server:", command: `codex mcp add handoff --url ${url}` },
        { text: `Sign in with ${signIn} and approve access:`, command: "codex mcp login handoff" },
        { text: "Start a new Codex chat, so it loads the Handoff tools." },
      ],
      source: { label: "Codex MCP docs", url: "https://learn.chatgpt.com/docs/extend/mcp" },
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      level: "tested",
      tag: "Tested",
      status: "Add it once: the connection follows your ChatGPT account to chatgpt.com and the Codex app, on every computer. Tested with Handoff on Windows: sign-in, send and files, used from the Codex app.",
      steps: [
        { text: "Open [ChatGPT Plugins](https://chatgpt.com/plugins)." },
        { text: "Select the plus button, then **Add custom MCP server**." },
        { text: "Name it Handoff, paste the server address as the **Server URL**, and choose OAuth for **Authentication**." },
        { text: "Read the warning, select **I understand and want to continue**, then **Create as a plugin**." },
        { text: `Open [your personal plugins](https://chatgpt.com/plugins?view=personal), open Handoff, and select the plus button to install it. Sign in with ${signIn} and approve access.` },
      ],
      note: "If you do not see Add custom MCP server, your plan or workspace does not allow custom servers.",
      source: { label: "OpenAI: connect an MCP server", url: "https://developers.openai.com/plugins/quickstart" },
    },
  ];
}

/** Renders `code`, **bold** and [label](https://url) in an escaped string. */
function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function copyButton(value: string, label: string, primary = false): string {
  return `<button type="button" class="btn${primary ? " primary" : ""}" data-copy="${esc(value)}" aria-label="${esc(label)}">Copy</button>`;
}

/** Each assistant's mark in its tab; Hermes's is a mask image in the CSS. Decorative: the name follows. */
const LOGOS: Record<string, string> = { "claude-code": CLAUDE_ICON, claude: CLAUDE_ICON, codex: OPENAI_ICON, chatgpt: OPENAI_ICON };
const tabLogo = (h: Host): string => `<span class="tab-logo ${h.id}" aria-hidden="true">${LOGOS[h.id] ?? ""}</span>`;

/** Filled: tested. Half: partly tested. Hollow: from the docs. The shape, not only the colour, tells them apart. */
const dot = (level: Level): string => `<span class="dot ${level}" aria-hidden="true"></span>`;

/** Prefer URL boundaries over mid-word wrapping, without adding characters to copied text. */
function showAddress(url: string): string {
  const parts = /^(https?:\/\/)([^/]+)(.*)$/.exec(url);
  if (!parts) return esc(url);
  return `${esc(parts[1]!)}<wbr>${esc(parts[2]!).replace(/\./g, ".<wbr>")}<wbr>${esc(parts[3]!)}`;
}

function showCommand(cmd: string, url: string): string {
  return esc(cmd).split(esc(url)).join(showAddress(url));
}

function hostPanel(h: Host, first: boolean, url: string): string {
  const steps = h.steps
    .map(
      (s) =>
        `<li><p>${inline(s.text)}</p>${s.command ? `<div class="cmd"><code>${showCommand(s.command, url)}</code>${copyButton(s.command, `Copy the ${h.name} command`)}</div>` : ""}</li>`,
    )
    .join("\n        ");
  return `<section class="panel host" id="panel-${h.id}" role="tabpanel" aria-labelledby="tab-${h.id}" tabindex="0"${first ? "" : " data-later"}>
      <div class="host-head"><h3 class="host-name">${esc(h.name)}</h3><span class="badge">${dot(h.level)}${esc(h.tag)}</span></div>
      <p class="status">${esc(h.status)}</p>
      <ol class="steps">
        ${steps}
      </ol>
      <div class="foot">
        ${h.warn ? `<p class="warn">${inline(h.warn)}</p>` : ""}
        ${h.note ? `<p>${inline(h.note)}</p>` : ""}
        <p>Source: <a href="${esc(h.source.url)}" target="_blank" rel="noopener">${esc(h.source.label)}</a></p>
      </div>
    </section>`;
}

const PAGE_CSS = `
  p,h1,h2,h3,ol { margin:0; }
  .connect-hero { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); align-items:center; gap:clamp(40px,5vw,80px); padding-block:clamp(36px,3.5vw,56px); }
  h1 { font-size:clamp(40px,4.4vw,66px); font-weight:500; line-height:1.04; letter-spacing:-.055em; margin:16px 0 18px; text-wrap:balance; }
  h1 span { color:var(--muted); }
  .lead { max-width:46ch; color:var(--muted); font-size:clamp(16px,1.3vw,19px); line-height:1.55; }
  .guide-link { display:inline-flex; align-items:center; gap:12px; margin-top:24px; padding-block:10px; font-size:14px; font-weight:500; text-decoration:none; }
  .guide-link span { color:var(--muted); }
  .setup-notice { max-width:46ch; margin-top:20px; padding:12px 16px; border:1px solid var(--warn); border-radius:6px; font-size:14px; }
  .setup-notice a { font-weight:500; }

  .server-card { min-width:0; padding:20px 22px 22px; border:1px solid var(--line); border-radius:12px; background:var(--line-soft); }
  .card-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; font:10px var(--mono); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
  .card-mark { display:flex; align-items:center; gap:8px; }
  .card-mark svg { width:20px; height:20px; }
  .addr { padding:18px 20px; background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:0 12px 28px #00000006; }
  .addr-label { margin-bottom:8px; font-size:12px; color:var(--muted); }
  .addr-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px 16px; }
  .addr-row code { min-width:0; max-width:100%; font:500 16px/1.5 var(--mono); overflow-wrap:anywhere; }
  .overview { list-style:none; padding:6px 2px 0; }
  .overview li { display:grid; grid-template-columns:26px minmax(0,1fr); column-gap:12px; padding:12px 0; border-bottom:1px solid var(--line); }
  .overview li:last-child { padding-bottom:0; border-bottom:0; }
  .num { display:grid; place-items:center; width:26px; height:26px; border:1px solid var(--line); border-radius:50%; background:var(--panel); font:500 10px var(--mono); color:var(--muted); }
  .overview strong { display:block; padding-top:3px; font-size:14px; font-weight:500; line-height:1.45; }
  .overview p { font-size:13px; color:var(--muted); }

  .section { padding-block:56px; border-top:1px solid var(--line); }
  .section-head { display:flex; justify-content:space-between; align-items:end; gap:24px; margin-bottom:28px; }
  .section-head h2,.privacy h2 { font-size:clamp(28px,2.6vw,38px); font-weight:500; line-height:1.15; letter-spacing:-.04em; margin-top:10px; text-wrap:balance; }
  .section-head > p { max-width:36ch; font-size:14px; color:var(--muted); }
  .split { display:grid; grid-template-columns:260px minmax(0,1fr); gap:clamp(24px,3vw,48px); align-items:start; }

  .rail { position:sticky; top:24px; display:grid; gap:20px; }
  .tabs { display:grid; gap:4px; }
  .tabs[hidden] { display:none; }
  [role=tab] { display:grid; grid-template-columns:18px minmax(0,1fr) 8px auto; align-items:center; gap:10px; width:100%; min-height:46px; padding:10px 14px; border:1px solid transparent; border-radius:6px; background:none; color:var(--muted); font:500 14px/1.3 var(--sans); text-align:left; cursor:pointer; }
  [role=tab]:hover { color:var(--ink); background:var(--line-soft); }
  [role=tab][aria-selected=true] { color:var(--ink); background:var(--panel); border-color:var(--line); }
  .tab-state { font:10px var(--mono); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
  [role=tab] .dot { margin-right:-4px; }
  .tab-logo { display:grid; place-items:center; width:18px; height:18px; }
  .tab-logo svg { width:17px; height:17px; }
  .tab-logo.hermes { background:currentColor; -webkit-mask:url("${HERMES_MASK}") center/contain no-repeat; mask:url("${HERMES_MASK}") center/contain no-repeat; }
  .rail-note { padding:16px 15px 0; border-top:1px solid var(--line); font-size:12px; color:var(--muted); }
  .rail-note p + p { margin-top:8px; }
  .legend { display:grid; grid-template-columns:8px minmax(0,1fr); gap:12px; align-items:start; }
  .legend .dot { margin-top:5px; }

  .dot { display:inline-block; flex:none; width:8px; height:8px; border-radius:50%; }
  .dot.tested { background:var(--ok); }
  .dot.partial { border:1.5px solid var(--ok); background:linear-gradient(90deg,var(--ok) 50%,transparent 50%); }
  .dot.docs { border:1.5px solid var(--muted); }

  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
  .host { padding:28px 32px 24px; }
  html:not(.js) .host + .host { margin-top:16px; }
  .js .host[hidden],.js:not(.ready) .host[data-later] { display:none; }
  .host-head { display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap; }
  .host-name { font-size:24px; font-weight:500; letter-spacing:-.03em; }
  .badge { display:inline-flex; align-items:center; gap:8px; padding:5px 11px; border:1px solid var(--line); border-radius:999px; font:10px/1.4 var(--mono); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
  .status { max-width:78ch; margin-top:10px; padding-bottom:18px; font-size:13px; color:var(--muted); }
  .steps { list-style:none; counter-reset:step; padding:6px 0 4px; border-top:1px solid var(--line-soft); }
  .steps li { counter-increment:step; display:grid; grid-template-columns:24px minmax(0,1fr); column-gap:14px; padding:12px 0; }
  .steps li::before { content:counter(step); grid-row:1/span 2; width:24px; height:24px; border:1px solid var(--line); border-radius:50%; font:500 11px/22px var(--mono); text-align:center; color:var(--muted); }
  .steps li > * { grid-column:2; }
  .steps p { font-size:14px; line-height:1.55; padding-top:2px; }
  .steps p code,.foot code { font:.9em var(--mono); background:var(--ground); border:1px solid var(--line-soft); border-radius:4px; padding:1px 5px; overflow-wrap:anywhere; }
  .cmd { display:flex; align-items:stretch; margin-top:10px; border:1px solid var(--line); border-radius:6px; background:var(--ground); overflow:hidden; }
  .cmd code { flex:1; min-width:0; padding:10px 14px; font:12.5px/1.6 var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; align-self:center; }
  .cmd .btn { min-height:0; border:0; border-left:1px solid var(--line); border-radius:0; }
  .foot .warn { color:var(--warn); }
  .cmd .btn:focus-visible { outline-offset:-3px; }
  .foot { padding-top:16px; border-top:1px solid var(--line-soft); font-size:12px; color:var(--muted); }
  .foot p + p { margin-top:6px; }

  .btn { flex:none; min-width:72px; min-height:40px; padding:9px 14px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); font:500 13px/1.2 var(--sans); cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.primary { background:var(--ink); border-color:var(--ink); color:var(--ground); }
  .btn.primary:hover { background:var(--accent); border-color:var(--accent); color:var(--ground); }
  .btn.done,.btn.done:hover { background:var(--ok); border-color:var(--ok); color:var(--panel); }

  .say { list-style:none; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  .say li { padding:26px 30px; }
  .say-quote { margin:10px 0; font-size:24px; font-weight:500; letter-spacing:-.025em; }
  .say-text { max-width:58ch; font-size:14px; color:var(--muted); }
  .privacy { padding-bottom:72px; }
  .kv { display:grid; grid-template-columns:96px minmax(0,1fr); margin:0; border-top:1px solid var(--line); }
  .kv dt,.kv dd { margin:0; padding:14px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .kv dd { padding-left:24px; }
  .kv dt { color:var(--muted); }

  .inactive-gate { padding-block:clamp(40px,5vw,72px); }
  .gate-cards { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:32px; }
  .gate-card { padding:30px 32px; display:flex; flex-direction:column; align-items:flex-start; gap:12px; }
  .gate-card h2 { font-size:24px; font-weight:500; letter-spacing:-.025em; }
  .gate-card p:not(.eyebrow) { font-size:14px; color:var(--muted); line-height:1.55; margin-bottom:8px; max-width:48ch; }
  .gate-card code { font:.9em var(--mono); background:var(--ground); border:1px solid var(--line-soft); border-radius:4px; padding:1px 5px; }
  .gate-actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px 18px; }
  .text-link { font-size:14px; font-weight:500; text-decoration:none; display:inline-flex; gap:8px; align-items:center; padding-block:10px; }
  .text-link svg { width:16px; height:16px; flex:none; }

  @media(max-width:1100px) {
    .split { grid-template-columns:220px minmax(0,1fr); }
    .host { padding:24px; }
  }
  @media(max-width:900px) {
    .connect-hero { grid-template-columns:1fr; gap:28px; }
  }
  @media(max-width:760px) {
    .split { display:flex; flex-direction:column; gap:16px; }
    .split > *,.tabs,.rail-note { width:100%; }
    .rail { display:contents; }
    .tabs { grid-template-columns:1fr 1fr; padding:4px; border-radius:8px; background:var(--line-soft); }
    [role=tab] { grid-template-columns:18px auto 8px; justify-content:center; min-height:44px; padding:8px 10px; font-size:13px; }
    [role=tab]:last-child { grid-column:1/-1; }
    .tab-state { display:none; }
    [role=tab] .dot { margin-right:0; }
    .panels { order:1; }
    .rail-note { order:2; padding:0 4px; border-top:0; }
    .legend .dot { margin-top:6px; }
    .section-head { flex-direction:column; align-items:flex-start; gap:10px; }
    .say,.gate-cards { grid-template-columns:1fr; gap:16px; }
  }
  @media(max-width:600px) {
    .server-card { padding:14px; }
    .addr { padding:14px; }
    .addr-row code { font-size:14px; }
    .section { padding-block:40px; }
    .host { padding:20px; }
    .host-name { font-size:21px; }
    .steps li { column-gap:10px; }
    .steps li > .cmd { grid-column:1/-1; }
    .cmd { flex-direction:column; }
    .cmd .btn { min-height:40px; border-left:0; border-top:1px solid var(--line); }
    .say li { padding:22px; }
    .say-quote { font-size:21px; }
    .privacy { padding-bottom:48px; }
    .kv { grid-template-columns:72px minmax(0,1fr); }
    .kv dd { padding-left:16px; }
  }
  @media(max-width:420px) { .addr-row { grid-template-columns:1fr; } .addr-row code { font-size:13px; } .addr-row .btn { width:100%; } .card-top > span + span { display:none; } }
  @media(prefers-reduced-motion:no-preference) { .btn,[role=tab] { transition:background-color .15s,border-color .15s,color .15s; } }`;

export function connectPage(cfg: Config, nonce: string, opts: { needsSetup?: boolean } = {}): string {
  const active = !opts.needsSetup;
  const url = cfg.mcpResource;
  const shownUrl = showAddress(url);
  const control = cfg.mode === "control";
  const list = hosts(url, control);
  const tabs = list
    .map(
      (h, i) =>
        `<button type="button" role="tab" id="tab-${h.id}" aria-controls="panel-${h.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${tabLogo(h)}<span class="tab-name">${esc(h.name)}</span>${dot(h.level)}<span class="tab-state">${esc(h.tag)}</span></button>`,
    )
    .join("");
  const mainBody = opts.needsSetup
    ? `<section class="inactive-gate" aria-labelledby="connect-title">
    <div>
      <p class="eyebrow">Server setup required</p>
      <h1 id="connect-title">Finish setup first.<br><span>Or deploy your own.</span></h1>
      <p class="lead">Assistants can connect once this Handoff server has an admin who can issue member handles and access codes.</p>
    </div>
    <div class="gate-cards">
      <article class="panel gate-card">
        <p class="eyebrow">01 · Operator of this server</p>
        <h2>Set up this instance</h2>
        <p>If you deployed this server, enter your <code>HANDOFF_SETUP_CODE</code> secret to create the first admin. Then this page shows how to connect each assistant.</p>
        <a class="site-button primary" href="/console/setup">Set up this server <span aria-hidden="true">↗</span></a>
      </article>
      <article class="panel gate-card">
        <p class="eyebrow">02 · Run your own copy</p>
        <h2>Deploy to Cloudflare</h2>
        <p>Run your own private Handoff server (Workers, D1, R2, and built-in OAuth 2.1) on your Cloudflare account.</p>
        <div class="gate-actions">
          <a class="site-button" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy to Cloudflare</span> <span aria-hidden="true">↗</span></a>
          <a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    </div>
  </section>`
    : `<section class="connect-hero" aria-labelledby="connect-title">
    <div>
      <p class="eyebrow">Setup</p>
      <h1 id="connect-title">Connect once.<br><span>Keep going.</span></h1>
      <p class="lead">Add Handoff to the assistants you use and sign in with the same handle in each. Your next chat can pick up the brief and files you sent.</p>
      <a class="guide-link" href="#assistants">Find your setup guide <span aria-hidden="true">↓</span></a>
    </div>
    <aside class="server-card" aria-labelledby="addr-label">
      <div class="card-top"><span class="card-mark">${BRAND_ICON}Your Handoff server</span><span>MCP · OAuth sign-in</span></div>
      <div class="addr">
        <p class="addr-label" id="addr-label">Server address, the same in every assistant</p>
        <div class="addr-row"><code>${shownUrl}</code>${copyButton(url, "Copy the server address", true)}</div>
      </div>
      <ol class="overview" aria-label="Setup overview">
        <li><span class="num" aria-hidden="true">01</span><div><strong>Get your ${control ? "team, " : ""}handle and access code</strong><p>${control ? `<a href="/join">Create a team</a> and you get them at once; a teammate gets theirs from the team's admin in the <a href="/console">console</a>.` : `The person who runs this server adds members in the <a href="/console">console</a>.`}</p></div></li>
        <li><span class="num" aria-hidden="true">02</span><div><strong>Add this address to your assistant</strong><p>Choose your assistant below for its exact steps.</p></div></li>
        <li><span class="num" aria-hidden="true">03</span><div><strong>Sign in and approve access</strong><p>Then say “Hand this off” in any chat.</p></div></li>
      </ol>
    </aside>
  </section>

  <section class="section setup" id="assistants" aria-labelledby="assistant-title">
    <div class="section-head"><div><p class="eyebrow">Step by step</p><h2 id="assistant-title">Choose your assistant</h2></div></div>
    <div class="split">
      <div class="rail">
        <div class="tabs" role="tablist" aria-label="Assistant" aria-orientation="vertical" hidden>${tabs}</div>
        <div class="rail-note">
          ${(["tested", "partial", "docs"] as const)
            .filter((l) => list.some((h) => h.level === l))
            .map((l) => `<p class="legend">${dot(l)}${LEGEND[l]}</p>`)
            .join("\n          ")}
        </div>
      </div>
      <div class="panels">
    ${list.map((h, i) => hostPanel(h, i === 0, url)).join("\n    ")}
      </div>
    </div>
  </section>

  <section class="section next" aria-labelledby="next-title">
    <div class="section-head"><div><p class="eyebrow">Your first handoff</p><h2 id="next-title">Send in one chat, continue in another.</h2></div></div>
    <ol class="say">
      <li class="panel"><p class="eyebrow">01 · Send from any chat</p><p class="say-quote">“Hand this off to tom”</p><p class="say-text">Use your teammate’s handle, say “to the team” for everyone, or leave the recipient out to send to yourself. Your assistant prepares the brief, attaches the files you name, and gives you a packet ID.</p></li>
      <li class="panel"><p class="eyebrow">02 · Pick up in another</p><p class="say-quote">“Continue my handoff”</p><p class="say-text">The recipient asks their assistant to open the inbox, read the brief and original files, and take the next step. <a ${control ? 'href="/#use-cases"' : `href="${CONTROL_CENTER_URL}/#use-cases" target="_blank" rel="noopener"`}>Explore the use cases <span aria-hidden="true">↗</span></a></p></li>
    </ol>
  </section>

  <section class="section privacy split" aria-labelledby="privacy-title">
    <div><p class="eyebrow">Privacy</p><h2 id="privacy-title">What Handoff keeps</h2></div>
    <dl class="kv">
      <dt>Content</dt><dd>Only what you send: the brief and the files you attach.</dd>
      <dt>Files</dt><dd>PDF, PNG, JPEG, text and Markdown, up to ${cfg.maxAttachmentBytes / 1048576} MiB each; ${cfg.maxAttachmentsPerPacket} files per handoff.</dd>
      <dt>Access</dt><dd>Your handoffs are visible to you and their recipient. A team handoff is visible to every current member, including people added later. A file download link that an assistant gets works for anyone who has it, for 10 minutes.</dd>
      <dt>Expiry</dt><dd>${cfg.defaultExpiryHours / 24} days by default. The sender or named recipient can revoke a handoff. Only the sender can revoke a team handoff.</dd>
      <dt>Reading</dt><dd>Reading a packet does not change it, so you can open it in more than one assistant.</dd>
    </dl>
  </section>
  <p id="copy-status" class="sr-only" role="status"></p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Handoff</title>
<meta name="description" content="Add Handoff to Claude, Codex and ChatGPT, then move work between them.">
<script nonce="${nonce}">document.documentElement.classList.add("js");</script>
${FAVICON_LINK}
${FONT_PRELOAD}
<style>
  ${BASE_CSS}
  ${PAGE_HEADER_CSS}
${PAGE_CSS}
</style>
</head>
<body>
${pageHeader("connect", { active, mode: cfg.mode })}
<main id="main" class="site-width">
  ${mainBody}
</main>
${pageFooter({ active, mode: cfg.mode })}
<script nonce="${nonce}">
(function () {
  var list = document.querySelector("[role=tablist]");
  if (!list) return;
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[role=tab]"));
  var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
  function select(i, focus, updateHash) {
    tabs.forEach(function (t, j) {
      var on = i === j;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[j].hidden = !on;
    });
    if (focus) tabs[i].focus();
    if (updateHash !== false) {
      try { history.replaceState(null, "", "#" + tabs[i].id.slice(4)); } catch (e) {}
    }
  }
  function hashIndex() {
    return tabs.findIndex(function (t) { return "#" + t.id.slice(4) === location.hash; });
  }
  function syncHash() {
    var i = hashIndex();
    if (i >= 0) select(i, false, false);
  }
  list.hidden = false;
  select(Math.max(0, hashIndex()), false, false);
  window.addEventListener("hashchange", syncHash);
  var mobile = window.matchMedia("(max-width: 760px)");
  function syncOrientation() {
    list.setAttribute("aria-orientation", mobile.matches ? "horizontal" : "vertical");
  }
  syncOrientation();
  mobile.addEventListener("change", syncOrientation);
  document.documentElement.classList.add("ready");
  var next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { select(i, false); });
    t.addEventListener("keydown", function (e) {
      var k = e.key, n = tabs.length;
      if (k in next || k === "Home" || k === "End") {
        e.preventDefault();
        select(k === "Home" ? 0 : k === "End" ? n - 1 : (i + next[k] + n) % n, true);
      }
    });
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button[data-copy]");
    if (!b) return;
    var value = b.getAttribute("data-copy");
    function done(ok) {
      b.textContent = ok ? "Copied" : "Select and copy";
      b.classList.toggle("done", ok);
      document.getElementById("copy-status").textContent = ok ? b.getAttribute("aria-label").replace(/^Copy /, "") + " copied." : "Select the text and copy it manually.";
      setTimeout(function () { b.textContent = "Copy"; b.classList.remove("done"); }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  });
})();
</script>
</body>
</html>`;
}

export function connectHeaders(nonce: string): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=300",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}
