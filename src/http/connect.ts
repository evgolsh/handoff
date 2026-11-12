import { shell, type Viewer } from "../console/html";
import { CONTROL_CENTER_URL, type Config } from "../env";
import { BASE_CSS, FAVICON_LINK, FONT_PRELOAD, REG_TICKS } from "./style";
import { INSTALL_URL, GITHUB_URL, PAGE_HEADER_CSS, pageFooter, pageHeader } from "./header";
import { CLAUDE_ICON, GITHUB_ICON, HERMES_MASK, OPENAI_ICON } from "./assistant-icons";
import { claudeInstallLink, discoveryHead, socialMeta } from "./meta";

/**
 * The Connect page: how to add Threadpacket to each assistant, framed in the Courier Hybrid stage.
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface Step {
  text: string;
  command?: string;
}

export type Level = "tested" | "partial" | "docs";
const LEGEND: Record<Level, string> = {
  tested: "Tested: sign-in and sending worked with Threadpacket.",
  partial: "Partly tested: the guide says which part.",
  docs: "From the assistant’s documentation.",
};

export interface Host {
  id: string;
  name: string;
  level: Level;
  tag: string;
  status: string;
  intro?: string;
  steps: Step[];
  warn?: string;
  note?: string;
  source: { label: string; url: string };
}

/** Each assistant's setup steps. Rendered as Markdown for agents in src/http/agents.ts. */
const HOSTED_ORDER = ["claude", "chatgpt", "claude-code", "codex", "hermes"];

export function hosts(url: string, control = false): Host[] {
  const signIn = control ? "your username and access code, or choose **Create a team** if you're new," : "your username and access code";
  const host = new URL(url).host;
  const list: Host[] = [
    {
      id: "claude-code",
      name: "Claude Code",
      level: "tested",
      tag: "Tested",
      status: "Tested with Threadpacket on macOS: sign-in, send, read and revoke.",
      steps: [
        { text: "Add the MCP server:", command: `claude mcp add --transport http --scope user threadpacket ${url}` },
        { text: "In Claude Code, run `/mcp`, choose **threadpacket**, and select **Authenticate**." },
        { text: `Sign in with ${signIn} and approve access.` },
      ],
      source: { label: "Claude Code MCP docs", url: "https://code.claude.com/docs/en/mcp" },
    },
    {
      id: "hermes",
      name: "Hermes",
      level: "tested",
      tag: "Tested",
      status: "Tested with Threadpacket on macOS (Hermes Agent CLI and gateway): sign-in, files, send, read and revoke.",
      steps: [
        { text: "Add the server with OAuth:", command: `hermes mcp add threadpacket --url ${url} --auth oauth` },
        { text: "Sign in and approve access:", command: "hermes mcp login threadpacket" },
        { text: "Start a new chat or run `/reload-mcp`." },
      ],
      note: "On a headless gateway (such as Telegram), approve sign-in from the Hermes dashboard under MCP Servers.",
      source: { label: "Hermes Agent MCP docs", url: "https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp" },
    },
    {
      id: "claude",
      name: "Claude",
      level: "tested",
      tag: "Tested",
      status:
        "Claude on the web, in the desktop app and in Cowork. Add it once: the connector follows your Claude account to every computer. Tested with Threadpacket in the Claude desktop app on Windows: sign-in, send, and files once the server is an allowed domain (below).",
      steps: [
        { text: `Open [Add Threadpacket to Claude](${claudeInstallLink(url)}), or go to [Customize > Connectors](https://claude.ai/customize/connectors) and select **+ Add** > **Add custom connector**.` },
        { text: "Confirm the name **Threadpacket** and the server address above, then select **Continue** and **Add**." },
        { text: `Select **Connect**, sign in with ${signIn} and approve access.` },
      ],
      warn: `To attach files, add \`${host}\` to the allowed domains in Claude's Settings > Capabilities.`,
      note: "On Team or Enterprise plans, an owner adds the connector first in Organization settings > Connectors.",
      source: { label: "Claude help: custom connectors", url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" },
    },
    {
      id: "codex",
      name: "Codex",
      intro: "Using the Codex desktop app? Add Threadpacket once under **ChatGPT** and it syncs automatically. Below is for the Codex CLI.",
      level: "tested",
      tag: "Tested",
      status:
        "The Codex app: add Threadpacket once in ChatGPT (ChatGPT tab) and it appears in the Codex app on every computer. Tested with Threadpacket in the Codex app on macOS and Windows: sign-in, send, read and files. The commands below are for the Codex CLI and IDE extension.",
      steps: [
        { text: "Add the server:", command: `codex mcp add threadpacket --url ${url}` },
        { text: `Sign in with ${signIn} and approve access:`, command: "codex mcp login threadpacket" },
        { text: "Start a new Codex session." },
      ],
      source: { label: "Codex MCP docs", url: "https://learn.chatgpt.com/docs/extend/mcp" },
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      level: "tested",
      tag: "Tested",
      status: "Add it once: the connection follows your ChatGPT account to chatgpt.com and the Codex app, on every computer. Tested with Threadpacket on Windows: sign-in, send and files, used from the Codex app.",
      steps: [
        { text: "Open [ChatGPT Plugins](https://chatgpt.com/plugins), click **+**, and select **Add custom MCP server**." },
        { text: "Name it **Threadpacket**, paste the server address above, choose **OAuth**, and select **Create as a plugin**." },
        { text: `Open [personal plugins](https://chatgpt.com/plugins?view=personal), install Threadpacket, then sign in with ${signIn} and approve access.` },
      ],
      note: "Custom MCP servers require a ChatGPT plan or workspace with developer mode enabled.",
      source: { label: "OpenAI: connect an MCP server", url: "https://developers.openai.com/plugins/quickstart" },
    },
  ];
  return control ? HOSTED_ORDER.map((id) => list.find((h) => h.id === id)!) : list;
}

function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function copyButton(value: string, label: string, cls = "btn"): string {
  return `<button type="button" class="${cls}" data-copy="${esc(value)}" aria-label="${esc(label)}">Copy</button>`;
}

const LOGOS: Record<string, string> = { "claude-code": CLAUDE_ICON, claude: CLAUDE_ICON, codex: OPENAI_ICON, chatgpt: OPENAI_ICON };
const tabLogo = (h: Host): string => `<span class="tab-logo ${h.id}" aria-hidden="true">${LOGOS[h.id] ?? ""}</span>`;
const dot = (level: Level): string => `<span class="dot ${level}" aria-hidden="true"></span>`;

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
  return `<section class="host" id="panel-${h.id}" role="tabpanel" aria-labelledby="tab-${h.id}" tabindex="0"${first ? "" : " data-later"}>
      <div class="host-head"><h3 class="host-name">${esc(h.name)}</h3><span class="badge" title="${esc(LEGEND[h.level])}">${dot(h.level)}${esc(h.tag)}</span></div>
      ${h.intro ? `<p class="host-intro">${inline(h.intro)}</p>` : ""}
      <ol class="steps">
        ${steps}
      </ol>
      <div class="foot">
        ${h.warn ? `<p class="warn-box">${inline(h.warn)}</p>` : ""}
        ${h.note ? `<p>${inline(h.note)}</p>` : ""}
        <details class="guide-evidence"><summary>Connection details &amp; source</summary><p class="status">${esc(h.status)}</p><a href="${esc(h.source.url)}" target="_blank" rel="noopener">${esc(h.source.label)} ↗</a></details>
      </div>
    </section>`;
}

const PAGE_CSS = `
  p,h1,h2,h3,ol { margin:0; }
  min-width:0;
  .setup-top { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:12px 20px; padding:18px 0 18px; }
  .setup-top h1,.inactive-gate h1 { font-size:clamp(28px,3.4vw,40px); font-weight:600; letter-spacing:-.04em; line-height:1.08; }
  .inactive-gate h1 span { color:var(--muted); }
  .lead { color:var(--muted); font-size:14.5px; line-height:1.5; margin-top:4px; }
  .setup-bar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px 16px; padding:10px 14px; border:1px solid var(--line); border-radius:10px; background:var(--panel); font-size:13px; margin-bottom:16px; box-shadow:var(--shadow-sm); }
  .setup-bar span { color:var(--muted); }
  .setup-bar strong { color:var(--ink); font-weight:600; }

  /* Courier Setup Window inside .dot-stage */
  .courier-setup { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-md); }
  .stamp-addr { display:inline-flex; align-items:center; gap:8px; max-width:100%; }
  .stamp-addr code { font:500 11.5px/1.3 var(--mono); color:var(--ground); text-transform:none; letter-spacing:0; overflow-wrap:anywhere; }
  .btn-stamp { padding:3px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.28); background:rgba(255,255,255,.12); color:var(--ground); font:500 11px/1.2 var(--sans); cursor:pointer; text-transform:none; letter-spacing:0; }
  .btn-stamp:hover { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn-stamp.done { background:var(--ok); border-color:var(--ok); color:#fff; }

  .split { display:grid; grid-template-columns:204px minmax(0,1fr); min-height:340px; }
  .rail { border-right:1px solid var(--line); padding:12px 10px; background:color-mix(in srgb,var(--subtle) 45%,var(--panel)); }
  .tabs { display:grid; gap:3px; }
  .tabs[hidden] { display:none; }
  [role=tab] { display:grid; grid-template-columns:18px minmax(0,1fr); align-items:center; gap:9px; width:100%; min-height:40px; padding:8px 11px; border:1px solid transparent; border-radius:7px; background:none; color:var(--muted); font:500 13px/1.25 var(--sans); text-align:left; cursor:pointer; }
  [role=tab]:hover { color:var(--ink); background:var(--subtle); }
  [role=tab][aria-selected=true] { color:var(--ink); font-weight:600; background:var(--select); box-shadow:inset 2.5px 0 0 var(--accent); }
  .tab-logo { display:grid; place-items:center; width:17px; height:17px; }
  .tab-logo svg { width:16px; height:16px; }
  .tab-logo.hermes { background:currentColor; -webkit-mask:url("${HERMES_MASK}") center/contain no-repeat; mask:url("${HERMES_MASK}") center/contain no-repeat; }

  .dot { display:inline-block; flex:none; width:7px; height:7px; border-radius:50%; }
  .dot.tested { background:var(--ok); }
  .dot.partial { border:1.5px solid var(--ok); background:linear-gradient(90deg,var(--ok) 50%,transparent 50%); }
  .dot.docs { border:1.5px solid var(--muted); }

  .host { padding:22px 26px; display:block; }
  html:not(.js) .host + .host { border-top:1px solid var(--line); }
  .host[hidden],.js:not(.ready) .host[data-later] { display:none; }
  .host-head { display:flex; align-items:center; justify-content:space-between; gap:10px 14px; flex-wrap:wrap; }
  .host-name { font-size:20px; font-weight:600; letter-spacing:-.025em; }
  .host-intro { font-size:13px; line-height:1.5; margin-top:10px; padding:8px 12px; background:var(--ground); border:1px solid var(--line-soft); border-radius:6px; color:var(--muted); }
  .badge { display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border:1px solid var(--line); border-radius:999px; background:var(--ground); font:500 10px/1.3 var(--mono); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
  .steps { list-style:none; counter-reset:step; padding:4px 0; margin-top:14px; border-top:1px solid var(--line-soft); }
  .steps li { counter-increment:step; display:grid; grid-template-columns:24px minmax(0,1fr); column-gap:12px; padding:10px 0; border-bottom:1px solid var(--line-soft); }
  .steps li:last-child { border-bottom:0; }
  .steps li::before { content:counter(step); grid-row:1/span 2; width:24px; height:24px; border:1px solid var(--line); border-radius:50%; background:var(--ground); font:600 11px/22px var(--mono); text-align:center; color:var(--ink); }
  .steps li > * { grid-column:2; }
  .steps p { font-size:13.5px; line-height:1.52; padding-top:1px; max-width:70ch; }
  .steps p code,.foot code { font:500 .9em var(--mono); background:var(--ground); border:1px solid var(--line-soft); border-radius:4px; padding:1px 5px; overflow-wrap:anywhere; }
  .cmd { display:flex; align-items:stretch; margin-top:8px; border:1px solid var(--line); border-radius:6px; background:var(--ground); overflow:hidden; }
  .cmd code { flex:1; min-width:0; padding:8px 12px; font:12px/1.55 var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; align-self:center; }
  .cmd .btn { min-height:0; border:0; border-left:1px solid var(--line); border-radius:0; box-shadow:none; padding:6px 12px; font-size:12px; }
  .warn-box { padding:9px 12px; margin-bottom:8px; background:var(--warn-bg, #fff7ef); border:1px solid var(--warn); border-radius:6px; color:var(--ink); font-size:12px; line-height:1.48; }
  @media (prefers-color-scheme: dark) { .warn-box { --warn-bg:#2a2017; } }
  .foot { padding-top:12px; border-top:1px solid var(--line-soft); font-size:12px; color:var(--muted); }
  .foot p + p { margin-top:5px; }
  .guide-evidence summary,.privacy summary { cursor:pointer; color:var(--muted); font-size:12px; padding:6px 0; }
  .guide-evidence .status { margin:6px 0 8px; line-height:1.5; max-width:72ch; }

  .btn { text-decoration:none; flex:none; min-height:34px; padding:6px 13px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--ink); font:500 12.5px/1.2 var(--sans); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.primary { background:var(--ink); border-color:var(--ink); color:var(--ground); }
  .btn.primary:hover { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.done,.btn.done:hover { background:var(--ok); border-color:var(--ok); color:#fff; }

  /* Compact Hairline Prompt Strip (replaces tall multi-card section) */
  .say-strip { margin-top:24px; list-style:none; padding:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; }
  .say-strip li { border-left:1.5px solid var(--ink); padding-left:14px; display:flex; flex-direction:column; gap:5px; }
  .prompt-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .say-quote { font-size:14.5px; font-weight:600; letter-spacing:-.015em; }
  .say-strip .btn { min-height:26px; padding:3px 9px; font-size:11px; }

  .meta-foot { margin-top:22px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 18px; font-size:12px; color:var(--muted); }
  .privacy { margin-top:8px; }
  .kv { display:grid; grid-template-columns:84px minmax(0,1fr); margin:8px 0 0; border-top:1px solid var(--line); }
  .kv dt,.kv dd { margin:0; padding:10px 0; border-bottom:1px solid var(--line-soft); font-size:12.5px; }
  .kv dd { padding-left:16px; color:var(--muted); }
  .kv dt { color:var(--ink); font-weight:500; }

  .inactive-gate { padding-block:clamp(32px,4vw,56px); }
  .gate-cards { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:24px; }
  .gate-card { padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:12px; display:flex; flex-direction:column; align-items:flex-start; gap:10px; }
  .gate-card h2 { font-size:20px; font-weight:600; letter-spacing:-.02em; }
  .gate-card p:not(.eyebrow) { font-size:13.5px; color:var(--muted); line-height:1.52; margin-bottom:4px; }
  .gate-card code { font:.9em var(--mono); background:var(--ground); border:1px solid var(--line-soft); border-radius:4px; padding:1px 5px; }
  .gate-actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
  .text-link { font-size:13.5px; font-weight:500; text-decoration:none; display:inline-flex; gap:6px; align-items:center; }
  .text-link svg { width:15px; height:15px; flex:none; }

  @media(max-width:760px) {
    .dot-stage { padding:12px; }
    .split { display:flex; flex-direction:column; }
    .rail { border-right:0; border-bottom:1px solid var(--line); padding:8px; }
    .tabs { grid-template-columns:1fr 1fr; }
    [role=tab] { justify-content:center; min-height:38px; padding:6px 8px; }
    [role=tab][aria-selected=true] { box-shadow:none; border-color:var(--accent); }
    [role=tab]:last-child { grid-column:1/-1; }
    .host { padding:16px; }
    .gate-cards { grid-template-columns:1fr; }
  }
  @media(max-width:560px) {
    .cmd { flex-direction:column; }
    .cmd .btn { border-left:0; border-top:1px solid var(--line); min-height:34px; }
  }
`;

const CONSOLE_SPLIT_CSS = `@media(max-width:960px) {
  .shell .connect-content .split { display:flex; flex-direction:column; }
  .shell .connect-content .rail { border-right:0; border-bottom:1px solid var(--line); padding:8px; }
  .shell .connect-content .tabs { grid-template-columns:1fr 1fr; }
  .shell .connect-content [role=tab] { justify-content:center; min-height:38px; padding:6px 8px; }
  .shell .connect-content [role=tab][aria-selected=true] { box-shadow:none; border-color:var(--accent); }
  .shell .connect-content [role=tab]:last-child { grid-column:1/-1; }
}`;

const CONNECT_SCRIPT = `(function () {
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
`;

interface Say {
  label: string;
  quote: string;
  copy?: boolean;
}

function nextSteps(control: boolean, viewer?: Viewer): string {
  const [, other, partner] = control ? ["joe", "anna", "partner"] : ["tim", "tom", "teammate"];
  const invite: Say = { label: `Invite your ${partner}`, quote: `Invite my ${partner} to Threadpacket.`, copy: true };
  const send: Say = { label: "Send a packet", quote: `Send a packet to ${other}.` };
  const pickUp: Say = { label: "Pick up a packet", quote: "Continue my packet.", copy: true };
  const says = viewer ? (viewer.admin ? [invite, send] : [pickUp, send]) : [invite, send, pickUp];
  return `<ol class="say-strip" aria-label="First prompts">
    ${says
      .map(
        (x, i) =>
          `<li><p class="eyebrow">${i + 1} · ${esc(x.label)}</p><div class="prompt-row"><p class="say-quote">“${esc(x.quote)}”</p>${x.copy ? copyButton(x.quote, `Copy: ${x.quote}`) : ""}</div></li>`,
      )
      .join("\n    ")}
  </ol>`;
}

export function connectPage(cfg: Config, nonce: string, opts: { needsSetup?: boolean; viewer?: Viewer } = {}): string {
  const active = !opts.needsSetup;
  const url = cfg.mcpResource;
  const shownUrl = showAddress(url);
  const control = cfg.mode === "control";
  const list = hosts(url, control);
  const tabs = list
    .map(
      (h, i) =>
        `<button type="button" role="tab" id="tab-${h.id}" aria-controls="panel-${h.id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${tabLogo(h)}<span class="tab-name">${esc(h.name)}</span></button>`,
    )
    .join("");
  const mainBody = opts.needsSetup
    ? `<section class="inactive-gate" aria-labelledby="connect-title">
    <div>
      <p class="eyebrow">Server setup required</p>
      <h1 id="connect-title">Finish setup first.<br><span>Or deploy your own.</span></h1>
      <p class="lead">Assistants can connect once this server has an admin.</p>
    </div>
    <div class="gate-cards">
      <article class="gate-card">
        <p class="eyebrow">01 · Operator of this server</p>
        <h2>Set up this instance</h2>
        <p>Enter your <code>THREADPACKET_SETUP_CODE</code> secret to create the first admin.</p>
        <a class="site-button primary" href="/console/setup">Set up this server <span aria-hidden="true">↗</span></a>
      </article>
      <article class="gate-card">
        <p class="eyebrow">02 · Run your own copy</p>
        <h2>Install Threadpacket</h2>
        <p>Deploy a private Worker on your own free Cloudflare account.</p>
        <div class="gate-actions">
          <a class="site-button" href="${INSTALL_URL}" target="_blank" rel="noopener"><span>Self-host guide</span> <span aria-hidden="true">↗</span></a>
          <a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    </div>
  </section>`
    : `${opts.viewer
      ? `<header class="app-head"><div><h1 id="connect-title">Assistant setup</h1><p class="lead">Add the server once, then sign in with your access code.</p></div><span class="chip">Username <strong>${esc(opts.viewer.handle)}</strong></span></header>`
      : `<div class="setup-top"><div><h1 id="connect-title">Connect an assistant</h1><p class="lead">Choose your app, add Threadpacket once, and sign in.</p></div></div>
         <div class="setup-bar">${control ? `<span><strong>New to Threadpacket? Create your team when you sign in.</strong> No email or personal details needed.</span><a class="btn" href="/join">Create a team →</a>` : `<span><strong>Have your username and access code ready.</strong></span><a class="btn" href="/login">Sign in →</a>`}</div>`}

  <section class="dot-stage" id="assistants" aria-label="Assistant setup">
    ${REG_TICKS}
    <div class="courier-setup">
      <div class="stamp-bar">
        <span>MCP server</span>
        <span class="stamp-addr"><code>${shownUrl}</code>${copyButton(url, "Copy the server address", "btn-stamp")}</span>
      </div>
      <div class="split">
        <div class="rail">
          <div class="tabs" role="tablist" aria-label="Assistant" aria-orientation="vertical" hidden>${tabs}</div>
        </div>
        <div class="panels">
          ${list.map((h, i) => hostPanel(h, i === 0, url)).join("\n          ")}
        </div>
      </div>
    </div>
  </section>

  ${nextSteps(control, opts.viewer)}

  <div class="meta-foot">
    <span>File on your phone? Upload it in <a href="/packets">Packets</a>.${!control ? ` <a href="${CONTROL_CENTER_URL}/" target="_blank" rel="noopener">About Threadpacket ↗</a>` : ""}</span>
  </div>
  <details class="privacy"><summary>Privacy, limits &amp; expiry</summary>
    <dl class="kv">
      <dt>Identity</dt><dd>Username and access code only. No email address, phone number, real name, or Google login.</dd>
      <dt>Files</dt><dd>PDF, PNG, JPEG, text and Markdown, up to ${cfg.maxAttachmentBytes / 1048576} MiB each; ${cfg.maxAttachmentsPerPacket} files per packet.</dd>
      <dt>Access</dt><dd>Visible only to you and the recipient (or current team members for a team packet). A download link an assistant fetches works for anyone who has it, for 10 minutes.</dd>
      <dt>Expiry</dt><dd>${cfg.defaultExpiryHours % 24 === 0 && cfg.defaultExpiryHours > 24 ? `${cfg.defaultExpiryHours / 24} days` : `${cfg.defaultExpiryHours} hours`} by default, revocable any time.</dd>
    </dl>
  </details>
  <p id="copy-status" class="sr-only" role="status"></p>`;

  if (opts.viewer) {
    return shell("connect", opts.viewer, "Connect an assistant", `<div class="connect-content">${mainBody}</div>`, {
      nonce,
      script: CONNECT_SCRIPT,
      style: `${PAGE_HEADER_CSS}.connect-content {${PAGE_CSS}}${CONSOLE_SPLIT_CSS}`,
    });
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Threadpacket</title>
<meta name="description" content="Add Threadpacket to Claude, Codex and ChatGPT, then send packets between them.">
<link rel="canonical" href="${esc(cfg.publicUrl)}/connect">
${discoveryHead(cfg, "/connect")}${socialMeta(cfg, "Connect an assistant to Threadpacket", "Add Threadpacket to Claude, ChatGPT, Codex, Claude Code or Hermes.", "/connect")}
<script nonce="${nonce}">document.documentElement.classList.add("js");</script>
${FAVICON_LINK}
${FONT_PRELOAD}
<style>
  ${BASE_CSS}
  ${PAGE_HEADER_CSS}
.connect-content {${PAGE_CSS}}
</style>
</head>
<body>
${pageHeader("connect", { active, mode: cfg.mode })}
<main id="main" class="site-width connect-content">
  ${mainBody}
</main>
${pageFooter({ active, mode: cfg.mode })}
<script nonce="${nonce}">
${CONNECT_SCRIPT}
</script>
</body>
</html>`;
}

export function connectHeaders(nonce: string): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}
