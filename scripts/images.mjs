// Renders the images that link previews and directories show: docs/og.png (1200x630, for og:image) and
// docs/icon.png (512x512, for the MCP server card and directory listings). npm run assets copies them to
// public/img. Needs Google Chrome; set CHROME to use another binary.
//
//   node scripts/images.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_CSS, BRAND_ICON } from "../src/http/style.ts";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const og = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  html,body { margin:0; width:1200px; height:630px; overflow:hidden; background:#f3f3f0; color:#1b1b1a; }
  .card { box-sizing:border-box; width:1200px; height:630px; padding:72px 80px; display:flex; flex-direction:column; justify-content:space-between; border-top:8px solid var(--accent); }
  .brand { display:flex; align-items:center; gap:16px; font:500 34px var(--sans); letter-spacing:-.04em; }
  .brand svg { width:56px; height:56px; }
  h1 { font:500 76px/1.04 var(--sans); letter-spacing:-.055em; margin:0; max-width:15ch; }
  h1 span { color:#77746c; }
  p { font:400 28px/1.4 var(--sans); color:#55534d; margin:0; max-width:46ch; }
  .foot { display:flex; justify-content:space-between; align-items:end; font:500 24px var(--mono); color:var(--accent); }
  .foot span { color:#77746c; font-family:var(--sans); font-weight:400; }
</style></head><body><div class="card">
  <div class="brand">${BRAND_ICON}<span>Handoff</span></div>
  <div><h1>Hand your work to <span>someone else’s assistant.</span></h1></div>
  <p>Your notes and the original files, from your AI to theirs: Claude, ChatGPT, Codex. Free. No AI inside.</p>
  <div class="foot">handoff.infraworks.net<span>Open source · MIT</span></div>
</div></body></html>`;

const icon = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body { margin:0; width:512px; height:512px; overflow:hidden; background:transparent; }
  .i { width:512px; height:512px; border-radius:112px; background:#1b1b1a; color:#f3f3f0; display:flex; align-items:center; justify-content:center; }
  .i svg { width:340px; height:340px; } .i svg rect { display:none; }
</style></head><body><div class="i">${BRAND_ICON}</div></body></html>`;

const pages = { "/og.html": og, "/icon.html": icon };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pages[path]) return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pages[path]);
  const font = path.match(/^\/fonts\/([\w.-]+\.woff2)$/);
  if (font) return res.writeHead(200, { "content-type": "font/woff2" }).end(readFileSync(`public/fonts/${font[1]}`));
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "handoff-images-"));

// Async, so this process's server can answer Chrome while it renders.
const shot = (page, out, w, h, transparent = false) =>
  new Promise((resolve, reject) => {
    const args = ["--headless=new", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--force-color-profile=srgb",
      "--virtual-time-budget=3000", ...(transparent ? ["--default-background-color=00000000"] : []), `--window-size=${w},${h}`,
      `--screenshot=${out}`, `${base}${page}`];
    const p = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? (console.log(`wrote ${out}`), resolve()) : reject(new Error(`Chrome failed for ${page}: ${err}`))));
  });
try {
  await shot("/og.html", "docs/og.png", 1200, 630);
  await shot("/icon.html", "docs/icon.png", 512, 512, true);
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
