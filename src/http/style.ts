/**
 * Threadpacket's Courier Hybrid visual language:
 * Warm archival stone (#faf9f5) and deep obsidian (#131312), IBM Plex Sans + IBM Plex Mono,
 * tactile 1px dot-grid stages with corner registration ticks, and high-contrast stamped courier bars.
 * Fonts are served by this Worker from /fonts (copied from @fontsource by scripts/assets.mjs).
 */

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

const FACES: Array<[family: string, file: string, weight: number]> = [
  ["IBM Plex Sans", "ibm-plex-sans-latin-400-normal", 400],
  ["IBM Plex Sans", "ibm-plex-sans-latin-500-normal", 500],
  ["IBM Plex Sans", "ibm-plex-sans-latin-600-normal", 600],
  ["IBM Plex Mono", "ibm-plex-mono-latin-400-normal", 400],
  ["IBM Plex Mono", "ibm-plex-mono-latin-500-normal", 500],
];

/** The font files that scripts/assets.mjs copies into public/fonts. */
export const FONT_FILES = FACES.map(([, file]) => `${file}.woff2`);

/** Preload hints for the faces that render the first screen. */
export const FONT_PRELOAD = ["ibm-plex-sans-latin-400-normal", "ibm-plex-sans-latin-600-normal", "ibm-plex-mono-latin-500-normal"]
  .map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`)
  .join("\n");

/** Courier Hybrid palette, light and dark. */
export const PALETTE = {
  light: {
    ground: "#faf9f5", panel: "#ffffff", subtle: "#f2f0e9", line: "#e2dfd6", lineSoft: "#eceae2",
    ink: "#181816", muted: "#66655f", faint: "#9b9991",
    accent: "#1d5bd6", ok: "#1d8348", warn: "#b35c00", danger: "#b3261e", select: "#eaf0fd",
  },
  dark: {
    ground: "#131312", panel: "#1b1b19", subtle: "#232320", line: "#30302c", lineSoft: "#252522",
    ink: "#efeee9", muted: "#9c9b94", faint: "#686761",
    accent: "#5591ff", ok: "#52c478", warn: "#f0a35a", danger: "#ff7b72", select: "#1c2840",
  },
} as const;

const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const vars = (p: (typeof PALETTE)["light" | "dark"]): string =>
  `--ground: ${p.ground}; --panel: ${p.panel}; --subtle: ${p.subtle}; --line: ${p.line}; --line-soft: ${p.lineSoft};
    --ink: ${p.ink}; --muted: ${p.muted}; --faint: ${p.faint};
    --accent: ${p.accent}; --ok: ${p.ok}; --warn: ${p.warn}; --danger: ${p.danger}; --select: ${p.select};`;

/** @font-face rules, colour tokens, and shared Courier tactile primitives. */
export const BASE_CSS = `${FACES.map(
  ([family, file, weight]) =>
    `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(/fonts/${file}.woff2) format("woff2"); unicode-range: ${LATIN}; }`,
).join("\n  ")}
  :root {
    color-scheme: light dark;
    --sans: ${SANS}; --mono: ${MONO};
    --shadow-sm: 0 1px 2px rgba(24,24,22,.04);
    --shadow-md: 0 14px 36px rgba(24,24,22,.06);
    ${vars(PALETTE.light)}
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --shadow-sm: 0 1px 2px rgba(0,0,0,.24);
      --shadow-md: 0 16px 40px rgba(0,0,0,.32);
      ${vars(PALETTE.dark)}
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 15px/1.52 var(--sans);
         -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  a { color: inherit; text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 3px; }
  a:hover { color: var(--accent); text-decoration-color: currentColor; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 600; font-size: 15.5px; letter-spacing: -.025em; }
  .brand svg { width: 23px; height: 23px; flex: none; }
  .stamp-bar { background: var(--ink); color: var(--ground); padding: 8px 16px; font: 500 11px/1.4 var(--mono);
               letter-spacing: .04em; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .dot-stage { position: relative; padding: 20px; border-radius: 16px; border: 1px solid var(--line);
               background-color: var(--subtle); background-image: radial-gradient(var(--faint) 0.75px, transparent 0.75px); background-size: 14px 14px; }
  .reg-tick { position: absolute; width: 9px; height: 9px; border-color: var(--muted); border-style: solid; pointer-events: none; }
  .reg-tick.tl { top: 8px; left: 8px; border-width: 1.5px 0 0 1.5px; }
  .reg-tick.tr { top: 8px; right: 8px; border-width: 1.5px 1.5px 0 0; }
  .reg-tick.bl { bottom: 8px; left: 8px; border-width: 0 0 1.5px 1.5px; }
  .reg-tick.br { bottom: 8px; right: 8px; border-width: 0 1.5px 1.5px 0; }`;

/** Corner registration marks for a .dot-stage container. */
export const REG_TICKS =
  '<i class="reg-tick tl" aria-hidden="true"></i><i class="reg-tick tr" aria-hidden="true"></i><i class="reg-tick bl" aria-hidden="true"></i><i class="reg-tick br" aria-hidden="true"></i>';

/** The Threadpacket mark: three thread/brief lines with the middle thread carrying the packet forward. */
export const BRAND_ICON =
  '<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="59" height="59" rx="13"/><path d="M16 21h16M16 32h32m-9.5-9.5L48 32l-9.5 9.5M16 43h16"/></svg>';

/** A document outline for file names (homepage example, packets, demo video). */
export const FILE_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 1.5h5l3.5 3.5v9.5h-8.5z"/><path d="M9 1.5V5h3.5"/></svg>';

/** The site icon. scripts/images.mjs writes it to docs/favicon.svg, with favicon.ico and apple-touch-icon.png. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${PALETTE.light.ink}"/><path d="M15 20h17M15 32h34m-10-10 10 10-10 10M15 44h17" fill="none" stroke="${PALETTE.light.ground}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Static files from public/ (npm run assets), so crawlers and connector lists that fetch the site icon find one. */
export const FAVICON_LINK = '<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';
