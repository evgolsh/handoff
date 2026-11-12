// Copies the static files that the Worker serves from public/: the IBM Plex fonts (latin subset, OFL-1.1)
// for Threadpacket's pages. src/http/style.ts lists the same files.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

mkdirSync("public/fonts", { recursive: true });
mkdirSync("public/demo", { recursive: true });
rmSync("public/stytch.js", { force: true });
rmSync("public/demo/handoff-demo.mp4", { force: true });

const fonts = {
  "ibm-plex-sans": ["400", "500", "600"],
  "ibm-plex-mono": ["400", "500"],
};
for (const [family, weights] of Object.entries(fonts)) {
  for (const w of weights) {
    const file = `${family}-latin-${w}-normal.woff2`;
    copyFileSync(`node_modules/@fontsource/${family}/files/${file}`, `public/fonts/${file}`);
  }
}
copyFileSync("node_modules/@fontsource/ibm-plex-sans/LICENSE", "public/fonts/OFL.txt");

if (existsSync("docs/threadpacket-demo.mp4")) {
  copyFileSync("docs/threadpacket-demo.mp4", "public/demo/threadpacket-demo.mp4");
}

// Cloudflare's own "Deploy to Cloudflare" button (deploy.workers.cloudflare.com/button), served from here
// because the pages' CSP allows images only from this origin.
mkdirSync("public/img", { recursive: true });
copyFileSync("docs/deploy-to-cloudflare.svg", "public/img/deploy-to-cloudflare.svg");
copyFileSync("docs/og.png", "public/img/og.png");
copyFileSync("docs/icon.png", "public/img/icon.png");
for (const f of ["favicon.ico", "favicon.svg", "apple-touch-icon.png"]) copyFileSync(`docs/${f}`, `public/${f}`);

writeFileSync(
  "public/_headers",
  "/fonts/*\n  Cache-Control: public, max-age=604800\n/demo/*\n  Cache-Control: public, max-age=86400\n/img/*\n  Cache-Control: public, max-age=86400\n",
);

console.log("public/ updated: fonts, demo, img, _headers");
