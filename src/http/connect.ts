import { shell, type Viewer } from "../console/html";
import { CONTROL_CENTER_URL, type Config } from "../env";
import { BASE_CSS, BRAND_ICON, FAVICON_LINK, FONT_PRELOAD } from "./style";
import { INSTALL_URL, GITHUB_URL, PAGE_HEADER_CSS, pageFooter, pageHeader } from "./header";
import { CLAUDE_ICON, GITHUB_ICON, HERMES_MASK, OPENAI_ICON } from "./assistant-icons";
import { claudeInstallLink, discoveryHead, socialMeta } from "./meta";

/**
 * The Connect page: how to add Handoff to each assistant. Steps are only those that the host documents or
 * that we tested; each host says which. There is no one-click install: every host asks the person to add
 * the server and to approve the sign-in.
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A step is plain text with `code` spans, optionally followed by a command to copy. */
export interface Step {
  text: string;
  command?: string;
}

/**
 * tested: these steps worked with Handoff: sign-in and sending, with files. Revoking is not part of the test.
 * partial: some of it was tested (another route, or only the sign-in); the status says what.
 * docs: the host's own documentation, not yet tried with Handoff.
 */
export type Level = "tested" | "partial" | "docs";
const LEGEND: Record<Level, string> = {
  tested: "Tested: sign-in and sending worked with Handoff.",
  partial: "Partly tested: the guide says which part.",
  docs: "From the assistant’s documentation.",
};

export interface Host {
  id: string;
  name: string;
  level: Level;
  /** A few words for the tab and the badge. */
  tag: string;
  status: string;
  /** A distinction needed before following the steps. */
  intro?: string;
  steps: Step[];
  /** A step people miss, in orange text. */
  warn?: string;
  note?: string;
  source: { label: string; url: string };
}

/** Each assistant's setup steps. Also rendered as Markdown for agents (src/http/agents.ts). */
const HOSTED_ORDER = ["claude", "chatgpt", "claude-code", "codex", "hermes"];

export function hosts(url: string, control = false): Host[] {
  // On the hosted service a new person creates their team on that same sign-in page.
  const signIn = control ? "your team, username and access code, or choose **Create a team** if you're new," : "your username and access code";
  const host = new URL(url).host;
  const list: Host[] = [
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
        { text: `Open [Add Handoff to Claude](${claudeInstallLink(url)}): Claude's custom connector form opens with the name and server address filled in. Or open [Customize > Connectors](https://claude.ai/customize/connectors), select **+ Add**, then **Add custom connector**.` },
        { text: "Check that the name is Handoff and the server address is the one above, and select **Continue**." },
        { text: "Keep the recommended sign-in settings and select **Add**." },
        { text: `Select **Connect**, sign in with ${signIn} and approve access.` },
      ],
      warn: `To attach files, add \`${host}\` to the allowed domains in Claude's Settings > Capabilities. Without it, uploads fail with a 403 error.`,
      note: "On a Team or Enterprise plan, an owner first adds the connector in Organization settings > Connectors. Free plans allow one custom connector.",
      source: { label: "Claude help: custom connectors", url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp" },
    },
    {
      id: "codex",
      name: "Codex",
      intro: "Using the Codex app? Choose ChatGPT in the assistant picker and add Handoff there once. The steps below are for the Codex CLI and IDE extension.",
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
  // The hosted service is for families and small teams: the chat apps come first. A private server's admin is
  // usually at a terminal, so its page starts with Claude Code.
  return control ? HOSTED_ORDER.map((id) => list.find((h) => h.id === id)!) : list;
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
      <div class="host-head"><h3 class="host-name">${esc(h.name)}</h3><span class="badge" title="${esc(LEGEND[h.level])}">${dot(h.level)}${esc(h.tag)}</span></div>
      ${h.intro ? `<p class="host-intro">${inline(h.intro)}</p>` : ""}
      <ol class="steps">
        ${steps}
      </ol>
      <div class="foot">
        ${h.warn ? `<p class="warn">${inline(h.warn)}</p>` : ""}
        ${h.note ? `<p>${inline(h.note)}</p>` : ""}
        <details class="guide-evidence"><summary>Connection details &amp; source</summary><p class="status">${esc(h.status)}</p><a href="${esc(h.source.url)}" target="_blank" rel="noopener">${esc(h.source.label)} ↗</a></details>
      </div>
    </section>`;
}

const PAGE_CSS = `
  p,h1,h2,h3,ol { margin:0; }
  max-width:1120px;min-width:0;margin-inline:auto;
  .setup-intro { padding:20px 0 24px; }
  h1 { font-size:clamp(30px,3.5vw,44px); font-weight:500; letter-spacing:-.045em; line-height:1.15; margin:10px 0; }
  h1 span { color:var(--muted); }
  .lead { color:var(--muted); font-size:16px; line-height:1.6; }
  .setup-identity,.access-notice { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:16px 20px; border:1px solid var(--line); border-radius:10px; font-size:13px; background:var(--panel); }
  .setup-identity span+span,.access-notice p { color:var(--muted); font-size:12px; }
  .setup-identity strong { margin-left:5px; }.setup-identity [aria-hidden] { padding:0 12px;color:var(--faint); }
  .setup-identity,.access-notice { margin-bottom:28px; }
  .access-notice p { margin-top:5px; }.access-notice strong { font-weight:500; }.access-notice p strong { color:var(--ink); }
  .setup-address { display:flex; gap:14px; align-items:center; }
  .setup-address>div { min-width:0; }.setup-address code { display:block; font:12px/1.6 var(--mono);overflow-wrap:anywhere; }
  .addr-label { display:block; color:var(--muted); font-size:11px; margin-bottom:4px; }
  .prompt-row { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  .prompt-row > button { flex:none; margin-top:10px; }
  .next-note { color:var(--muted); font-size:12px; margin-top:16px; line-height:1.6; }.next-note a { text-decoration:underline;text-underline-offset:3px; }
  .guide-evidence summary,.privacy summary { cursor:pointer; color:var(--muted); font-size:12px; padding:8px 0; }
  .guide-evidence[open] summary { margin-bottom:8px; }.guide-evidence .status { padding:0;margin:0 0 10px; }
  .privacy { border-top:1px solid var(--line); }.privacy>summary { font-size:13px; padding:22px 0; }

  .section { padding-block:28px; border-top:1px solid var(--line); }
  .section-head { display:flex; justify-content:space-between; align-items:end; gap:24px; margin-bottom:20px; }
  .section-head h2,.privacy h2 { font-size:24px; font-weight:500; line-height:1.15; letter-spacing:-.04em; margin-top:10px; text-wrap:balance; }
  .section-head > p { max-width:36ch; font-size:14px; color:var(--muted); }
  .split { display:grid; height:auto; grid-template-columns:200px minmax(0,1fr); gap:clamp(24px,3vw,48px); align-items:start; }

  .rail { position:sticky; top:24px; display:grid; gap:20px; }
  .tabs { display:grid; gap:4px; }
  .tabs[hidden] { display:none; }
  [role=tab] { display:grid; grid-template-columns:18px minmax(0,1fr); align-items:center; gap:10px; width:100%; min-height:46px; padding:10px 14px; border:1px solid transparent; border-radius:6px; background:none; color:var(--muted); font:500 14px/1.3 var(--sans); text-align:left; cursor:pointer; }
  [role=tab]:hover { color:var(--ink); background:var(--line-soft); }
  [role=tab][aria-selected=true] { color:var(--ink); background:var(--panel); border-color:var(--line); }
  .tab-logo { display:grid; place-items:center; width:18px; height:18px; }
  .tab-logo svg { width:17px; height:17px; }
  .tab-logo.hermes { background:currentColor; -webkit-mask:url("${HERMES_MASK}") center/contain no-repeat; mask:url("${HERMES_MASK}") center/contain no-repeat; }

  .dot { display:inline-block; flex:none; width:8px; height:8px; border-radius:50%; }
  .dot.tested { background:var(--ok); }
  .dot.partial { border:1.5px solid var(--ok); background:linear-gradient(90deg,var(--ok) 50%,transparent 50%); }
  .dot.docs { border:1.5px solid var(--muted); }

  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
  .host { padding:24px 28px; display:block; border-radius:12px; }
  html:not(.js) .host + .host { margin-top:16px; }
  .host[hidden],.js:not(.ready) .host[data-later] { display:none; }
  .host-head { display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap; }
  .host-name { font-size:24px; font-weight:500; letter-spacing:-.03em; }
  .host-intro { font-size:14px; line-height:1.6; margin-top:18px; }
  .badge { display:inline-flex; align-items:center; gap:8px; padding:5px 11px; border:1px solid var(--line); border-radius:999px; font:10px/1.4 var(--mono); letter-spacing:.06em; text-transform:uppercase; color:var(--muted); white-space:nowrap; }
  .status { max-width:78ch; margin-top:10px; padding-bottom:18px; font-size:13px; color:var(--muted); }
  .steps { list-style:none; counter-reset:step; padding:6px 0 4px; margin-top:18px;border-top:1px solid var(--line-soft); }
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

  .btn { text-decoration:none; flex:none; min-width:72px; min-height:40px; padding:9px 14px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); font:500 13px/1.2 var(--sans); cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.primary { background:var(--ink); border-color:var(--ink); color:var(--ground); }
  .btn.primary:hover { background:var(--accent); border-color:var(--accent); color:var(--ground); }
  .btn.done,.btn.done:hover { background:var(--ok); border-color:var(--ok); color:var(--panel); }

  .say { list-style:none; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  .say.three { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .say li { padding:22px 24px; display:block; }
  .say-quote { margin:12px 0; font-size:21px; font-weight:500; letter-spacing:-.025em; }
  .say.three .say-quote { font-size:19px; }
  @media(min-width:761px) { .say li { display:grid; grid-row:span 3; grid-template-rows:subgrid; row-gap:0; align-content:start; } }
  .say-text { max-width:58ch; font-size:14px; color:var(--muted); }
  .privacy { padding-bottom:24px; }
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
    .split { grid-template-columns:180px minmax(0,1fr); }
    .host { padding:24px; }
  }
  @media(max-width:760px) {
    .split { display:flex; flex-direction:column; gap:16px; }
    .split > *,.tabs { width:100%; }
    .rail { display:contents; }
    .tabs { grid-template-columns:1fr 1fr; padding:4px; border-radius:8px; background:var(--line-soft); }
    [role=tab] { grid-template-columns:18px auto; justify-content:center; min-height:44px; padding:8px 10px; font-size:13px; }
    [role=tab]:last-child { grid-column:1/-1; }
    .panels { order:1; }
    .section-head { flex-direction:column; align-items:flex-start; gap:10px; }
    .section-head .setup-address { width:100%; justify-content:space-between; }
    .say,.say.three,.gate-cards { grid-template-columns:1fr; gap:16px; }
  }
  @media(max-width:600px) {
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
  @media(prefers-reduced-motion:no-preference) { .btn,[role=tab] { transition:background-color .15s,border-color .15s,color .15s; } }`;

/** Inside the console, the sidebar takes 220px, so the tabs stack above the panel up to a tablet's width. */
const CONSOLE_SPLIT_CSS = `@media(max-width:960px) {
  .shell .connect-content .split { display:flex; flex-direction:column; gap:16px; }
  .shell .connect-content .split > *,.shell .connect-content .tabs { width:100%; }
  .shell .connect-content .rail { display:contents; }
  .shell .connect-content .tabs { grid-template-columns:1fr 1fr; padding:4px; border-radius:8px; background:var(--line-soft); }
  .shell .connect-content [role=tab] { grid-template-columns:18px auto; justify-content:center; min-height:44px; padding:8px 10px; font-size:13px; }
  .shell .connect-content [role=tab]:last-child { grid-column:1/-1; }
  .shell .connect-content .panels { order:1; }
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
  /** Copied as is; only prompts that work word for word get a copy button. */
  copy?: boolean;
  text: string;
}

/**
 * What to say once connected, for whoever reads the page: an admin invites the others first, a member who was
 * invited picks up first, and a visitor who is not signed in sees all three. The hosted story is joe and anna;
 * a private server's is tim and tom.
 */
function nextSteps(control: boolean, viewer?: Viewer): string {
  const [sender, other, partner] = control ? ["joe", "anna", "partner"] : ["tim", "tom", "teammate"];
  const invite: Say = {
    label: `Invite your ${partner}`,
    quote: `Invite my ${partner} to Handoff.`,
    copy: true,
    text: "Your assistant asks for their username and gives you a link to send them, with their access code and setup steps.",
  };
  const send: Say = {
    label: "Send a handoff",
    quote: `Hand this off to ${other}.`,
    text: "Use their username. Your assistant writes the brief and attaches the files you chose.",
  };
  const pickUp: Say = {
    label: "Pick up a handoff",
    quote: "Continue my handoff.",
    copy: true,
    text: `Your assistant finds the handoff sent to you and reads its brief and files. If there are several, name the sender: “Continue the handoff from ${sender}.”`,
  };
  const says = viewer ? (viewer.admin ? [invite, send] : [pickUp, send]) : [invite, send, pickUp];
  const items = says
    .map(
      (x, i) =>
        `<li class="panel"><p class="eyebrow">${i + 1} · ${esc(x.label)}</p><div class="prompt-row"><p class="say-quote">“${esc(x.quote)}”</p>${x.copy ? copyButton(x.quote, `Copy: ${x.quote}`) : ""}</div><p class="say-text">${esc(x.text)}</p></li>`,
    )
    .join("\n      ");
  return `<section class="section next" aria-labelledby="next-title">
    <div class="section-head"><div><p class="eyebrow">Once you're connected</p><h2 id="next-title">Try your first handoff.</h2></div></div>
    <ol class="say${says.length === 3 ? " three" : ""}">
      ${items}
    </ol>
    <p class="next-note">Moving work between your own assistants or computers? Connect each one with the same username, then say “Hand this off” in one and “Continue my handoff” in the other. <a ${control ? 'href="/#use-cases"' : `href="${CONTROL_CENTER_URL}/#use-cases" target="_blank" rel="noopener"`}>More examples ↗</a></p>
    <p class="next-note">File on your phone, or not in your assistant's chat? Upload it in <a href="/assets">Assets</a>, then say “Hand this off with lease.pdf”. Your handoffs, with their briefs and files, are there too.</p>
  </section>`;
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
      <p class="lead">Assistants can connect once this Handoff server has an admin who can issue usernames and access codes.</p>
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
        <h2>Install Handoff</h2>
        <p>Deploy from your browser, ask a coding assistant to run setup, or run the commands yourself. Each way creates your private server on your Cloudflare account. Then you manage your team in Handoff’s console.</p>
        <div class="gate-actions">
          <a class="site-button" href="${INSTALL_URL}" target="_blank" rel="noopener"><span>Installation guide</span> <span aria-hidden="true">↗</span></a>
          <a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    </div>
  </section>`
    : `<section class="setup-intro" aria-labelledby="connect-title">
      <p class="eyebrow">Assistant setup</p>
      <h1 id="connect-title">Connect an assistant.</h1>
      <p class="lead">Choose the app you use. Add Handoff, then sign in.</p>
    </section>
    ${opts.viewer ? `<div class="setup-identity"><span>${opts.viewer.tenant ? `Team <strong>${esc(opts.viewer.tenant)}</strong> <span aria-hidden="true">/</span> ` : ""}Username <strong>${esc(opts.viewer.handle)}</strong></span><span>Use your saved access code when asked to sign in.</span></div>` : (control
      ? `<div class="access-notice"><div><strong>New to Handoff? You create your team when you sign in.</strong><p>Add Handoff to your assistant below, then choose <strong>Create a team</strong> on the sign-in page that opens, or <a class="u" href="/join">create a team in the browser</a>. Invited? Use the username and access code from your invitation.</p></div></div>`
      : `<div class="access-notice"><div><strong>Have your username and access code ready.</strong><p>Ask the person who runs this server for your sign-in details.</p></div><a class="u" href="/login">Sign in →</a></div>`)}

  <section class="section setup" id="assistants" aria-labelledby="assistant-title">
    <div class="section-head"><h2 id="assistant-title">Choose your assistant</h2><div class="setup-address"><div><span class="addr-label">Server address</span><code>${shownUrl}</code></div>${copyButton(url, "Copy the server address")}</div></div>
    <div class="split">
      <div class="rail">
        <div class="tabs" role="tablist" aria-label="Assistant" aria-orientation="vertical" hidden>${tabs}</div>
      </div>
      <div class="panels">
    ${list.map((h, i) => hostPanel(h, i === 0, url)).join("\n    ")}
      </div>
    </div>
  </section>

  ${nextSteps(control, opts.viewer)}

  <details class="privacy"><summary>Privacy, file limits and expiry</summary>
    <dl class="kv">
      <dt>Content</dt><dd>Only what you send: the brief and the files you attach.</dd>
      <dt>Files</dt><dd>PDF, PNG, JPEG, text and Markdown, up to ${cfg.maxAttachmentBytes / 1048576} MiB each; ${cfg.maxAttachmentsPerPacket} files per handoff.</dd>
      <dt>Access</dt><dd>Your handoffs are visible to you and their recipient. A team handoff is visible to every current member, including people added later. A file download link that an assistant gets works for anyone who has it, for 10 minutes.</dd>
      <dt>Expiry</dt><dd>${cfg.defaultExpiryHours % 24 === 0 && cfg.defaultExpiryHours > 24 ? `${cfg.defaultExpiryHours / 24} days` : `${cfg.defaultExpiryHours} hours`} by default. The sender or named recipient can revoke a handoff. Only the sender can revoke a team handoff.</dd>
      <dt>Reading</dt><dd>Reading a packet does not change it, so you can open it in more than one assistant.</dd>
    </dl>
  </details>
  <p id="copy-status" class="sr-only" role="status"></p>`;
  if (opts.viewer) return shell("connect", opts.viewer, "Connect an assistant", `<div class="connect-content">${mainBody}</div>`, {
    nonce, script: CONNECT_SCRIPT, style: `${PAGE_HEADER_CSS}.connect-content {${PAGE_CSS}}${CONSOLE_SPLIT_CSS}`,
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Handoff</title>
<meta name="description" content="Add Handoff to Claude, Codex and ChatGPT, then move work between them.">
<link rel="canonical" href="${esc(cfg.publicUrl)}/connect">
${discoveryHead(cfg, "/connect")}${socialMeta(cfg, "Connect an assistant to Handoff", "Add Handoff to Claude, ChatGPT, Codex, Claude Code or Hermes, then hand work to someone else's assistant.", "/connect")}
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
