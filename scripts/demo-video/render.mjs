// Renders the homepage walkthrough, docs/handoff-demo.mp4, in four steps: install Handoff from a terminal,
// connect ChatGPT, hand off a brief and two files from Cowork, and continue in ChatGPT.
//
//   npm run video                          render docs/handoff-demo.mp4 (needs Google Chrome and ffmpeg)
//   npm run video -- --still=18            write the frame at 18 s to a PNG and print its path
//
// The scene is one HTML page animated with CSS. Headless Chrome pauses every animation, sets it to each
// frame's time and takes a screenshot, so two renders give the same frames. Fonts, colours and icons come
// from the site's own modules; the terminal shows what npm run setup prints. Set CHROME to use another
// Chrome binary.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_ICON, OPENAI_ICON } from "../../src/http/assistant-icons.ts";
import { BASE_CSS, BRAND_ICON, FILE_ICON } from "../../src/http/style.ts";

const W = 960, H = 540, SCALE = 2, FPS = 30, DURATION = 29;
const OUT = "docs/handoff-demo.mp4";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "https://handoff.acme.workers.dev";

// When each thing happens, in seconds.
const T = {
  // 1. Install
  install: 0, cmd1: 0.3, cmd2: 1.5, cmd3: 2.1, out1: 3.1, out2: 3.5, out3: 3.9, out4: 4.3, out5: 4.7,
  live: 5.5, codes: 6.5, installOut: 8.4,
  // 2. Connect
  connect: 8.6, dialog: 8.8, name: 9.2, url: 9.6, oauth: 10.7, create: 11.1,
  signin: 11.5, user: 11.9, code: 12.3, allow: 12.9, connected: 13.4, connectOut: 14.4,
  // 3. Send
  send: 14.6, timAsks: 15.0, sendTool: 15.9, brief1: 16.2, brief2: 16.5, sent: 17.3, sentReply: 17.7, files1: 18.2,
  path: 19.0, travel: 19.2,
  // 4. Continue
  cont: 20.7, tomAsks: 20.9, read: 21.7, readDone: 22.5, files2: 22.8, same: 23.2, reply: 23.7,
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FILES = ["vat-q3-summary.pdf", "flagged-invoices.md"];
const at = (s) => `--in:${s}s`;
const io = (a, b) => `--in:${a}s;--out:${b}s`;
// Monospace text typed out one character at a time.
const type = (text, start, perSecond = 45) =>
  `<span class="type" style="${at(start)};--n:${text.length};--d:${(text.length / perSecond).toFixed(2)}s">${esc(text)}</span>`;
const line = (start, html) => `<div class="in" style="${at(start)}">${html}</div>`;
const fileTags = (start) =>
  `<ul class="file-tags">${FILES.map((f, i) => `<li class="in" style="${at(start + i * 0.2)}">${FILE_ICON}${f}</li>`).join("")}</ul>`;
// The assistant's reply appears word by word. A word in backticks is a file name.
const words = (text, start, step = 0.055) =>
  text
    .split(" ")
    .map((w, i) => {
      const inner = w.startsWith("`") ? `<code>${w.replace(/`/g, "")}</code>` : w;
      return `<span class="w" style="${at((start + i * step).toFixed(3))}">${inner}</span>`;
    })
    .join(" ");
const toolState = (start, done) =>
  `<span class="state"><i class="spin" style="${io(start, done)}"></i><i class="done in" style="${at(done)}">✓</i></span>`;
const STEPS = [
  ["Install", T.install, T.connect],
  ["Connect", T.connect, T.send],
  ["Send", T.send, T.cont],
  ["Continue", T.cont, DURATION + 1],
];

const CSS = `
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body { position:relative; }
  p,h1,h2,h3 { margin:0; }
  .bar { position:absolute; inset:0 0 auto; height:46px; padding:0 24px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
  .brand { font-size:14px; } .brand svg { width:22px; height:22px; }
  .url { font:12px var(--mono); color:var(--muted); }
  .steps { display:flex; gap:6px; }
  .tab { position:relative; padding:5px 11px; border-radius:6px; font-size:12px; color:var(--muted); }
  .tab b { font:500 11px var(--mono); margin-right:6px; color:var(--faint); }
  .tab i { position:absolute; inset:0; border:1px solid var(--line); border-radius:6px; background:var(--panel); z-index:-1; }
  .tab .on { position:absolute; inset:0; padding:5px 11px; color:var(--ink); font-weight:500; }
  .tab .off { animation:hide .25s var(--in) forwards, show .25s var(--out) forwards; }
  .tab .on b { color:var(--accent); }
  .caption { position:absolute; left:0; right:0; top:62px; text-align:center; font-size:17px; font-weight:500; letter-spacing:-.01em; }
  .scene { position:absolute; left:24px; right:24px; top:104px; bottom:24px; }

  .term { height:100%; background:#141413; border-radius:10px; box-shadow:0 12px 28px #0000001a; overflow:hidden; }
  .term-top { display:flex; align-items:center; gap:7px; padding:10px 14px; background:#1f1f1e; font:11px var(--mono); color:#8f8f8a; }
  .term-top i { width:10px; height:10px; border-radius:50%; background:#3a3a38; }
  .term-top span { margin-left:8px; }
  .term-body { padding:14px 18px; font:12.5px/1.65 var(--mono); color:#d8d8d3; white-space:pre; }
  .term-body .p { color:#7aa7ff; }
  .term-body .ok { color:#6cc27a; }
  .term-body .dim { color:#8f8f8a; }
  .term-body .hi { color:#ecece8; font-weight:500; }
  .type { display:inline-block; vertical-align:bottom; overflow:hidden; white-space:pre; width:0;
          animation:typing var(--d) steps(var(--n), end) var(--in) both; }

  .connect { height:100%; display:grid; grid-template-columns:1fr 1fr; gap:24px; align-items:center; }
  .dialog,.signin { background:var(--panel); border:1px solid var(--line); border-radius:10px; box-shadow:0 12px 28px #0000000a; }
  .dialog { padding:16px 20px 18px; display:flex; flex-direction:column; gap:12px; }
  .dialog-top { display:flex; align-items:center; gap:8px; padding-bottom:12px; border-bottom:1px solid var(--line-soft); font-size:13px; font-weight:600; }
  .dialog-top svg { width:16px; height:16px; }
  .field label { display:block; font-size:12px; font-weight:500; margin-bottom:5px; }
  .input { min-height:34px; padding:8px 11px; border:1px solid var(--line); border-radius:6px; background:var(--ground); font:13px/1.3 var(--mono); }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .btn { display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:8px 16px; border-radius:6px; background:var(--ink); color:var(--ground); font-size:13px; font-weight:500; }
  .press { animation:press .35s var(--in) both; }
  .connected { font-size:13px; font-weight:500; color:var(--ok); }
  .signin-wrap { display:flex; flex-direction:column; gap:6px; }
  .signin-wrap .brand { font-size:16px; margin-bottom:2px; display:flex; align-items:center; gap:9px; font-weight:600; }
  .signin-wrap .tagline { font-size:13px; color:var(--muted); margin-bottom:10px; }
  .signin { padding:18px; display:flex; flex-direction:column; gap:12px; }
  .signin .meta { font-size:12.5px; line-height:1.45; color:var(--muted); }
  .signin .meta strong { color:var(--ink); }
  .signin .meta code { font:12px var(--mono); }
  .signin .btn { width:100%; }

  .stage { height:100%; display:grid; grid-template-columns:minmax(0,1fr) 120px minmax(0,1fr); }
  .chat { min-width:0; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 18px 14px; box-shadow:0 12px 28px #0000000a; display:flex; flex-direction:column; gap:11px; }
  .chat-app { display:flex; justify-content:space-between; align-items:center; padding-bottom:10px; border-bottom:1px solid var(--line-soft); font-size:12px; color:var(--muted); }
  .app { display:inline-flex; align-items:center; gap:6px; color:var(--ink); font-weight:600; font-size:13px; }
  .app svg { width:16px; height:16px; flex:none; }
  .msg-user { align-self:flex-end; max-width:92%; padding:8px 13px; background:var(--ground); border:1px solid var(--line-soft); border-radius:16px 16px 4px 16px; font-size:14px; line-height:1.45; }
  .tool-step { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); }
  .tool-step b { color:var(--ink); font-weight:500; }
  .state { position:relative; width:14px; height:14px; flex:none; }
  .state i { position:absolute; inset:0; font-style:normal; }
  .spin { border:2px solid var(--line); border-top-color:var(--accent); border-radius:50%;
          animation:spin .8s linear infinite, vanish .2s var(--out) forwards; }
  .done { color:var(--ok); font-size:13px; line-height:14px; font-weight:600; text-align:center; }
  .brief { margin:8px 0 0 22px; padding:9px 12px; border-left:2px solid var(--accent); background:var(--ground); border-radius:0 6px 6px 0; font-size:13px; line-height:1.5; }
  .brief b { display:block; font-weight:500; }
  .brief p { margin-top:2px; color:var(--muted); }
  .msg-assistant { font-size:14px; line-height:1.55; }
  .msg-assistant code { font:500 13px var(--mono); white-space:nowrap; }
  .file-tags { display:flex; gap:6px; flex-wrap:wrap; list-style:none; margin:0; padding:0; }
  .file-tags li { display:inline-flex; align-items:center; gap:6px; font:500 11px/1.5 var(--mono); padding:5px 8px; background:var(--ground); border:1px solid var(--line); border-radius:5px; }
  .file-tags svg,.token svg { width:13px; height:13px; flex:none; color:var(--accent); }
  .files-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .same { font-size:12px; font-weight:500; color:var(--ok); }
  .composer { margin-top:auto; padding:9px 14px; border:1px solid var(--line); border-radius:18px; font-size:13px; color:var(--faint); }
  .path { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:0 4px; text-align:center; }
  .path-label { font:500 11px/1.5 var(--mono); letter-spacing:.06em; color:var(--accent); }
  .track { position:relative; width:100%; height:30px; }
  .track > i { position:absolute; left:0; right:12px; top:50%; height:1px; background:var(--accent); opacity:.45; }
  .track > b { position:absolute; right:0; top:50%; transform:translateY(-55%); color:var(--accent); font-size:15px; font-weight:400; }
  .token { position:absolute; top:50%; display:flex; gap:3px; align-items:center; padding:5px 7px; background:var(--panel); border:1px solid var(--accent); border-radius:7px; box-shadow:0 4px 12px #1f5fbf26;
           animation:travel 1.5s var(--in) both cubic-bezier(.55,0,.3,1); }
  .token svg:first-child { color:var(--ink); width:14px; height:14px; }
  .path-note { font-size:11px; line-height:1.45; color:var(--muted); }

  .in { animation:appear .4s var(--in) both cubic-bezier(.2,.7,.2,1); }
  .io { animation:appear .4s var(--in) both cubic-bezier(.2,.7,.2,1), vanish .35s var(--out) forwards; }
  .fade { animation:show .25s var(--in) both, hide .25s var(--out) forwards; }
  .w { animation:show .25s var(--in) both; }
  @keyframes appear { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes vanish { to { opacity:0; transform:translateY(-6px); } }
  @keyframes show { from { opacity:0; } to { opacity:1; } }
  @keyframes hide { to { opacity:0; } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes typing { from { width:0; } to { width:calc(var(--n) * 1ch); } }
  @keyframes press { 0% { transform:none; } 40% { transform:scale(.95); background:var(--accent); } 100% { transform:none; background:var(--accent); } }
  @keyframes travel {
    0% { left:-44px; opacity:0; transform:translateY(-50%) scale(.8); }
    15% { opacity:1; transform:translateY(-50%) scale(1); }
    85% { opacity:1; transform:translateY(-50%) scale(1); }
    100% { left:calc(100% + 8px); opacity:0; transform:translateY(-50%) scale(.9); }
  }
`;

const steps = STEPS.map(
  ([name, from, to], i) =>
    `<span class="tab"><i class="fade" style="${io(from, to)}"></i><span class="off" style="${io(from, to)}"><b>${i + 1}</b>${name}</span><span class="on fade" style="${io(from, to)}"><b>${i + 1}</b>${name}</span></span>`,
).join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Handoff walkthrough</title>
<style>${BASE_CSS}${CSS}</style></head><body>
<header class="bar"><span class="brand">${BRAND_ICON}Handoff</span><nav class="steps">${steps}</nav><span class="url">handoff.infraworks.net</span></header>

<p class="caption io" style="${io(T.install + 0.01, T.installOut)}">Install once on your own Cloudflare account. Free plan, no card.</p>
<section class="scene io" style="${io(T.install + 0.01, T.installOut)}">
  <div class="term">
    <div class="term-top"><i></i><i></i><i></i><span>tim’s terminal</span></div>
    <div class="term-body">${[
      line(T.cmd1, `<span class="p">$</span> ${type("git clone https://github.com/evgolsh/handoff.git && cd handoff", T.cmd1, 60)}`),
      line(T.cmd2, `<span class="p">$</span> ${type("npm install", T.cmd2, 30)}`),
      line(T.cmd3, `<span class="p">$</span> ${type("npm run setup -- --members=tim,tom", T.cmd3, 45)}`),
      line(T.out1, `<span class="dim">Signing in to Cloudflare...</span>`),
      line(T.out2, `Database:  handoff`),
      line(T.out3, `Files:     KV namespace handoff-FILES`),
      line(T.out4, `Schema:    ready`),
      line(T.out5, `<span class="dim">Deploying...</span>`),
      line(T.live, `\n<span class="ok">Handoff is live at ${URL_}</span>`),
      line(T.live + 0.2, `  Server address for assistants:  <span class="hi">${URL_}/mcp</span>`),
      line(T.live + 0.4, `  Setup for each assistant:       ${URL_}/connect`),
      line(T.live + 0.6, `  Console:                        ${URL_}/console`),
      line(T.codes, `\nSign-in details, shown once. Save them in a password manager:`),
      line(T.codes + 0.2, `  tim              <span class="hi">••••••••••••••</span>`),
      line(T.codes + 0.4, `  tom              <span class="hi">••••••••••••••</span>`),
    ].join("")}</div>
  </div>
</section>

<p class="caption io" style="${io(T.connect, T.connectOut)}">tom adds the server to ChatGPT and signs in with his username and access code.</p>
<section class="scene io" style="${io(T.connect, T.connectOut)}">
  <div class="connect">
    <div class="dialog in" style="${at(T.dialog)}">
      <div class="dialog-top">${OPENAI_ICON}ChatGPT: Add custom MCP server</div>
      <div class="field"><label>Name</label><div class="input">${type("Handoff", T.name, 25)}</div></div>
      <div class="field"><label>Server URL</label><div class="input">${type(`${URL_}/mcp`, T.url, 40)}</div></div>
      <div class="field"><label>Authentication</label><div class="input"><span class="in" style="${at(T.oauth)}">OAuth</span></div></div>
      <div class="row"><span class="connected in" style="${at(T.connected)}">✓ Handoff connected</span><span class="btn press" style="${at(T.create)}">Create</span></div>
    </div>
    <div class="signin-wrap in" style="${at(T.signin)}">
      <div class="brand">${BRAND_ICON}<span>Handoff</span></div>
      <p class="tagline">Hand your work to someone else’s assistant.</p>
      <div class="signin">
        <p class="meta"><strong>ChatGPT</strong> asks to use Handoff as you. After you sign in it returns to <code>chatgpt.com</code>.</p>
        <div class="field"><label>Username</label><div class="input">${type("tom", T.user, 12)}</div></div>
        <div class="field"><label>Access code</label><div class="input">${type("••••••••••••••", T.code, 40)}</div></div>
        <span class="btn press" style="${at(T.allow)}">Sign in and allow</span>
      </div>
    </div>
  </div>
</section>

<p class="caption io" style="${io(T.send, T.cont - 0.2)}">tim sorts out the Q3 VAT in Cowork, then hands it to tom with the files.</p>
<p class="caption io" style="${io(T.cont, DURATION + 1)}">tom continues in ChatGPT with tim’s notes and the original files.</p>
<section class="scene in" style="${at(T.send)}">
  <div class="stage">
    <div class="chat">
      <div class="chat-app"><b class="app">${CLAUDE_ICON}Cowork</b><span>tim, on a Mac</span></div>
      <p class="msg-user in" style="${at(T.timAsks)}">Hand this off to tom. He’ll finish the VAT reply.</p>
      <div class="in" style="${at(T.sendTool)}">
        <p class="tool-step">${toolState(T.sendTool, T.sent)}<span>Send a handoff</span></p>
        <div class="brief"><b class="in" style="${at(T.brief1)}">Q3 VAT for the bakery</b><p class="in" style="${at(T.brief2)}">Fix the two flagged invoices, each one separately. Then check the dates and draft the reply.</p></div>
      </div>
      <p class="msg-assistant">${words("Sent to tom with both files.", T.sentReply)}</p>
      ${fileTags(T.files1)}
      <p class="composer">Reply to Claude</p>
    </div>
    <div class="path">
      <p class="path-label in" style="${at(T.path)}">BRIEF +<br>ORIGINAL FILES</p>
      <div class="track in" style="${at(T.path)}"><i></i><span class="token" style="${at(T.travel)}">${BRAND_ICON}${FILE_ICON}${FILE_ICON}</span><b>→</b></div>
      <p class="path-note in" style="${at(T.path + 0.3)}">Stored on your<br>Cloudflare account</p>
    </div>
    <div class="chat">
      <div class="chat-app"><b class="app">${OPENAI_ICON}ChatGPT</b><span>tom, on Windows</span></div>
      <p class="msg-user in" style="${at(T.tomAsks)}">Continue the handoff from tim.</p>
      <p class="tool-step in" style="${at(T.read)}">${toolState(T.read, T.readDone)}<span>Read a handoff</span><b class="in" style="${at(T.readDone)}">Q3 VAT for the bakery, 2 files</b></p>
      <div class="files-row">${fileTags(T.files2)}<span class="same in" style="${at(T.same)}">✓ Byte for byte</span></div>
      <p class="msg-assistant">${words("The brief says to fix the two flagged invoices separately. I’ll check their dates in `vat-q3-summary.pdf` first, then draft the reply.", T.reply)}</p>
      <p class="composer">Ask anything</p>
    </div>
  </div>
</section>
</body></html>`;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
if (!existsSync("public/fonts")) fail("public/fonts is missing: run npm run assets first.");
if (!existsSync(CHROME)) fail(`Chrome not found at ${CHROME}. Set CHROME to its path.`);
const still = process.argv.find((a) => a.startsWith("--still="))?.slice("--still=".length);
if (still === undefined && spawnSync("ffmpeg", ["-version"]).status !== 0) fail("ffmpeg not found (macOS: brew install ffmpeg).");

// Serve the page, the fonts and the Deploy button image from one local origin.
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path === "/") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  const font = path.match(/^\/fonts\/([\w.-]+\.woff2)$/);
  if (font) return res.writeHead(200, { "content-type": "font/woff2" }).end(readFileSync(join("public/fonts", font[1])));
  if (path === "/img/deploy-to-cloudflare.svg")
    return res.writeHead(200, { "content-type": "image/svg+xml" }).end(readFileSync("docs/deploy-to-cloudflare.svg"));
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), "handoff-video-chrome-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--force-color-profile=srgb", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const browserUrl = await new Promise((resolve, reject) => {
  let log = "";
  chrome.stderr.on("data", (d) => {
    log += d;
    const m = log.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code}):\n${log}`)));
});
const page = await (await fetch(`http://127.0.0.1:${new URL(browserUrl).port}/json/new?about:blank`, { method: "PUT" })).json();

// A minimal Chrome DevTools Protocol client.
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let seq = 0;
const pending = new Map();
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`));
    else p.resolve(m.result);
  } else if (waiting.has(m.method)) {
    waiting.get(m.method)(m.params);
    waiting.delete(m.method);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method) => new Promise((resolve) => waiting.set(method, resolve));
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: `${origin}/` });
  await loaded;
  await evaluate(`Promise.all([
    ...["400 1em 'IBM Plex Sans'", "500 1em 'IBM Plex Sans'", "600 1em 'IBM Plex Sans'", "400 1em 'IBM Plex Mono'", "500 1em 'IBM Plex Mono'"].map((f) => document.fonts.load(f)),
    ...[...document.images].map((i) => i.decode()),
  ]).then(() => true)`);
  // Pause every animation and set it to one moment; wait two frames so the screenshot shows it.
  await evaluate(`window.seek = (ms) => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
  }; true`);
  const frame = async (seconds) => {
    await evaluate(`seek(${seconds * 1000})`);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  };

  if (still !== undefined) {
    const out = join(tmpdir(), `handoff-demo-${still}s.png`);
    writeFileSync(out, await frame(Number(still)));
    console.log(out);
  } else {
    const dir = mkdtempSync(join(tmpdir(), "handoff-video-frames-"));
    const total = Math.round(DURATION * FPS);
    for (let i = 0; i < total; i++) {
      writeFileSync(join(dir, `${String(i).padStart(5, "0")}.png`), await frame(i / FPS));
      if (i % FPS === 0) process.stdout.write(`\rframes: ${i / FPS} of ${DURATION} s`);
    }
    process.stdout.write(`\rframes: ${DURATION} of ${DURATION} s\n`);
    const enc = spawnSync(
      "ffmpeg",
      ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(dir, "%05d.png"), "-c:v", "libx264", "-preset", "slow",
        "-crf", "20", "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT],
      { stdio: "inherit" },
    );
    rmSync(dir, { recursive: true, force: true });
    if (enc.status !== 0) throw new Error("ffmpeg failed");
    console.log(`${OUT} written`);
  }
} finally {
  ws.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill();
  await exited;
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
