import type { Config } from "../env";

/**
 * Small helpers that pages share with the agent files (src/http/agents.ts): where a page's Markdown version is,
 * the <head> tags that point agents and link previews at the right things, and Claude's install link.
 */

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The link that opens Claude's "Add custom connector" dialog with the name and address filled in. */
export function claudeInstallLink(mcpUrl: string): string {
  return `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Threadpacket&connectorUrl=${encodeURIComponent(mcpUrl)}`;
}

/** Public pages that have a Markdown version, and where it is. */
export function markdownTwin(cfg: Config, path: string): string | null {
  const hosted = cfg.mode === "control";
  if (path === "/" || path === "/use-cases") return hosted ? "/index.md" : null;
  if (path === "/connect") return "/connect.md";
  if (path === "/privacy") return "/privacy.md";
  if (path === "/terms") return hosted ? "/terms.md" : null;
  if (path === "/about") return hosted ? "/about.md" : null;
  if (path === "/contact") return hosted ? "/contact.md" : null;
  if (path === "/join") return hosted ? "/join.md" : null;
  return null;
}

/** The <link> tags for the same, for pages' <head>. */
export function discoveryHead(cfg: Config, path: string): string {
  const twin = markdownTwin(cfg, path);
  return `<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">${twin ? `<link rel="alternate" type="text/markdown" href="${twin}">` : ""}<link rel="ard" href="/.well-known/ard.json">`;
}

/** Open Graph and Twitter card tags. */
export function socialMeta(cfg: Config, title: string, description: string, path: string): string {
  const url = `${cfg.publicUrl}${path}`;
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Threadpacket">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(cfg.publicUrl)}/img/og.png">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("");
}
