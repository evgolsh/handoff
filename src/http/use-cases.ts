import { PRIVATE_DEFAULT_EXPIRY_HOURS, type Config } from "../env";
import { BASE_CSS, BRAND_ICON, FAVICON_LINK, FONT_PRELOAD } from "./style";
import { DEPLOY_PATH, GITHUB_URL, PAGE_HEADER_CSS, pageFooter, pageHeader } from "./header";
import { CLAUDE_ICON, CLOUDFLARE_ICON, GITHUB_ICON, OPENAI_ICON } from "./assistant-icons";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const USE_CASES = [
  { id:"household-last-mile", label:"Family & household", title:"Do the groundwork. Share the next step.",
    description:"Work through the details in your assistant, then give your partner the brief and files to finish on their own computer.",
    send:"Hand this off to tom with the Q3 summary. He needs to check two invoices and draft the client reply.",
    receive:"Pick up the handoff from tim.", files:["vat-q3-summary.pdf", "flagged-invoices.md"] },
  { id:"micro-team-relay", label:"Small teams", title:"Pass on the decisions with the task.",
    description:"Give a teammate the architecture, diagrams, and reasons behind the choices. Their coding assistant starts with the context you prepared.",
    send:"Hand this off to tom with auth-flow.png. Include the approaches we rejected and why.",
    receive:"Continue the handoff from tim.", files:["auth-flow.png", "decisions.md"] },
  { id:"adversarial-review", label:"A second perspective", title:"Build in one AI. Review in another.",
    description:"Bring the same design, source files, and constraints to another assistant for an independent review.",
    send:"Hand this design and migration off for a security review.",
    receive:"Read my handoff and check the migration for edge cases.", files:["migration.sql", "threat-model.md"] },
  { id:"home-server-to-laptop", label:"Across computers", title:"Pick it up where you are.",
    description:"Let an agent on your home server prepare the research. Open the brief and original report in your laptop’s assistant when you’re ready.",
    send:"Hand off the benchmark findings and report.pdf.",
    receive:"Continue my handoff.", files:["report.pdf", "findings.md"] },
  { id:"pm-designer-to-engineer", label:"Product to engineering", title:"Give the whole team a clear starting point.",
    description:"Package the product brief, mockups, and final copy for your team. Each person can open that handoff in their own assistant.",
    send:"Hand this off to the team with the mockup and copy spec.",
    receive:"Continue the team handoff.", files:["console-mock.png", "copy-spec.md"] },
];

const PAGE_CSS = `
  p,h1,h2,h3 { margin:0; }
  .hero { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); align-items:center; gap:clamp(40px,5vw,80px); padding-block:clamp(36px,3.5vw,56px); }
  h1 { font-size:clamp(40px,4.4vw,66px); font-weight:500; line-height:1.04; letter-spacing:-.055em; margin:16px 0 18px; text-wrap:balance; }
  h1 span { color:var(--muted); }
  .hero-lead { max-width:46ch; color:var(--muted); font-size:clamp(16px,1.3vw,19px); line-height:1.55; }
  .hero-actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px 18px; margin-top:24px; }
  .text-link { font-size:14px; font-weight:500; text-decoration:none; display:inline-flex; gap:8px; align-items:center; padding-block:10px; }
  .text-link svg { width:16px; height:16px; flex:none; }
  .hero-note { margin-top:16px; font-size:12px; color:var(--muted); }
  .hero-note > span { display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--ok); margin-right:8px; }
  .handoff-example { padding:20px 22px; border:1px solid var(--line); border-radius:12px; background:var(--line-soft); }
  .example-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; font:10px var(--mono); color:var(--muted); }
  .example-mark { display:flex; align-items:center; gap:8px; }
  .example-mark svg { width:20px; height:20px; }
  .packet { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px 20px; box-shadow:0 12px 28px #00000006; }
  .packet-person { display:flex; align-items:center; gap:10px; font-size:13px; }
  .avatar { display:grid; place-items:center; width:32px; height:32px; background:var(--ground); border:1px solid var(--line); border-radius:50%; font:12px var(--mono); }
  .packet-person small { display:block; color:var(--muted); font-size:11px; }
  .app { display:inline-flex; align-items:center; gap:5px; color:var(--ink); font-weight:600; white-space:nowrap; vertical-align:bottom; }
  .app svg { flex:none; width:1.15em; height:1.15em; }
  .packet h2 { font-size:19px; font-weight:500; letter-spacing:-.02em; margin-top:14px; }
  .packet dl { margin:12px 0 14px; font-size:12px; display:grid; grid-template-columns:64px minmax(0,1fr); gap:6px 10px; }
  .packet dt { color:var(--muted); } .packet dd { margin:0; }
  .file-tags { display:flex; gap:6px; flex-wrap:wrap; list-style:none; margin:0; padding:0; }
  .file-tags li { font:10px/1.5 var(--mono); padding:6px 8px; border:1px solid var(--line); border-radius:4px; overflow-wrap:anywhere; }
  .handoff-path { display:flex; align-items:center; justify-content:center; gap:10px; height:36px; color:var(--muted); font:10px var(--mono); }
  .handoff-path i { height:1px; width:32px; background:var(--line); }
  .receive { padding:14px 18px; background:var(--panel); border:1px solid var(--line); border-radius:8px; display:flex; gap:12px; align-items:center; }
  .receive-symbol { color:var(--ok); font-size:22px; }
  .receive strong { display:block; font-size:13px; font-weight:500; }
  .receive p { font-size:12px; color:var(--muted); margin-top:2px; }
  .principles { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  .principles article { padding:22px 32px; border-left:1px solid var(--line); }
  .principles article:first-child { padding-left:0; border-left:0; } .principles article:last-child { padding-right:0; }
  .principles h2 { font-size:15px; font-weight:500; margin-bottom:6px; }
  .principles p { font-size:13px; color:var(--muted); max-width:36ch; }
  .section { padding-block:80px; }
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
    .hero { gap:32px; } h1 { font-size:clamp(40px,5vw,52px); }
    .handoff-example { padding:18px; } .packet { padding:16px 18px; } .watch { gap:32px; }
    .case { padding:26px; } .case.featured { padding:30px; gap:32px; }
  }
  @media(max-width:760px) {
    .hero { grid-template-columns:1fr; padding-block:32px; gap:32px; }
    h1 { font-size:clamp(40px,10vw,64px); max-width:14ch; }
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
  @media(max-width:380px) { .hero-actions { gap:12px; } .handoff-example { padding:14px; } .packet { padding:16px; } .case,.case.featured { padding:22px; } .closing { padding:24px; } .ownership dl > div { grid-template-columns:90px minmax(0,1fr); gap:16px; } }
`;

function renderCase(c: (typeof USE_CASES)[number], i: number): string {
  return `<article class="case${i === 0 ? " featured" : ""}" id="${c.id}">
    <div><p class="eyebrow"><span class="case-number">0${i + 1}</span>${esc(c.label)}</p>
      <h3>${esc(c.title)}</h3><p class="case-description">${esc(c.description)}</p></div>
    <div class="exchange"><p class="exchange-label">You ask your assistant</p><blockquote>“${esc(c.send)}”</blockquote>
      <ul class="file-tags" aria-label="Example attachments">${c.files.map(f => `<li>${esc(f)}</li>`).join("")}</ul>
      <div class="pickup"><span class="exchange-label">The next chat starts here</span><p>“${esc(c.receive)}”</p></div>
    </div></article>`;
}

export function useCasesPage(cfg: Config, opts: { active?: boolean } = {}): string {
  const active = opts.active ?? true;
  const playground = cfg.mode === "control" && active;
  const heroActions = playground
    ? `<a class="site-button primary" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy to Cloudflare</span> <span aria-hidden="true">↗</span></a><a class="site-button" href="/join">Try the playground <span aria-hidden="true">↗</span></a><a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>`
    : active
    ? `<a class="site-button primary" href="/connect">Connect your assistants <span aria-hidden="true">↗</span></a><a class="site-button" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy to Cloudflare</span> <span aria-hidden="true">↗</span></a><a class="text-link" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a>`
    : `<a class="site-button primary" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy to Cloudflare</span> <span aria-hidden="true">↗</span></a><a class="site-button" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>View on GitHub</span> <span aria-hidden="true">↗</span></a><a class="text-link" href="#use-cases">Explore the use cases <span aria-hidden="true">↓</span></a>`;
  const heroNote = playground
    ? `<p class="hero-note"><span aria-hidden="true"></span>MIT licensed · Runs on your Cloudflare account · Already on the playground? <a href="/connect">Connect your assistants ↗</a></p>`
    : active
    ? `<p class="hero-note"><span aria-hidden="true"></span>MIT licensed · Runs on your Cloudflare account · <a href="#use-cases">Explore the use cases ↓</a></p>`
    : `<p class="hero-note"><span aria-hidden="true"></span>MIT licensed · Runs on your Cloudflare account · Deployed this server? <a href="/console/setup">Set it up ↗</a></p>`;
  const examplesLink = active
    ? `<a href="/connect">Setup for each assistant ↗</a>`
    : `<a href="${DEPLOY_PATH}" target="_blank" rel="noopener">Deploy your own on Cloudflare ↗</a>`;
  const closing = playground
    ? `<section class="closing" aria-label="Deploy Handoff"><div><h2>Run Handoff for your team.</h2><p>Your own Cloudflare account. Built-in OAuth 2.1. MIT licensed.</p></div><div class="closing-actions"><a class="site-button" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy to Cloudflare</span> <span aria-hidden="true">↗</span></a><a class="site-button ghost" href="/join">Try the playground <span aria-hidden="true">↗</span></a></div></section>`
    : active
    ? `<section class="closing" aria-label="Connect to Handoff"><div><h2>Keep the work moving.</h2><p>Plan in one AI. Build in another.</p></div><div class="closing-actions"><a class="site-button" href="/connect">Connect your assistants <span aria-hidden="true">↗</span></a><a class="site-button ghost" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy your own</span> <span aria-hidden="true">↗</span></a></div></section>`
    : `<section class="closing" aria-label="Deploy Handoff"><div><h2>Run Handoff for your team.</h2><p>Your own Cloudflare account. Built-in OAuth 2.1. MIT licensed.</p></div><div class="closing-actions"><a class="site-button" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span>Deploy to Cloudflare</span> <span aria-hidden="true">↗</span></a><a class="site-button ghost" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span> <span aria-hidden="true">↗</span></a></div></section>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handoff</title>
<meta name="description" content="Pass a prepared brief and original files to your next AI assistant, a teammate, or your family. Private handoffs on your own Cloudflare account.">
<link rel="canonical" href="${esc(cfg.publicUrl)}/">
${FAVICON_LINK}${FONT_PRELOAD}
<style>${BASE_CSS}${PAGE_HEADER_CSS}${PAGE_CSS}</style></head><body>
${pageHeader("use-cases", { active, mode: cfg.mode })}
<main id="main" class="site-width">
  <section class="hero" aria-labelledby="hero-title">
    <div><p class="eyebrow">Across assistants. Across computers.</p>
      <h1 id="hero-title">Your next chat.<br><span>Already up to speed.</span></h1>
      <p class="hero-lead">Pass the decisions, the brief, and the original files to your next assistant. Or give a teammate’s assistant everything it needs to continue.</p>
      <div class="hero-actions">${heroActions}</div>
      ${heroNote}
    </div>
    <div class="handoff-example" aria-label="Example of a handoff from one assistant to another">
      <div class="example-top"><span class="example-mark">${BRAND_ICON} A HANDOFF</span></div>
      <div class="packet"><div class="packet-person"><span class="avatar" aria-hidden="true">T</span><div>tim <small>acme · Prepared in <b class="app">${CLAUDE_ICON}Claude Code</b></small></div></div>
        <h2>Q3 review, ready for the next step.</h2>
        <dl><dt>Goal</dt><dd>Finish the client’s quarterly review.</dd><dt>Decided</dt><dd>Keep the two flagged invoices separate.</dd><dt>Next step</dt><dd>Check the dates and draft the reply.</dd></dl>
        <ul class="file-tags" aria-label="Example original files"><li>vat-q3-summary.pdf</li><li>flagged-invoices.md</li></ul>
      </div>
      <div class="handoff-path" aria-hidden="true"><i></i> BRIEF + ORIGINAL FILES <span>↓</span><i></i></div>
      <div class="receive"><span class="receive-symbol" aria-hidden="true">↳</span><div><strong>“Continue my handoff.”</strong><p>Pick up in <b class="app">${OPENAI_ICON}Codex</b>, on another computer.</p></div></div>
    </div>
  </section>
  <section class="principles" aria-label="What travels with your work">
    <article><h2>The context, intact.</h2><p>Your prepared brief keeps the decisions, constraints, and next step together.</p></article>
    <article><h2>The original files.</h2><p>PDFs, images, and text travel with the brief, with checksums to verify the bytes.</p></article>
    <article><h2>Your own place to keep it.</h2><p>Run Handoff on your Cloudflare account. You choose who joins your team.</p></article>
  </section>
  <section id="use-cases" class="section" aria-labelledby="cases-title">
    <div class="section-head"><div><p class="eyebrow">Use cases</p><h2 id="cases-title">A better place to pick up.</h2></div><p>For your next assistant, your partner, or the people building alongside you.</p></div>
    <div class="cases">${USE_CASES.map(renderCase).join("\n")}</div>
    <p class="examples-note">${examplesLink}</p>
  </section>
  <section class="watch" id="walkthrough" aria-labelledby="watch-title">
    <div class="watch-copy"><p class="eyebrow">The idea in 38 seconds</p><h2 id="watch-title">See the work change hands.</h2><p>Prepare the context, send the brief and files, then continue in another assistant.</p></div>
    <figure class="video-frame"><video controls playsinline preload="metadata" src="/demo/handoff-demo.mp4" aria-label="Handoff walkthrough">
      Your browser does not support embedded video. <a href="/demo/handoff-demo.mp4">Download the walkthrough</a>.
      </video><figcaption><a href="/demo/handoff-demo.mp4">Open video ↗</a></figcaption></figure>
  </section>
  <section class="ownership" aria-labelledby="ownership-title"><div><p class="eyebrow">What gets shared</p><h2 id="ownership-title">Share the work you choose.</h2></div>
    <dl><div><dt>One task at a time</dt><dd>Send a prepared brief and selected files. Your whole conversation is not exported.</dd></div><div><dt>Your recipients</dt><dd>Send to yourself, a named teammate, or everyone in your team.</dd></div><div><dt>Expiry</dt><dd>Handoffs expire after ${PRIVATE_DEFAULT_EXPIRY_HOURS / 24} days by default on your own install${cfg.mode === "control" ? `, ${cfg.defaultExpiryHours} hours on the playground` : ""}. You can revoke a handoff before then.</dd></div></dl>
  </section>
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
