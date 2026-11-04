// Renders the homepage walkthrough, docs/handoff-demo.mp4: the story of the homepage example (tim hands off
// in Cowork, tom continues in ChatGPT), then the three ways to install.
//
//   npm run video                          render docs/handoff-demo.mp4 (needs Google Chrome and ffmpeg)
//   npm run video -- --still=18            write the frame at 18 s to a PNG and print its path
//
// The scene is one HTML page animated with CSS. Headless Chrome pauses every animation, sets it to each
// frame's time and takes a screenshot, so two renders give the same frames. Fonts, colours and icons come
// from the site's own modules. Set CHROME to use another Chrome binary.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_ICON, OPENAI_ICON } from "../../src/http/assistant-icons.ts";
import { BASE_CSS, BRAND_ICON, FILE_ICON } from "../../src/http/style.ts";

const W = 960, H = 540, SCALE = 2, FPS = 30, DURATION = 31;
const OUT = "docs/handoff-demo.mp4";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// When each thing happens, in seconds.
const T = {
  titleOut: 4.0,
  stage: 4.2, stageOut: 23.6,
  cap1: 4.4, cap1Out: 10.0,
  timAsks: 5.0,
  send: 6.2, brief1: 6.5, brief2: 6.9, sent: 7.8,
  sentReply: 8.3, files1: 8.9,
  cap2: 10.2, cap2Out: 13.4,
  path: 10.4, travel: 10.7, pathNote: 11.0,
  cap3: 13.6, cap3Out: 23.4,
  tomAsks: 14.0,
  read: 15.0, readDone: 16.0,
  files2: 16.4, same: 17.0,
  reply: 17.6,
  closing: 24.0, route1: 24.4, route2: 24.8, route3: 25.2, end: 26.0,
};

const FILES = ["vat-q3-summary.pdf", "flagged-invoices.md"];
const at = (s) => `--in:${s}s`;
const io = (a, b) => `--in:${a}s;--out:${b}s`;
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

const CSS = `
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body { position:relative; }
  p,h1,h2,h3 { margin:0; }
  .eyebrow { font:11px var(--mono); letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .bar { position:absolute; inset:0 0 auto; height:46px; padding:0 28px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--line); }
  .brand { font-size:14px; } .brand svg { width:22px; height:22px; }
  .url { font:12px var(--mono); color:var(--muted); }

  .title { position:absolute; left:72px; right:72px; top:122px; }
  .title h1 { font-size:46px; font-weight:500; line-height:1.08; letter-spacing:-.05em; margin:14px 0 20px; }
  .title h1 span { color:var(--muted); }
  .title .lead { font-size:18px; line-height:1.55; color:var(--muted); max-width:42ch; }

  .caption { position:absolute; left:0; right:0; top:62px; text-align:center; font-size:17px; font-weight:500; letter-spacing:-.01em; }

  .stage { position:absolute; left:24px; right:24px; top:104px; bottom:24px; display:grid; grid-template-columns:minmax(0,1fr) 120px minmax(0,1fr); }
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
           animation:travel 1.7s var(--in) both cubic-bezier(.55,0,.3,1); }
  .token svg:first-child { color:var(--ink); width:14px; height:14px; }
  .path-note { font-size:11px; line-height:1.45; color:var(--muted); }

  .closing { position:absolute; left:72px; right:72px; top:96px; }
  .closing h2 { font-size:36px; font-weight:500; letter-spacing:-.04em; line-height:1.1; margin:12px 0; }
  .closing .sub { font-size:16px; color:var(--muted); max-width:54ch; margin-bottom:26px; }
  .routes { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
  .route { min-height:112px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 18px; display:flex; flex-direction:column; align-items:flex-start; gap:12px; }
  .route h3 { font-size:16px; font-weight:500; }
  .route p { font-size:13px; line-height:1.5; color:var(--muted); }
  .route code { font:12px var(--mono); background:var(--ground); border:1px solid var(--line-soft); border-radius:5px; padding:6px 8px; white-space:nowrap; }
  .route img { display:block; }
  .end { margin-top:28px; font:500 18px var(--mono); }

  .in { animation:appear .45s var(--in) both cubic-bezier(.2,.7,.2,1); }
  .out { animation:vanish .45s var(--out) forwards; }
  .io { animation:appear .45s var(--in) both cubic-bezier(.2,.7,.2,1), vanish .45s var(--out) forwards; }
  .w { animation:word .25s var(--in) both; }
  @keyframes appear { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  @keyframes vanish { to { opacity:0; transform:translateY(-6px); } }
  @keyframes word { from { opacity:0; } to { opacity:1; } }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes travel {
    0% { left:-44px; opacity:0; transform:translateY(-50%) scale(.8); }
    15% { opacity:1; transform:translateY(-50%) scale(1); }
    85% { opacity:1; transform:translateY(-50%) scale(1); }
    100% { left:calc(100% + 8px); opacity:0; transform:translateY(-50%) scale(.9); }
  }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Handoff walkthrough</title>
<style>${BASE_CSS}${CSS}</style></head><body>
<header class="bar"><span class="brand">${BRAND_ICON}Handoff</span><span class="url">handoff.infraworks.net</span></header>

<section class="title out" style="--out:${T.titleOut}s">
  <p class="eyebrow">Open-source MCP server</p>
  <h1>Hand your work to<br><span>someone else’s assistant.</span></h1>
  <p class="lead">You sort out the details in Claude. Your partner says “continue the handoff from tim” in ChatGPT and gets your notes and the original files.</p>
</section>

<p class="caption io" style="${io(T.cap1, T.cap1Out)}">tim sorts out the Q3 VAT in Cowork, then hands it to tom.</p>
<p class="caption io" style="${io(T.cap2, T.cap2Out)}">Handoff keeps the brief and the original files. It makes no AI calls.</p>
<p class="caption io" style="${io(T.cap3, T.cap3Out)}">tom says one sentence in ChatGPT and gets tim’s notes and the PDFs.</p>

<section class="stage io" style="${io(T.stage, T.stageOut)}">
  <div class="chat">
    <div class="chat-app"><b class="app">${CLAUDE_ICON}Cowork</b><span>tim, on a Mac</span></div>
    <p class="msg-user in" style="${at(T.timAsks)}">Hand this off to tom. He’ll finish the VAT reply.</p>
    <div class="in" style="${at(T.send)}">
      <p class="tool-step">${toolState(T.send, T.sent)}<span>Send a handoff</span></p>
      <div class="brief"><b class="in" style="${at(T.brief1)}">Q3 VAT for the bakery</b><p class="in" style="${at(T.brief2)}">Fix the two flagged invoices, each one separately. Then check the dates and draft the reply.</p></div>
    </div>
    <p class="msg-assistant">${words("Sent to tom with both files.", T.sentReply)}</p>
    ${fileTags(T.files1)}
    <p class="composer">Reply to Claude</p>
  </div>
  <div class="path">
    <p class="path-label in" style="${at(T.path)}">BRIEF +<br>ORIGINAL FILES</p>
    <div class="track in" style="${at(T.path)}"><i></i><span class="token" style="${at(T.travel)}">${BRAND_ICON}${FILE_ICON}${FILE_ICON}</span><b>→</b></div>
    <p class="path-note in" style="${at(T.pathNote)}">Stored on your<br>Cloudflare account</p>
  </div>
  <div class="chat">
    <div class="chat-app"><b class="app">${OPENAI_ICON}ChatGPT</b><span>tom, on Windows</span></div>
    <p class="msg-user in" style="${at(T.tomAsks)}">Continue the handoff from tim.</p>
    <p class="tool-step in" style="${at(T.read)}">${toolState(T.read, T.readDone)}<span>Read a handoff</span><b class="in" style="${at(T.readDone)}">Q3 VAT for the bakery, 2 files</b></p>
    <div class="files-row">${fileTags(T.files2)}<span class="same in" style="${at(T.same)}">✓ Byte for byte</span></div>
    <p class="msg-assistant">${words("The brief says to fix the two flagged invoices separately. I’ll check their dates in `vat-q3-summary.pdf` first, then draft the reply.", T.reply)}</p>
    <p class="composer">Ask anything</p>
  </div>
</section>

<section class="closing in" style="${at(T.closing)}">
  <p class="eyebrow">Install</p>
  <h2>Install it once for your whole team.</h2>
  <p class="sub">Runs on your own Cloudflare account, on the free plan. It makes no AI calls and needs no API keys.</p>
  <div class="routes">
    <div class="route in" style="${at(T.route1)}"><h3>From your browser</h3><img src="/img/deploy-to-cloudflare.svg" width="148" height="31" alt=""></div>
    <div class="route in" style="${at(T.route2)}"><h3>Ask a coding assistant</h3><p>Claude Code, Codex, Gemini CLI or Hermes runs the setup for you.</p></div>
    <div class="route in" style="${at(T.route3)}"><h3>Run it yourself</h3><code>npm run setup</code></div>
  </div>
  <p class="end in" style="${at(T.end)}">handoff.infraworks.net</p>
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
