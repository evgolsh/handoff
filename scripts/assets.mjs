// Copies the static files that the Worker serves from public/: the IBM Plex fonts (latin subset, OFL-1.1)
// for Handoff's pages. src/http/style.ts lists the same files.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

mkdirSync("public/fonts", { recursive: true });
mkdirSync("public/demo", { recursive: true });
// The Stytch SDK was served from here until 2026-10-26; never deploy a stale copy.
rmSync("public/stytch.js", { force: true });

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

if (existsSync("docs/handoff-demo.mp4")) {
  copyFileSync("docs/handoff-demo.mp4", "public/demo/handoff-demo.mp4");
}

// Font file names carry no version, so cache them for a week rather than for ever.
writeFileSync(
  "public/_headers",
  "/fonts/*\n  Cache-Control: public, max-age=604800\n/demo/*\n  Cache-Control: public, max-age=86400\n",
);

console.log("public/ updated: fonts, demo, _headers");
