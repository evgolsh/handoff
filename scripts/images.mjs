// Renders the images that link previews and directories show: docs/og.png (1200x630, for og:image) and
// docs/icon.png (512x512, for the MCP server card and directory listings), and the site icons: docs/favicon.ico
// (16, 32 and 48 px), docs/favicon.svg and docs/apple-touch-icon.png (180 px, square: iOS rounds it). npm run
// assets copies them to public/. Needs Google Chrome; set CHROME to use another binary.
//
//   node scripts/images.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_CSS, BRAND_ICON, FAVICON_SVG } from "../src/http/style.ts";

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

// The app icon at any size: rounded like the brand mark, or square for iOS, which rounds it itself. `glyph` is the
// arrows' share of the tile: smaller on the large icons, as large as favicon.svg's on the small ones.
const iconPage = (size, radius, glyph = 340 / 512) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body { margin:0; width:${size}px; height:${size}px; overflow:hidden; background:transparent; }
  .i { width:${size}px; height:${size}px; border-radius:${radius}px; background:#1b1b1a; color:#f3f3f0; display:flex; align-items:center; justify-content:center; }
  .i svg { width:${size * glyph}px; height:${size * glyph}px; } .i svg rect { display:none; }
</style></head><body><div class="i">${BRAND_ICON}</div></body></html>`;

const ICO_SIZES = [16, 32, 48];
const pages = { "/og.html": og, "/icon.html": iconPage(512, 112), "/apple-touch-icon.html": iconPage(180, 0) };
for (const s of ICO_SIZES) pages[`/icon-${s}.html`] = iconPage(s, Math.round((s * 14) / 64), 1);
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
// An ICO file that holds PNG images, which every current browser reads.
const ico = (pngs) => {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size % 256, e);
    head.writeUInt8(size % 256, e + 1);
    head.writeUInt16LE(1, e + 4); // colour planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
};

try {
  await shot("/og.html", "docs/og.png", 1200, 630);
  await shot("/icon.html", "docs/icon.png", 512, 512, true);
  await shot("/apple-touch-icon.html", "docs/apple-touch-icon.png", 180, 180);
  const small = [];
  for (const s of ICO_SIZES) {
    const out = join(profile, `icon-${s}.png`);
    await shot(`/icon-${s}.html`, out, s, s, true);
    small.push({ size: s, data: readFileSync(out) });
  }
  writeFileSync("docs/favicon.ico", ico(small));
  writeFileSync("docs/favicon.svg", `${FAVICON_SVG}\n`);
  console.log("wrote docs/favicon.ico, docs/favicon.svg");
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
