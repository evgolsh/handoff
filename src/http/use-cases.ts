import { PRIVATE_DEFAULT_EXPIRY_HOURS, type Config } from "../env";
import { BASE_CSS, FAVICON_LINK, FILE_ICON, FONT_PRELOAD, REG_TICKS } from "./style";
import { DEPLOY_PATH, GITHUB_URL, PAGE_HEADER_CSS, pageFooter, pageHeader } from "./header";
import { CLAUDE_ICON, GITHUB_ICON, OPENAI_ICON } from "./assistant-icons";
import { discoveryHead, socialMeta } from "./meta";
import { homeJsonLd } from "./agents";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const days = (hours: number) => `${Math.round(hours / 24)} days`;

const PAGE_CSS = `
  p,h1,h2,h3,dl,dd { margin:0; }

  /* Centered Sparse Hero */
  .hero { max-width:760px; margin:0 auto; padding:clamp(32px,4.5vh,48px) 0 34px; text-align:center; }
  .app-thread { display:inline-flex; align-items:center; flex-wrap:wrap; justify-content:center; gap:7px; padding:5px 13px; border:1px solid var(--line); border-radius:999px; background:var(--panel); font:500 11.5px/1.35 var(--mono); color:var(--muted); margin-bottom:20px; box-shadow:var(--shadow-sm); }
  .app-thread i { color:var(--accent); font-style:normal; }
  .hero h1 { font-size:clamp(38px,5.4vw,64px); font-weight:600; letter-spacing:-.048em; line-height:1.03; text-wrap:balance; }
  .hero-lead { max-width:44ch; margin:14px auto 24px; font-size:clamp(16px,1.3vw,17.5px); line-height:1.5; color:var(--muted); }
  .hero-actions { display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:10px; }
  .hero-setup-note { margin-top:14px; font-size:12.5px; color:var(--muted); }

  /* Pure-CSS Radio Switcher inside the Tactile Dot-Grid Stage */
  .stage-radio { position:absolute; opacity:0; pointer-events:none; }
  .stage-top { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px 16px; margin-bottom:14px; }
  .stage-seg { display:inline-flex; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:3px; box-shadow:var(--shadow-sm); }
  .stage-seg label { cursor:pointer; font:500 12px/1 var(--sans); padding:7px 14px; border-radius:999px; color:var(--muted); user-select:none; white-space:nowrap; }
  .stage-seg label:hover { color:var(--ink); }
  .stage-caption { font:500 11px var(--mono); color:var(--muted); letter-spacing:.04em; text-transform:uppercase; }

  #stage-live:checked ~ .dot-stage .stage-seg label[for="stage-live"],
  #stage-install:checked ~ .dot-stage .stage-seg label[for="stage-install"] { background:var(--ink); color:var(--ground); }
  #stage-live:checked ~ .dot-stage .pane-install { display:none; }
  #stage-install:checked ~ .dot-stage .pane-live { display:none; }
  /* Direct navigation to /#install opens the Self-host pane automatically without JS */
  main:has(#install:target) #stage-live:checked ~ .dot-stage .pane-live { display:none; }
  main:has(#install:target) #stage-live:checked ~ .dot-stage .pane-install { display:block; }
  main:has(#install:target) #stage-live:checked ~ .dot-stage .stage-seg label[for="stage-live"] { background:transparent; color:var(--muted); }
  main:has(#install:target) #stage-live:checked ~ .dot-stage .stage-seg label[for="stage-install"] { background:var(--ink); color:var(--ground); }

  /* Courier Workspace Card */
  .courier-window { background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:var(--shadow-md); }
  .courier-grid { display:grid; grid-template-columns:218px minmax(0,1fr) 294px; min-height:420px; }

  .c-left { border-right:1px solid var(--line); padding:14px 10px; display:flex; flex-direction:column; gap:3px; background:color-mix(in srgb,var(--subtle) 48%,var(--panel)); }
  .c-kicker { font:500 10px var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--faint); padding:6px 8px 3px; }
  .c-row { padding:8px 10px; border-radius:7px; display:flex; flex-direction:column; gap:2px; }
  .c-row.on { background:var(--select); box-shadow:inset 2.5px 0 0 var(--accent); }
  .c-row strong { font-size:13px; font-weight:600; display:flex; justify-content:space-between; align-items:center; gap:6px; }
  .c-row span { font-size:11.5px; color:var(--muted); }
  .c-dot { color:var(--accent); font-size:10px; }
  .c-ok { color:var(--ok); font-size:11px; }

  .c-mid { padding:22px 26px; display:flex; flex-direction:column; gap:14px; min-width:0; }
  .c-meta { display:flex; flex-wrap:wrap; gap:6px; font:500 10.5px var(--mono); color:var(--muted); }
  .c-meta span { padding:2px 8px; border:1px solid var(--line); border-radius:4px; background:var(--ground); }
  .c-mid h2 { font-size:20px; font-weight:600; letter-spacing:-.025em; }
  .c-brief { font-size:14.5px; line-height:1.6; max-width:52ch; }
  .c-files { display:flex; flex-wrap:wrap; gap:8px; margin-top:auto; padding-top:14px; border-top:1px solid var(--line-soft); list-style:none; padding-left:0; }
  .c-files li { display:inline-flex; align-items:center; gap:7px; padding:6px 10px; border:1px solid var(--line); border-radius:6px; background:var(--ground); font:500 11.5px var(--mono); overflow-wrap:anywhere; }
  .c-files svg { width:13px; height:13px; flex:none; color:var(--accent); }
  .c-files em { font-style:normal; color:var(--faint); font-size:10.5px; }

  .c-right { border-left:1px solid var(--line); padding:15px; display:flex; flex-direction:column; gap:10px; background:color-mix(in srgb,var(--subtle) 30%,var(--panel)); }
  .chat-card { padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel); font-size:12.5px; line-height:1.48; }
  .chat-head { font:500 10.5px var(--mono); color:var(--muted); margin-bottom:5px; display:flex; align-items:center; justify-content:space-between; gap:6px; }
  .chat-app { display:inline-flex; align-items:center; gap:5px; color:var(--ink); font-weight:600; font-family:var(--sans); font-size:12px; }
  .chat-app svg { width:13px; height:13px; flex:none; }
  .chat-card.pickup { border-left:3px solid var(--accent); }
  .chat-card code { font:500 11px var(--mono); background:var(--ground); border:1px solid var(--line-soft); border-radius:4px; padding:0 4px; overflow-wrap:anywhere; }
  .receipt-line { font:500 11px var(--mono); color:var(--ok); padding:1px 4px; display:flex; align-items:center; gap:6px; }

  /* Self-host Pane inside the same Stage */
  .install-cols { padding:22px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; }
  .install-box { min-width:0; border:1px solid var(--line); border-radius:9px; padding:18px; background:var(--ground); display:flex; flex-direction:column; gap:9px; }
  .install-box .opt-k { font:500 10px var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .install-box h3 { font-size:16px; font-weight:600; letter-spacing:-.02em; }
  .install-box p { font-size:12.5px; line-height:1.52; color:var(--muted); }
  .install-box code { font:500 11px var(--mono); background:var(--panel); border:1px solid var(--line-soft); border-radius:4px; padding:1px 4px; overflow-wrap:anywhere; }
  .install-box pre { margin:2px 0; padding:10px 12px; background:var(--panel); border:1px solid var(--line); border-radius:6px; font:11px/1.6 var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; }
  .install-box pre code { border:0; padding:0; background:none; }
  .install-box blockquote { margin:2px 0; padding:9px 11px; background:var(--panel); border:1px solid var(--line); border-left:2.5px solid var(--accent); border-radius:6px; font-size:12px; line-height:1.48; overflow-wrap:anywhere; }
  .deploy-button { align-self:flex-start; line-height:0; border-radius:5px; }
  .deploy-button img { display:block; width:184px; height:39px; }
  .walkthrough-bar { padding:12px 22px 16px; border-top:1px solid var(--line-soft); font-size:12.5px; color:var(--muted); }
  .walkthrough-bar summary { cursor:pointer; font-weight:500; color:var(--ink); }
  .walkthrough-bar video { display:block; width:100%; max-width:720px; aspect-ratio:16/9; margin-top:12px; border:1px solid var(--line); border-radius:8px; background:#141413; }

  /* 3 Vertical-Hairline Facts */
  .facts { margin-top:26px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; }
  .fact { border-left:1.5px solid var(--ink); padding-left:14px; }
  .fact dt { font:500 11px var(--mono); text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin-bottom:4px; }
  .fact dd { font-size:13.5px; line-height:1.48; color:var(--ink); max-width:34ch; }

  @media(max-width:940px) {
    .courier-grid { grid-template-columns:1fr; }
    .c-left { border-right:0; border-bottom:1px solid var(--line); }
    .c-right { border-left:0; border-top:1px solid var(--line); }
    .install-cols { grid-template-columns:1fr; }
  }
  @media(max-width:720px) {
    .hero { padding-top:24px; }
    .dot-stage { padding:14px; }
    .c-mid,.install-cols { padding:16px; }
    .facts { grid-template-columns:1fr; gap:16px; }
  }
`;

/** The homepage, served by the hosted service (a private install redirects "/" to /connect). */
export function useCasesPage(cfg: Config, opts: { active?: boolean; signedIn?: boolean } = {}): string {
  const active = opts.active ?? true;
  const open = cfg.mode === "control" && active;
  const ttl = days(open ? cfg.defaultExpiryHours : PRIVATE_DEFAULT_EXPIRY_HOURS);
  const heroActions = open && opts.signedIn
    ? `<a class="site-button primary" href="/packets">Dashboard <span aria-hidden="true">→</span></a><a class="site-button" href="/connect">Assistant setup</a>`
    : open
      ? `<a class="site-button primary" href="/connect">Get started <span aria-hidden="true">→</span></a><a class="site-button" href="/join">Create a team</a>`
      : `<a class="site-button primary" href="#install"><span>Self-host Threadpacket</span> <span aria-hidden="true">↓</span></a><a class="site-button" href="${GITHUB_URL}" target="_blank" rel="noopener">${GITHUB_ICON}<span>GitHub</span></a>`;
  const setupNote = !open
    ? `<p class="hero-setup-note">Deployed this server? <a href="/console/setup">Complete initial setup ↗</a></p>`
    : "";

  const description =
    "Send a brief and original files from your AI assistant to someone else’s across Claude, ChatGPT, Codex, and Hermes. No email or phone number needed, and packets are deleted after 7 days.";

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Threadpacket: from your AI to theirs</title>
<meta name="description" content="${esc(description)}">
<meta name="keywords" content="Threadpacket, MCP server, send files to another AI assistant, share Claude context with ChatGPT, AI assistant packet">
<link rel="canonical" href="${esc(cfg.publicUrl)}/">
${discoveryHead(cfg, "/")}${socialMeta(cfg, "Threadpacket: from your AI to theirs", description, "/")}
${FAVICON_LINK}${FONT_PRELOAD}
${homeJsonLd(cfg)}
<style>${BASE_CSS}${PAGE_HEADER_CSS}${PAGE_CSS}</style></head><body>
${pageHeader("use-cases", { active, mode: cfg.mode, signedIn: opts.signedIn })}
<main id="main" class="site-width">
  <span id="install" aria-hidden="true"></span>
  <section class="hero" aria-labelledby="hero-title">
    <div class="app-thread">Claude <i>→</i> ChatGPT <i>·</i> Codex <i>·</i> Claude Code <i>·</i> Hermes</div>
    <h1 id="hero-title">From your AI to theirs.</h1>
    <p class="hero-lead">Send a prepared brief and original files from your assistant so your partner or teammate can continue in theirs.</p>
    <div class="hero-actions">${heroActions}</div>
    ${setupNote}
  </section>

  <input class="stage-radio" type="radio" name="stage" id="stage-live" ${open ? "checked" : ""}>
  <input class="stage-radio" type="radio" name="stage" id="stage-install" ${open ? "" : "checked"}>

  <section class="dot-stage" aria-label="Threadpacket workspace and self-hosting">
    ${REG_TICKS}
    <div class="stage-top">
      <div class="stage-seg" role="group" aria-label="Preview mode">
        <label for="stage-live">Live packet</label>
        <label for="stage-install">Self-host (Cloudflare)</label>
      </div>
      <span class="stage-caption">${open ? "No email required · No phone number · " : "MIT open source · "}${esc(ttl)} auto-delete</span>
    </div>

    <div class="courier-window pane-live">
      <div class="stamp-bar">
        <span>Packet // joe (Claude) → anna (ChatGPT)</span>
        <span>2 files · expires in ${esc(ttl)}</span>
      </div>
      <div class="courier-grid">
        <aside class="c-left" aria-label="Packets inbox">
          <div class="c-kicker">Packets · smiths</div>
          <div class="c-row on">
            <strong><span>Insurance renewal</span><span class="c-dot" aria-hidden="true">●</span></strong>
            <span>From joe · 2 files</span>
          </div>
          <div class="c-row">
            <strong><span>School trip forms</span><span class="c-dot" aria-hidden="true">●</span></strong>
            <span>From anna · 2 files</span>
          </div>
          <div class="c-kicker">Picked up</div>
          <div class="c-row">
            <strong><span>Kitchen quote</span><span class="c-ok" aria-hidden="true">✓</span></strong>
            <span>anna in ChatGPT · 1 h ago</span>
          </div>
          <div class="c-kicker">Ready to send</div>
          <div class="c-row">
            <strong><span>lease.pdf</span></strong>
            <span>Uploaded from phone</span>
          </div>
        </aside>

        <article class="c-mid">
          <div class="c-meta">
            <span>FROM: joe</span>
            <span>TO: anna</span>
            <span>AUTO-DELETES IN 7D</span>
          </div>
          <h2>Car insurance renewal</h2>
          <p class="c-brief">Compared all three renewal quotes. <strong>Offer B (€640/yr)</strong> keeps the same €300 glass and collision deductible for €140 less. Ask our current insurer to match €640 tomorrow; switch before Friday if they refuse.</p>
          <ul class="c-files" aria-label="Original files in the packet">
            <li>${FILE_ICON}<span>renewal-offer.pdf</span><em>412 KB</em></li>
            <li>${FILE_ICON}<span>comparison.md</span><em>2.1 KB</em></li>
          </ul>
        </article>

        <aside class="c-right" aria-label="Cross-assistant conversation">
          <div class="chat-card">
            <div class="chat-head"><b class="chat-app">${CLAUDE_ICON}Claude</b><span>joe</span></div>
            <p>“Send a packet to anna with both files. She’ll call the insurer tomorrow.”</p>
          </div>
          <div class="receipt-line"><span aria-hidden="true">✓</span><span>threadpacket_send · Car insurance renewal</span></div>
          <div class="chat-card pickup">
            <div class="chat-head"><b class="chat-app">${OPENAI_ICON}ChatGPT</b><span>anna</span></div>
            <p>“Continue the packet from joe.”</p>
          </div>
          <div class="chat-card">
            <div class="chat-head"><b class="chat-app">${OPENAI_ICON}ChatGPT</b><span>reply</span></div>
            <p>Joe chose Offer B (€640). I pulled policy #4419 from <code>renewal-offer.pdf</code> and wrote what to ask on the call.</p>
          </div>
        </aside>
      </div>
    </div>

    <div class="courier-window pane-install">
      <div class="stamp-bar">
        <span>Private server // your Cloudflare account (free plan)</span>
        <span>MIT open source</span>
      </div>
      <div class="install-cols">
        <article class="install-box">
          <span class="opt-k">01 · Browser</span>
          <h3>Deploy to Cloudflare</h3>
          <p>Creates Worker, D1, and KV on your account. Set <code>THREADPACKET_SETUP_CODE</code> (12+ chars), then finish at <code>/console/setup</code>.</p>
          <a class="deploy-button" href="${DEPLOY_PATH}" target="_blank" rel="noopener"><img src="/img/deploy-to-cloudflare.svg" width="184" height="39" alt="Deploy to Cloudflare"></a>
        </article>
        <article class="install-box">
          <span class="opt-k">02 · Coding agent</span>
          <h3>Ask a coding assistant</h3>
          <p>Paste into Claude Code, Codex, Gemini CLI, or Hermes:</p>
          <blockquote>Deploy https://github.com/evgolsh/threadpacket to my Cloudflare account following llms-install.md. My username is tim; add tom.</blockquote>
        </article>
        <article class="install-box">
          <span class="opt-k">03 · Terminal</span>
          <h3>Run setup yourself</h3>
          <p>Requires Git, Node.js 22+, and a free Cloudflare account:</p>
          <pre><code>git clone https://github.com/evgolsh/threadpacket.git
cd threadpacket && npm i
npm run setup -- --members=tim,tom</code></pre>
        </article>
      </div>
      <details class="walkthrough-bar" id="walkthrough">
        <summary>Watch 28-second private-server walkthrough</summary>
        <video muted loop playsinline controls preload="none" src="/demo/threadpacket-demo.mp4" aria-label="Threadpacket walkthrough"></video>
      </details>
    </div>
  </section>

  <dl class="facts">
    <div class="fact">
      <dt>Brief and original files</dt>
      <dd>PDFs, scans, and notes arrive byte-for-byte alongside your decisions.</dd>
    </div>
    <div class="fact">
      <dt>No email, no phone</dt>
      <dd>Just a username and an access code. No email address, phone, or Google login.</dd>
    </div>
    <div class="fact">
      <dt>Gone in ${esc(ttl)}, no AI</dt>
      <dd>Packets auto-delete after ${esc(ttl)}. Threadpacket makes no model calls.</dd>
    </div>
  </dl>
</main>${pageFooter({ active, mode: cfg.mode, signedIn: opts.signedIn })}</body></html>`;
}

export function useCasesHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}
