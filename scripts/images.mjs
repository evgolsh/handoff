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
  html,body { margin:0; width:1200px; height:630px; overflow:hidden; background:var(--ground); color:var(--ink); }
  .stage { box-sizing:border-box; width:1200px; height:630px; padding:42px 48px; background-color:var(--subtle); background-image:radial-gradient(var(--faint) 0.9px, transparent 0.9px); background-size:16px 16px; display:flex; }
  .card { width:100%; background:var(--panel); border:1.5px solid var(--line); border-radius:18px; overflow:hidden; display:flex; flex-direction:column; justify-content:space-between; }
  .stamp { background:var(--ink); color:var(--ground); padding:14px 28px; font:500 18px var(--mono); letter-spacing:.05em; text-transform:uppercase; display:flex; justify-content:space-between; }
  .body { padding:44px 54px 48px; display:flex; flex-direction:column; justify-content:space-between; flex:1; }
  .brand { display:flex; align-items:center; gap:14px; font:600 30px var(--sans); letter-spacing:-.03em; }
  .brand svg { width:42px; height:42px; }
  h1 { font:600 78px/1.0 var(--sans); letter-spacing:-.05em; margin:0; }
  p { font:400 26px/1.42 var(--sans); color:var(--muted); margin:0; max-width:44ch; }
  .pills { display:flex; gap:14px; font:500 19px var(--mono); }
  .pills span { padding:7px 15px; border:1px solid var(--line); border-radius:999px; background:var(--ground); color:var(--ink); }
</style></head><body><div class="stage"><div class="card">
  <div class="stamp"><span>Packet // Claude → ChatGPT · Codex · Hermes</span><span>threadpacket.com</span></div>
  <div class="body">
    <div class="brand">${BRAND_ICON}<span>Threadpacket</span></div>
    <h1>From your AI to theirs.</h1>
    <p>Send a prepared brief and original files from your assistant to someone else’s.</p>
    <div class="pills"><span>No email required</span><span>No phone number</span><span>7-day auto-delete</span></div>
  </div>
</div></div></body></html>`;

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
  if (pages[path]) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(pages[path]);
  }
  const font = path.match(/^\/fonts\/([\w.-]+\.woff2)$/);
  if (font) {
    res.writeHead(200, { "content-type": "font/woff2" });
    return res.end(readFileSync(`public/fonts/${font[1]}`));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "threadpacket-images-"));

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

const ico = (pngs) => {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size % 256, e);
    head.writeUInt8(size % 256, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
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
  copyFileSyncIfPresent("docs/icon.png", "plugin/assets/icon.png");
  console.log("wrote docs/favicon.ico, docs/favicon.svg, plugin/assets/icon.png");
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

function copyFileSyncIfPresent(src, dst) {
  writeFileSync(dst, readFileSync(src));
}
