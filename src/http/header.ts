import { BRAND_ICON } from "./style";
import { CONTROL_CENTER_URL } from "../env";
import { CLOUDFLARE_ICON, GITHUB_ICON } from "./assistant-icons";

export const GITHUB_URL = "https://github.com/evgolsh/handoff";
export const DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/evgolsh/handoff";
/** The pages link here: the Worker counts the click (an anonymous "visit" event) and redirects to DEPLOY_URL. */
export const DEPLOY_PATH = "/deploy";

/** Public pages share the console's fonts and palette, with a wider layout. */
export const PAGE_HEADER_CSS = `
  :root { --gutter:clamp(20px,4.5vw,80px); }
  html { scroll-padding-top:32px; }
  body { min-width:320px; }
  .site-width { width:calc(100% - var(--gutter)*2); max-width:1440px; margin-inline:auto; }
  .page-header { display:flex; align-items:center; justify-content:space-between; gap:20px; min-height:72px; border-bottom:1px solid var(--line); }
  .page-header .brand { text-decoration:none; font-size:20px; letter-spacing:-.04em; min-height:44px; flex:none; }
  .page-header .brand svg { width:28px; height:28px; }
  .page-nav { display:flex; gap:20px; align-items:center; font-size:14px; }
  .page-nav a { text-decoration:none; }
  .page-nav .nav-link { display:inline-flex; align-items:center; gap:7px; color:var(--muted); padding-block:12px; white-space:nowrap; }
  .page-nav .nav-link:hover { color:var(--ink); }
  .page-nav .nav-link svg { width:16px; height:16px; flex:none; }
  .site-button { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:48px; padding:12px 20px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); font:500 14px/1.4 var(--sans); text-decoration:none; white-space:nowrap; }
  .site-button svg { width:17px; height:17px; flex:none; }
  .site-button.primary { background:var(--ink); border-color:var(--ink); color:var(--ground); }
  .site-button:hover { border-color:var(--accent); color:var(--accent); }
  .site-button.primary:hover { background:var(--accent); border-color:var(--accent); color:var(--ground); }
  .page-nav .site-button { min-height:38px; padding:8px 13px; gap:8px; }
  .deploy-label-short { display:none; }
  .eyebrow { font:500 11px/1.5 var(--mono); text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
  .site-footer { display:flex; align-items:center; justify-content:space-between; gap:24px; padding-block:30px; border-top:1px solid var(--line); font-size:13px; color:var(--muted); }
  .site-footer p { margin:0; }
  .site-footer nav { display:flex; flex-wrap:wrap; gap:12px 24px; }
  .site-footer a { text-decoration:none; white-space:nowrap; }
  .skip-link { position:absolute; top:8px; left:var(--gutter); padding:10px 16px; background:var(--ink); color:var(--ground); transform:translateY(-200%); z-index:10; }
  .skip-link:focus { transform:none; }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  @media(max-width:860px) {
    .page-nav { gap:14px; }
    .page-nav .nav-secondary { display:none; }
  }
  @media(max-width:640px) {
    .page-header { min-height:64px; gap:10px; }
    .page-header .brand { font-size:18px; gap:8px; }
    .page-header .brand svg { width:26px; height:26px; }
    .page-nav { gap:8px; font-size:13px; }
    .page-nav .nav-github { padding:9px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink); }
    .page-nav .nav-github-text { display:none; }
    .page-nav .site-button { padding:8px 11px; gap:6px; font-size:13px; }
    .deploy-label-long { display:none; }
    .deploy-label-short { display:inline; }
    .site-footer { align-items:flex-start; flex-direction:column; gap:14px; }
  }
  @media(prefers-reduced-motion:no-preference) { .site-button { transition:background .15s,color .15s,border-color .15s; } }
`;

export function pageHeader(current: "connect" | "use-cases" = "connect", opts: { active?: boolean; mode?: "private" | "control" } = {}): string {
  const active = opts.active ?? true;
  if (opts.mode === "private") {
    // A private install: its own Connect page and console, and where to read about Handoff.
    return `<a href="#main" class="skip-link">Skip to content</a>
  <header class="page-header site-width"><a class="brand" href="/" aria-label="Handoff">${BRAND_ICON}<span>Handoff</span></a>
    <nav class="page-nav" aria-label="Handoff">
      <a class="nav-link nav-secondary" href="${CONTROL_CENTER_URL}/" target="_blank" rel="noopener">About Handoff</a>
      <a class="nav-link nav-secondary" href="/console">Console</a>
      <a class="nav-link nav-github" href="${GITHUB_URL}" target="_blank" rel="noopener" aria-label="GitHub repository">${GITHUB_ICON}<span class="nav-github-text">GitHub</span></a>
      ${active ? `<a class="site-button primary" href="/connect"${current === "connect" ? ' aria-current="page"' : ""}>Connect <span aria-hidden="true">↗</span></a>` : ""}
    </nav></header>`;
  }
  // The control center: the homepage is the brand link; Connect and the playground only once it has an admin.
  return `<a href="#main" class="skip-link">Skip to content</a>
  <header class="page-header site-width"><a class="brand" href="/" aria-label="Handoff home">${BRAND_ICON}<span>Handoff</span></a>
    <nav class="page-nav" aria-label="Handoff">
      ${active ? `<a class="nav-link nav-secondary" href="/connect"${current === "connect" ? ' aria-current="page"' : ""}>Connect</a>` : ""}
      <a class="nav-link nav-secondary" href="/console">Team console</a>
      <a class="nav-link nav-github" href="${GITHUB_URL}" target="_blank" rel="noopener" aria-label="GitHub repository">${GITHUB_ICON}<span class="nav-github-text">GitHub</span></a>
      ${active ? `<a class="site-button nav-secondary" href="/join">Try the playground</a>` : ""}
      <a class="site-button primary" href="${DEPLOY_PATH}" target="_blank" rel="noopener">${CLOUDFLARE_ICON}<span class="deploy-label-long">Deploy to Cloudflare</span><span class="deploy-label-short">Deploy</span> <span aria-hidden="true">↗</span></a>
    </nav></header>`;
}

export function pageFooter(opts: { active?: boolean; mode?: "private" | "control" } = {}): string {
  const active = opts.active ?? true;
  // A private install's "/" is its Connect page, so it links to the control center for the rest.
  const links =
    opts.mode === "private"
      ? `<a href="${CONTROL_CENTER_URL}/" target="_blank" rel="noopener">About Handoff</a>${active ? '<a href="/connect">Connect</a>' : ""}<a href="/console">Console</a>`
      : `<a href="/">Home</a>${active ? '<a href="/join">Try the playground</a><a href="/connect">Connect</a>' : ""}<a href="/console">Team console</a>`;
  return `<footer class="site-footer site-width"><p>Handoff · Your context. Your files. Your Cloudflare account.</p>
    <nav aria-label="Footer">${links}<a href="${GITHUB_URL}" target="_blank" rel="noopener">GitHub</a><a href="${DEPLOY_PATH}" target="_blank" rel="noopener">Deploy to Cloudflare</a></nav></footer>`;
}
