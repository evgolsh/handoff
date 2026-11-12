import { BRAND_ICON } from "./style";
import { CONTROL_CENTER_URL } from "../env";

export const GITHUB_URL = "https://github.com/evgolsh/threadpacket";
/** Installation guidance lives on the project site, not a private server's root. */
export const INSTALL_URL = `${CONTROL_CENTER_URL}/#install`;
export const DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/evgolsh/threadpacket";
/** The pages link here: the Worker counts the click (an anonymous "visit" event) and redirects to DEPLOY_URL. */
export const DEPLOY_PATH = "/deploy";

/** Minimal, airy top bar and single-line footer shared across public pages. */
export const PAGE_HEADER_CSS = `
  :root { --gutter:clamp(18px,3.5vw,40px); }
  html { scroll-padding-top:24px; }
  body { min-width:320px; }
  .site-width { width:calc(100% - var(--gutter)*2); max-width:1120px; margin-inline:auto; }
  .page-header { display:flex; align-items:center; justify-content:space-between; gap:14px; min-height:64px; }
  .page-header .brand { text-decoration:none; font-size:15.5px; font-weight:600; letter-spacing:-.025em; min-height:40px; flex:none; }
  .page-header .brand svg { width:23px; height:23px; }
  .page-nav { display:flex; gap:6px; align-items:center; font-size:13px; }
  .page-nav a { text-decoration:none; }
  .page-nav .nav-link { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 12px; border-radius:999px; color:var(--muted); font-weight:500; white-space:nowrap; }
  .page-nav .nav-link:hover,.page-nav .nav-link[aria-current=page] { color:var(--ink); background:var(--subtle); }
  .site-button { display:inline-flex; align-items:center; justify-content:center; gap:8px; height:42px; padding:0 19px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--ink); font:500 14px/1 var(--sans); text-decoration:none; white-space:nowrap; box-shadow:var(--shadow-sm); }
  .site-button svg { width:16px; height:16px; flex:none; }
  .site-button.primary { background:var(--accent); border-color:var(--accent); color:#fff; box-shadow:0 6px 20px rgba(29,91,214,.22); }
  .site-button:hover { border-color:var(--ink); color:var(--ink); }
  .site-button.primary:hover { filter:brightness(1.07); color:#fff; border-color:var(--accent); }
  .page-nav .site-button { height:34px; padding:0 15px; font-size:13px; background:var(--ink); border-color:var(--ink); color:var(--ground); box-shadow:none; }
  .page-nav .site-button:hover { background:var(--accent); border-color:var(--accent); color:#fff; }
  .eyebrow { font:500 11px/1.4 var(--mono); text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .site-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px 24px; margin-top:36px; padding:20px 0 34px; border-top:1px solid var(--line); font-size:12.5px; color:var(--muted); }
  .site-footer p { margin:0; }
  .site-footer nav { display:flex; flex-wrap:wrap; gap:10px 20px; }
  .site-footer a { text-decoration:none; white-space:nowrap; }
  .site-footer a:hover { color:var(--ink); }
  .skip-link { position:absolute; top:8px; left:var(--gutter); padding:8px 14px; border-radius:999px; background:var(--ink); color:var(--ground); transform:translateY(-200%); z-index:10; }
  .skip-link:focus { transform:none; }
  .sr-only { position:absolute; left:0; top:0; width:1px; height:1px; padding:0; margin:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media(max-width:560px) {
    .page-header { min-height:58px; gap:8px; }
    .page-nav { gap:2px; }
    .page-nav .nav-optional { display:none; }
    .page-nav .nav-link { padding:0 9px; font-size:12.5px; }
    .page-nav .site-button { padding:0 12px; font-size:12.5px; }
    .site-footer { flex-direction:column; align-items:flex-start; }
  }
  @media(prefers-reduced-motion:no-preference) { .site-button,.nav-link { transition:background .15s,color .15s,border-color .15s,filter .15s; } }
`;

export interface HeaderOpts {
  /** The server has an admin, so members can sign in and connect. */
  active?: boolean;
  mode?: "private" | "control";
  /** This browser has a session: Dashboard takes the place of Sign in. */
  signedIn?: boolean;
}

/** Sign in, or Dashboard once signed in: the way into the app. */
const appLink = (signedIn: boolean | undefined, cls = ""): string =>
  `<a${cls ? ` class="${cls}"` : ""} href="${signedIn ? "/packets" : "/login"}">${signedIn ? "Dashboard" : "Sign in"}</a>`;

export function pageHeader(current: "connect" | "use-cases" = "connect", opts: HeaderOpts = {}): string {
  const active = opts.active ?? true;
  if (opts.mode === "private") {
    return `<a href="#main" class="skip-link">Skip to content</a>
  <header class="page-header site-width"><a class="brand" href="/" aria-label="Threadpacket">${BRAND_ICON}<span>Threadpacket</span></a>
    <nav class="page-nav" aria-label="Threadpacket">
      <a class="nav-link nav-optional" href="${CONTROL_CENTER_URL}/" target="_blank" rel="noopener">About</a>
      ${active ? `<a class="nav-link" href="/connect"${current === "connect" ? ' aria-current="page"' : ""}>Setup</a>` : ""}
      ${opts.signedIn ? `<a class="site-button primary" href="/packets">Dashboard</a>` : appLink(false, "nav-link nav-secondary")}
    </nav></header>`;
  }
  const button = opts.signedIn
    ? `<a class="site-button primary" href="/packets">Dashboard</a>`
    : active
      ? current === "connect" ? "" : `<a class="site-button primary" href="/connect">Get started</a>`
      : `<a class="site-button primary" href="/#install">Self-host</a>`;
  return `<a href="#main" class="skip-link">Skip to content</a>
  <header class="page-header site-width"><a class="brand" href="/" aria-label="Threadpacket home">${BRAND_ICON}<span>Threadpacket</span></a>
    <nav class="page-nav" aria-label="Threadpacket">
      ${active ? `<a class="nav-link nav-optional" href="/#install">Self-host</a>${opts.signedIn ? `<a class="nav-link nav-secondary" href="/connect"${current === "connect" ? ' aria-current="page"' : ""}>Assistant setup</a>` : ""}` : ""}
      ${opts.signedIn ? "" : appLink(false, "nav-link nav-secondary")}
      ${button}
    </nav></header>`;
}

export function pageFooter(opts: HeaderOpts = {}): string {
  const active = opts.active ?? true;
  if (opts.mode === "private") {
    const links = `${active ? '<a href="/connect">Assistant setup</a>' : ""}${appLink(opts.signedIn)}<a href="${CONTROL_CENTER_URL}/" target="_blank" rel="noopener">About Threadpacket</a><a href="/privacy">Privacy</a><a href="${GITHUB_URL}" target="_blank" rel="noopener">GitHub</a>`;
    return `<footer class="site-footer site-width"><p>Threadpacket · Ephemeral packets on your Cloudflare account.</p>
    <nav aria-label="Footer">${links}</nav></footer>`;
  }
  const links = `${active ? `<a href="/connect">${opts.signedIn ? "Assistant setup" : "Get started"}</a>` : ""}${appLink(opts.signedIn)}<a href="/#install">Self-host</a><a href="/llms.txt">llms.txt</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${GITHUB_URL}" target="_blank" rel="noopener">GitHub</a>`;
  return `<footer class="site-footer site-width"><p>Threadpacket · Ephemeral packets between AI assistants.</p>
    <nav aria-label="Footer">${links}</nav></footer>`;
}
