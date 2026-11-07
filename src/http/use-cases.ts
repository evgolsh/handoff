import { PRIVATE_DEFAULT_EXPIRY_HOURS, type Config } from "../env";
import { BASE_CSS, BRAND_ICON, FAVICON_LINK, FILE_ICON, FONT_PRELOAD } from "./style";
import { DEPLOY_PATH, GITHUB_URL, PAGE_HEADER_CSS, pageFooter, pageHeader } from "./header";
import { CLAUDE_ICON, GITHUB_ICON, OPENAI_ICON } from "./assistant-icons";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const USE_CASES = [
  { id:"household-last-mile", label:"Family & household", title:"Your partner finishes the paperwork.",
    description:"Sort out the details in Cowork, then send your partner the notes and the PDFs. They finish in ChatGPT on their own computer.",
    send:"Hand this off to tom with the Q3 summary. He needs to check two invoices and draft the client reply.",
    receive:"Pick up the handoff from tim.", files:["vat-q3-summary.pdf", "flagged-invoices.md"] },
  { id:"micro-team-relay", label:"Small teams", title:"A teammate starts with your decisions.",
    description:"Give a teammate the architecture, diagrams, and reasons behind the choices. Their coding assistant starts with the context you prepared.",
    send:"Hand this off to tom with auth-flow.png. Include the approaches we rejected and why.",
    receive:"Continue the handoff from tim.", files:["auth-flow.png", "decisions.md"] },
  { id:"adversarial-review", label:"A second perspective", title:"A second assistant reviews the work.",
    description:"Bring the same design, source files, and constraints to another assistant for an independent review.",
    send:"Hand this design and migration off for a security review.",
    receive:"Read my handoff and check the migration for edge cases.", files:["migration.sql", "threat-model.md"] },
  { id:"home-server-to-laptop", label:"Across computers", title:"Continue on another computer.",
    description:"Let an assistant on your home server prepare the research. Open the brief and original report in your laptop’s assistant when you’re ready.",
    send:"Hand off the benchmark findings and report.pdf.",
    receive:"Continue my handoff.", files:["report.pdf", "findings.md"] },
  { id:"pm-designer-to-engineer", label:"Product to engineering", title:"One brief for the whole team.",
    description:"Package the product brief, mockups, and final copy for your team. Each person can open that handoff in their own assistant.",
    send:"Hand this off to the team with the mockup and copy spec.",
    receive:"Continue the team handoff.", files:["console-mock.png", "copy-spec.md"] },
];

const fileTags = (files: string[], label: string): string =>
  `<ul class="file-tags" aria-label="${label}">${files.map((f) => `<li>${FILE_ICON}${esc(f)}</li>`).join("")}</ul>`;

const PAGE_CSS = `
  p,h1,h2,h3 { margin:0; }
  .hero { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); align-items:center; gap:clamp(40px,5vw,80px); padding-block:clamp(36px,3.5vw,56px); }
  h1 { font-size:clamp(34px,3.4vw,50px); font-weight:500; line-height:1.08; letter-spacing:-.055em; margin:16px 0 18px; text-wrap:balance; }
  h1 span { color:var(--muted); }
  .hero-lead { max-width:46ch; color:var(--muted); font-size:clamp(16px,1.3vw,19px); line-height:1.55; }
  .hero-actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px 18px; margin-top:24px; }
  .text-link { font-size:14px; font-weight:500; text-decoration:none; display:inline-flex; gap:8px; align-items:center; padding-block:10px; }
  .text-link svg { width:16px; height:16px; flex:none; }
  .hero-note { margin-top:16px; font-size:12px; color:var(--muted); }
  .hero-note > span { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--ok); margin-right:8px; }
  .example-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; font:10px var(--mono); color:var(--muted); }
  .example-mark { display:flex; align-items:center; gap:8px; }
  .example-mark svg { width:20px; height:20px; }
  .chat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:12px 18px 16px; box-shadow:0 12px 28px #00000006; display:flex; flex-direction:column; gap:10px; }
  .chat-app { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-bottom:10px; border-bottom:1px solid var(--line-soft); font-size:11px; color:var(--muted); }
  .app { display:inline-flex; align-items:center; gap:5px; color:var(--ink); font-weight:600; white-space:nowrap; vertical-align:bottom; }
  .app svg { flex:none; width:1.15em; height:1.15em; }
  .msg-user { align-self:flex-end; max-width:85%; padding:7px 12px; background:var(--ground); border:1px solid var(--line-soft); border-radius:14px 14px 4px 14px; font-size:13px; line-height:1.45; }
  .tool-step { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; font-size:12px; color:var(--muted); }
  .tool-step svg { width:14px; height:14px; flex:none; }
  .tool-step b { color:var(--ink); font-weight:500; }
  .msg-assistant { font-size:13px; line-height:1.55; }
  .msg-assistant code { font:500 12px var(--mono); white-space:nowrap; }
  .file-tags { display:flex; gap:6px; flex-wrap:wrap; list-style:none; margin:0; padding:0; }
  .file-tags li { display:inline-flex; align-items:center; gap:6px; font:500 11px/1.5 var(--mono); color:var(--ink); padding:5px 9px; background:var(--ground); border:1px solid var(--line); border-radius:4px; overflow-wrap:anywhere; }
  .file-tags svg { width:13px; height:13px; flex:none; color:var(--accent); }
  .handoff-path { display:flex; align-items:center; justify-content:center; gap:10px; height:40px; color:var(--accent); font:500 11px var(--mono); letter-spacing:.06em; }
  .handoff-path span { font-size:14px; }
  .handoff-path i { height:1px; width:40px; background:var(--accent); opacity:.5; }
  .principles { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  .principles article { padding:22px 32px; border-left:1px solid var(--line); }
  .principles article:first-child { padding-left:0; border-left:0; } .principles article:last-child { padding-right:0; }
  .principles h2 { font-size:15px; font-weight:500; margin-bottom:6px; }
  .principles p { font-size:13px; color:var(--muted); max-width:36ch; }
  .section { padding-block:80px; }
  .install-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; }
  .install-card { min-width:0; padding:28px; border:1px solid var(--line); border-radius:8px; background:var(--panel); display:flex; flex-direction:column; gap:12px; }
  .install-card h3 { font-size:22px; margin:0; }
  .install-card p,.install-steps { font-size:14px; color:var(--muted); }
  .install-card strong { color:var(--ink); font-weight:600; }
  .install-card pre { max-width:100%; overflow-x:auto; margin:4px 0; padding:16px; background:var(--ground); border:1px solid var(--line); border-radius:6px; font:11px/1.8 var(--mono); }
  .install-card blockquote { margin:4px 0; padding-left:16px; border-left:2px solid var(--accent); overflow-wrap:anywhere; font-size:14px; }
  .install-card .deploy-button { align-self:flex-start; margin:4px 0; line-height:0; border-radius:4px; }
  .deploy-button img { display:block; width:184px; height:39px; }
  .deploy-button:hover img { filter:brightness(1.25); }
  .install-steps { padding-left:24px; margin-block:24px; }
  .install-steps li { margin-block:12px; }
  .install-steps strong { color:var(--ink); }
  .install-note { font-size:13px; color:var(--muted); margin-top:16px; }
  @media(max-width:1180px) { .install-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .install-card:last-child { grid-column:1/-1; } }
  @media(max-width:760px) { .install-grid { grid-template-columns:1fr; } .install-card { padding:20px; } }
  .section-head { display:flex; justify-content:space-between; align-items:end; gap:24px; margin-bottom:36px; }
  .section-head h2,.watch h2,.closing h2 { font-size:clamp(30px,3vw,44px); font-weight:500; letter-spacing:-.04em; line-height:1.15; max-width:22ch; margin-top:12px; text-wrap:balance; }
  .section-head > p { font-size:14px; color:var(--muted); max-width:33ch; }
  .cases { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  .case { min-width:0; padding:32px; background:var(--panel); border:1px solid var(--line); border-radius:8px; }
  .case-number { color:var(--faint); margin-right:12px; }
  .case h3 { font-size:25px; font-weight:500; letter-spacing:-.025em; line-height:1.25; margin:16px 0 12px; max-width:24ch; }
  .case-description { font-size:14px; color:var(--muted); max-width:55ch; }
  .case.featured { grid-column:1/-1; display:grid; grid-template-columns:1fr 1fr; gap:clamp(32px,6vw,90px); padding:40px; }
  .case.featured h3 { font-size:clamp(28px,3vw,38px); max-width:18ch; }
  .exchange { margin-top:24px; border-top:1px solid var(--line-soft); padding-top:20px; }
  .featured .exchange { margin:0; border:0; padding:0; }
  .exchange-label { font:10px var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .exchange blockquote { margin:8px 0 14px; font-size:15px; line-height:1.6; }
  .exchange .pickup { margin:18px 0 0; border-top:1px solid var(--line-soft); padding-top:14px; }
  .pickup p { margin-top:6px; font-size:14px; }
  .examples-note { margin-top:20px; font-size:12px; color:var(--muted); }
  .watch { display:grid; grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr); gap:60px; align-items:center; padding-block:64px; border-block:1px solid var(--line); }
  .watch-copy > p:last-child { margin-top:20px; max-width:37ch; font-size:15px; color:var(--muted); }
  .video-frame { margin:0; min-width:0; }
  .video-frame video { display:block; width:100%; aspect-ratio:16/9; border:1px solid var(--line); border-radius:8px; background:#171717; }
  .video-frame figcaption { display:flex; justify-content:space-between; gap:12px; margin-top:12px; font:11px var(--mono); color:var(--muted); }
  .ownership { display:grid; grid-template-columns:1fr 1fr; gap:60px; padding-block:72px; }
  .ownership h2 { font-size:30px; font-weight:500; line-height:1.2; letter-spacing:-.035em; max-width:20ch; margin-top:12px; }
  .ownership dl { margin:0; }
  .ownership dl > div { display:grid; grid-template-columns:125px minmax(0,1fr); gap:20px; border-bottom:1px solid var(--line); padding:16px 0; font-size:13px; }
  .ownership dl > div:first-child { padding-top:0; }
  .ownership dt { font-weight:500; } .ownership dd { margin:0; color:var(--muted); }
  .closing { display:flex; align-items:center; justify-content:space-between; gap:32px; padding:48px; margin-bottom:80px; background:var(--ink); color:var(--ground); border-radius:8px; }
  .closing h2 { margin:0; max-width:22ch; } .closing p { margin-top:12px; font-size:14px; opacity:.75; }
  .closing-actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px; flex:none; }
  .closing .site-button { background:var(--ground); color:var(--ink); border-color:var(--ground); flex:none; }
  .closing .site-button.ghost { background:transparent; color:var(--ground); border-color:var(--faint); }
  .closing .site-button:hover { background:var(--accent); color:var(--ground); border-color:var(--accent); }
  @media(max-width:1000px) {
    .hero { gap:32px; }
    .chat { padding:12px 16px 14px; } .watch { gap:32px; }
    .case { padding:26px; } .case.featured { padding:30px; gap:32px; }
  }
  @media(max-width:760px) {
    .hero { grid-template-columns:1fr; padding-block:32px; gap:32px; }
    h1 { font-size:clamp(32px,8.5vw,44px); }
    .hero-lead { max-width:48ch; } .hero-actions { margin-top:24px; }
    .handoff-example { max-width:540px; width:100%; }
    .principles { grid-template-columns:1fr; }
    .principles article,.principles article:first-child,.principles article:last-child { border-left:0; border-bottom:1px solid var(--line-soft); padding:20px 0; }
    .principles article:last-child { border-bottom:0; } .principles p { max-width:none; }
    .section { padding-block:48px; }
    .section-head { align-items:start; flex-direction:column; gap:16px; margin-bottom:24px; } .section-head > p { max-width:45ch; }
    .cases,.case.featured,.watch,.ownership { grid-template-columns:1fr; }
    .case.featured { gap:24px; padding:26px; } .case.featured h3 { font-size:28px; max-width:25ch; }
    .featured .exchange { border-top:1px solid var(--line-soft); padding-top:20px; }
    .watch { padding-block:48px; gap:28px; } .ownership { padding-block:48px; gap:28px; }
    .closing { align-items:start; flex-direction:column; padding:30px; margin-bottom:48px; }
  }
  @media(min-width:761px) and (max-height:720px) { .hero { padding-block:24px; } .principles article { padding-block:16px; } }
  @media(max-width:380px) { .hero-actions { gap:12px; } .chat { padding:12px 14px; } .case,.case.featured { padding:22px; } .closing { padding:24px; } .ownership dl > div { grid-template-columns:90px minmax(0,1fr); gap:16px; } }
`;

function renderCase(c: (typeof USE_CASES)[number], i: number): string {
  return `<article class="case${i === 0 ? " featured" : ""}" id="${c.id}">
    <div><p class="eyebrow"><span class="case-number">0${i + 1}</span>${esc(c.label)}</p>
      <h3>${esc(c.title)}</h3><p class="case-description">${esc(c.description)}</p></div>
    <div class="exchange"><p class="exchange-label">You ask your assistant</p><blockquote>“${esc(c.send)}”</blockquote>
      ${fileTags(c.files, "Example attachments")}
      <div class="pickup"><span class="exchange-label">The next chat starts here</span><p>“${esc(c.receive)}”</p></div>
    </div></article>`;
}

const FACTS = "Runs on your own Cloudflare account, on the free plan. It makes no AI calls and needs no API keys.";
const CLOSING_FACTS = "On your Cloudflare account, on the free plan, with no card. MIT licensed.";

export function useCasesPage(cfg: Config, opts: { active?: boolean } = {}): string {
  const active = opts.active ?? true;
  const playground = cfg.mode === "control" && active;
  const heroActions = playground
    ? `<a class="site-button primary" href="#install"><span>Install Handoff</span> <span aria-hidden="true">↓</span></a><a class="site-button" href="/join">Try the playground <span aria-hidden="true">↗</span></a><a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>`
    : active
    ? `<a class="site-button primary" href="/connect">Connect your assistants <span aria-hidden="true">↗</span></a><a class="site-button" href="#install"><span>Install Handoff</span> <span aria-hidden="true">↓</span></a><a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>`
    : `<a class="site-button primary" href="#install"><span>Install Handoff</span> <span aria-hidden="true">↓</span></a><a class="site-button" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>View on GitHub</span> <span aria-hidden="true">↗</span></a><a class="text-link" href="#use-cases">Explore the use cases <span aria-hidden="true">↓</span></a>`;
  const heroNote = playground
    ? `<p class="hero-note"><span aria-hidden="true"></span>${FACTS} Already on the playground? <a href="/connect">Connect your assistants ↗</a></p>`
    : active
    ? `<p class="hero-note"><span aria-hidden="true"></span>${FACTS} <a href="#use-cases">Explore the use cases ↓</a></p>`
    : `<p class="hero-note"><span aria-hidden="true"></span>${FACTS} Deployed this server? <a href="/console/setup">Set it up ↗</a></p>`;
  const examplesLink = active
    ? `<a href="/connect">Setup for each assistant ↗</a>`
    : `<a href="#install">Install your own on Cloudflare ↓</a>`;
  const expiry = `Handoffs expire after ${PRIVATE_DEFAULT_EXPIRY_HOURS / 24} days by default on your own install${cfg.mode === "control" ? `, ${cfg.defaultExpiryHours} hours on the playground` : ""}. You can revoke a handoff before then.`;
  const ownership = `<section class="ownership" aria-labelledby="ownership-title"><div><p class="eyebrow">What runs on your account</p><h2 id="ownership-title">Handoff is storage with a sign-in.</h2></div>
    <dl><div><dt>No AI inside</dt><dd>Handoff makes no model calls. No token bill, and no API key to create or paste.</dd></div><div><dt>Five MCP tools</dt><dd>Send, inbox, read, revoke, and a link for uploading files. Each person signs in with a username and access code.</dd></div><div><dt>Storage</dt><dd>Briefs in D1, files in Workers KV. ${expiry}</dd></div><div><dt>Free plan</dt><dd>100,000 requests and 1,000 new files a day, and 1 GB of stored files. No card. Handoff has no paid tier.</dd></div><div><dt>Update check</dt><dd>Once a day: a random id, the version and rough counts, nothing else. <code>HANDOFF_UPDATE_CHECK=off</code> turns it off.</dd></div></dl>
  </section>`;
  const example = `<div class="chat"><div class="chat-app"><b class="app">${CLAUDE_ICON}Cowork</b><span>tim</span></div>
        <p class="msg-user">Hand this off to tom. He’ll finish the VAT reply.</p>
        <p class="tool-step">${BRAND_ICON}<span>Send a handoff</span><b>Q3 VAT for the bakery</b></p>
        <p class="msg-assistant">Sent to tom with both files.</p>
        ${fileTags(["vat-q3-summary.pdf", "flagged-invoices.md"], "Example original files")}
      </div>
      <div class="handoff-path" aria-hidden="true"><i></i> BRIEF + ORIGINAL FILES <span>↓</span><i></i></div>
      <div class="chat"><div class="chat-app"><b class="app">${OPENAI_ICON}ChatGPT</b><span>tom</span></div>
        <p class="msg-user">Continue the handoff from tim.</p>
        <p class="tool-step">${BRAND_ICON}<span>Read a handoff</span><b>Q3 VAT for the bakery, 2 files</b></p>
        <p class="msg-assistant">The brief says to fix the two flagged invoices separately. I’ll check their dates in <code>vat-q3-summary.pdf</code> first, then draft the reply.</p>
      </div>`;
  const closing = playground
    ? `<section class="closing" aria-label="Deploy Handoff"><div><h2>Run Handoff for your team.</h2><p>${CLOSING_FACTS}</p></div><div class="closing-actions"><a class="site-button" href="#install"><span>Install Handoff</span> <span aria-hidden="true">↓</span></a><a class="site-button ghost" href="/join">Try the playground <span aria-hidden="true">↗</span></a></div></section>`
    : active
    ? `<section class="closing" aria-label="Connect to Handoff"><div><h2>Keep the work moving.</h2><p>Plan in one AI. Build in another.</p></div><div class="closing-actions"><a class="site-button" href="/connect">Connect your assistants <span aria-hidden="true">↗</span></a><a class="site-button ghost" href="#install"><span>Install your own</span> <span aria-hidden="true">↓</span></a></div></section>`
    : `<section class="closing" aria-label="Deploy Handoff"><div><h2>Run Handoff for your team.</h2><p>${CLOSING_FACTS}</p></div><div class="closing-actions"><a class="site-button" href="#install"><span>Install Handoff</span> <span aria-hidden="true">↓</span></a><a class="site-button ghost" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a></div></section>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handoff</title>
<meta name="description" content="Hand your work to someone else’s AI assistant, with a brief and the original files. Open-source MCP server on your own Cloudflare free plan. No AI calls, no API keys.">
<link rel="canonical" href="${esc(cfg.publicUrl)}/">
${FAVICON_LINK}${FONT_PRELOAD}
<style>${BASE_CSS}${PAGE_HEADER_CSS}${PAGE_CSS}</style></head><body>
${pageHeader("use-cases", { active, mode: cfg.mode })}
<main id="main" class="site-width">
  <section class="hero" aria-labelledby="hero-title">
    <div><p class="eyebrow">Open-source MCP server</p>
      <h1 id="hero-title">Hand your work to <span>someone else’s assistant.</span></h1>
      <p class="hero-lead">You sort out the details in Claude. Your partner says “continue the handoff from tim” in ChatGPT and gets your notes and the original files.</p>
      <div class="hero-actions">${heroActions}</div>
      ${heroNote}
    </div>
    <div class="handoff-example" aria-label="Example of a handoff from one assistant to another">
      <div class="example-top"><span class="example-mark">${BRAND_ICON} A HANDOFF</span></div>
      ${example}
    </div>
  </section>
  <section class="principles" aria-label="What travels with your work">
    <article><h2>Your notes and the files.</h2><p>The brief says what you decided and what is left to do. PDFs and images go with it, byte for byte. A file on your phone? Upload it in My account.</p></article>
    <article><h2>Their own assistant.</h2><p>Your partner can use ChatGPT while you use Claude. Codex, Claude Code and Hermes work too. Each person signs in with their own username.</p></article>
    <article><h2>Storage, not AI.</h2><p>Handoff keeps the brief and files and deletes them after 30 days. It makes no model calls and needs no API keys.</p></article>
  </section>
  <section id="install" class="section" aria-labelledby="install-title">
    <div class="section-head"><div><p class="eyebrow">Install</p><h2 id="install-title">Install it once for your whole team.</h2></div><p>It runs on Workers, D1 and KV in your Cloudflare account, on the free plan with no card. Teammates only sign in.</p></div>
    <div class="install-grid">
      <article class="install-card"><h3>From your browser</h3><p>You need a <strong>Cloudflare account</strong> and a <strong>GitHub or GitLab account</strong>. Cloudflare copies the code there, creates the database and file store, and deploys your server.</p>
        <a class="deploy-button" href="${DEPLOY_PATH}" target="_blank" rel="noopener"><img src="/img/deploy-to-cloudflare.svg" width="184" height="39" alt="Deploy to Cloudflare"></a>
        <p>Set <code>HANDOFF_SETUP_CODE</code> to a code of 12 or more characters. After the deploy, open <code>/console/setup</code> on your new server and enter it with your username.</p></article>
      <article class="install-card"><h3>Ask a coding assistant</h3><p>Claude Code, Codex, Gemini CLI, Hermes or any assistant that can run commands on your computer. Give it this request with your own usernames:</p>
        <blockquote>Deploy https://github.com/evgolsh/handoff to my Cloudflare account. Follow llms-install.md. My username is tim; add tom as a teammate. Ask me to approve the Cloudflare login, then help me connect my assistants.</blockquote>
        <p>You approve the Cloudflare login. No GitHub account needed.</p></article>
      <article class="install-card"><h3>Run it yourself</h3><p>You need Git, Node.js 22+ with npm, and a Cloudflare account. No GitHub account needed.</p>
        <pre><code>git clone https://github.com/evgolsh/handoff.git
cd handoff
npm install
npm run setup -- --members=tim,tom</code></pre>
        <p>Replace <code>tim,tom</code> with your usernames, yours first. Setup creates the storage, deploys the server and makes you the admin.</p></article>
    </div>
    <ol class="install-steps">
      <li><strong>Sign in to your Handoff console.</strong> After a browser deploy, <code>/console/setup</code> creates your admin account and shows your access code once. After a terminal install, sign in at the printed <code>/console</code> URL with the access code setup printed. Save access codes privately.</li>
      <li><strong>Add your teammates.</strong> After a browser deploy, or when adding more people later, create their usernames in Members and share each person’s access code privately. Teammates need no Cloudflare or GitHub account.</li>
      <li><strong>Connect your assistants.</strong> Each person opens your server’s <code>/connect</code> page and follows the steps for their assistant. Everyone uses the same server. To upload a file from a phone or another folder, they sign in at <code>/account</code>.</li>
      <li><strong>Try a handoff.</strong> Say “Hand this off” in one assistant, then “Continue my handoff” in another. To send to your teammate, say “Hand this off to tom”.</li>
    </ol>
    <p class="install-note">From a terminal, a new Cloudflare account may need its <code>workers.dev</code> address registered first; setup links to the page. If the account already has a Worker named <code>handoff</code>, check it first: setup redeploys it. <a href="${GITHUB_URL}#install" target="_blank" rel="noopener">Full setup guide ↗</a></p>
  </section>
  <section id="use-cases" class="section" aria-labelledby="cases-title">
    <div class="section-head"><div><p class="eyebrow">Use cases</p><h2 id="cases-title">What people hand off.</h2></div><p>To a partner, a teammate, or to yourself on another computer.</p></div>
    <div class="cases">${USE_CASES.map(renderCase).join("\n")}</div>
    <p class="examples-note">${examplesLink}</p>
  </section>
  <section class="watch" id="walkthrough" aria-labelledby="watch-title">
    <div class="watch-copy"><p class="eyebrow">Demo, 29 seconds</p><h2 id="watch-title">From install to the first handoff.</h2><p>tim installs Handoff and tom connects ChatGPT. tim hands off a brief and two files from Cowork on a Mac, and tom continues in ChatGPT on Windows.</p></div>
    <figure class="video-frame"><video autoplay muted loop playsinline controls src="/demo/handoff-demo.mp4" aria-label="Handoff walkthrough">
      Your browser does not support embedded video. <a href="/demo/handoff-demo.mp4">Download the walkthrough</a>.
      </video><figcaption><a href="/demo/handoff-demo.mp4">Open video ↗</a></figcaption></figure>
  </section>
  ${ownership}
  ${closing}
</main>${pageFooter({ active, mode: cfg.mode })}</body></html>`;
}

export function useCasesHeaders(): Record<string, string> {
  return {
    "content-type":"text/html; charset=utf-8", "cache-control":"public, max-age=300",
    "referrer-policy":"no-referrer", "x-content-type-options":"nosniff",
    "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}
