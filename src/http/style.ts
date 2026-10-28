/**
 * The look of Handoff's own pages: IBM Plex Sans and IBM Plex Mono,
 * ink on a grey-white ground, white panels with thin lines, ink for the main action, green for "works".
 * The fonts are served by this Worker from /fonts (copied from @fontsource by scripts/assets.mjs), so a
 * page sends no request to another host.
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

/** The console palette, light and dark. */
export const PALETTE = {
  light: {
    ground: "#f3f3f0", panel: "#ffffff", line: "#d6d6d1", lineSoft: "#e8e8e4",
    ink: "#1b1b1a", muted: "#5b5b57", faint: "#9a9a95",
    accent: "#1f5fbf", ok: "#2f7a3e", warn: "#b35c00", danger: "#b3261e", select: "#eef3fb",
  },
  dark: {
    ground: "#161615", panel: "#1f1f1e", line: "#3a3a38", lineSoft: "#2c2c2b",
    ink: "#ecece8", muted: "#a3a39e", faint: "#6e6e6a",
    accent: "#7aa7ff", ok: "#6cc27a", warn: "#f0a35a", danger: "#ff7b72", select: "#1e2a3f",
  },
} as const;

const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const vars = (p: (typeof PALETTE)["light" | "dark"]): string =>
  `--ground: ${p.ground}; --panel: ${p.panel}; --line: ${p.line}; --line-soft: ${p.lineSoft};
    --ink: ${p.ink}; --muted: ${p.muted}; --faint: ${p.faint};
    --accent: ${p.accent}; --ok: ${p.ok}; --warn: ${p.warn}; --danger: ${p.danger}; --select: ${p.select};`;

/** @font-face rules, colour tokens and the base body style. */
export const BASE_CSS = `${FACES.map(
  ([family, file, weight]) =>
    `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(/fonts/${file}.woff2) format("woff2"); unicode-range: ${LATIN}; }`,
).join("\n  ")}
  :root {
    color-scheme: light dark;
    --sans: ${SANS}; --mono: ${MONO};
    ${vars(PALETTE.light)}
  }
  @media (prefers-color-scheme: dark) {
    :root { ${vars(PALETTE.dark)} }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 15px/1.55 var(--sans);
         -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  a { color: inherit; text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 3px; }
  a:hover { color: var(--accent); text-decoration-color: currentColor; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
  .brand svg { width: 26px; height: 26px; flex: none; }`;

/** The console's outlined square, with the two arrows of a handoff. Drawn in the current text colour. */
export const BRAND_ICON =
  '<svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="59" height="59" rx="13"/><path d="M17 25h28m-8-8 8 8-8 8M47 39H19m8-8-8 8 8 8"/></svg>';

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${PALETTE.light.ink}"/><path d="M17 25h28m-8-8 8 8-8 8M47 39H19m8-8-8 8 8 8" fill="none" stroke="${PALETTE.light.ground}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const FAVICON_LINK = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}">`;
