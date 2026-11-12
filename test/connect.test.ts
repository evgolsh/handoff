import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import worker from "../src/index";
import { ORIGIN } from "./helpers";
import { FONT_FILES } from "../src/http/style";
import { DEPLOY_PATH, INSTALL_URL, GITHUB_URL } from "../src/http/header";

/** The homepage is served by the control center (THREADPACKET_MODE=control); a private install sends / to /connect. */
const control = { ...env, THREADPACKET_MODE: "control" };
const home = (path = "/") => worker.fetch(new Request(`${ORIGIN}${path}`), control, createExecutionContext());

describe("connect and homepage (Courier Hybrid)", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES ('tim', 's', 'h', '2026-10-27T00:00:00Z')"),
      env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES ('tim')"),
    ]);
  });

  it("/connect shows the stamped MCP server bar and setup steps for each host on an active instance", async () => {
    const res = await SELF.fetch(`${ORIGIN}/connect`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(`data-copy="${ORIGIN}/mcp"`);
    expect(html).toContain(`claude mcp add --transport http --scope user threadpacket ${ORIGIN}/mcp`);
    expect(html).toContain(`hermes mcp add threadpacket --url ${ORIGIN}/mcp --auth oauth`);
    expect(html).toContain(`codex mcp add threadpacket --url ${ORIGIN}/mcp`);
    for (const host of ["Claude Code", "Hermes", "Claude", "Codex", "ChatGPT"]) {
      expect(html).toContain(`<span class="tab-name">${host}</span>`);
    }
    const tags = [...html.matchAll(/<span class="badge" title="([^"]+)"><span class="dot [a-z]+" aria-hidden="true"><\/span>([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
    expect(tags).toEqual(Array(5).fill(["Tested", "Tested: sign-in and sending worked with Threadpacket."]));
    expect(html).not.toMatch(/role="tab"[^>]*>(?:(?!<\/button>).)*class="dot/s);
    expect(html.match(/<span class="tab-logo [a-z-]+" aria-hidden="true">/g)?.length).toBe(5);
    expect(html).toContain('<span class="tab-logo hermes" aria-hidden="true"></span>');
    expect(html).toMatch(/\.tab-logo\.hermes \{[^}]*mask:url\("data:image\/png;base64,/);
    expect(html).toContain(`<p class="warn-box">To attach files, add <code>${new URL(ORIGIN).host}</code> to the allowed domains`);
    expect(html).toContain("for 10 minutes");
    expect(html).not.toContain("—");
  });

  it("allows only its own nonce script on /connect", async () => {
    const res = await SELF.fetch(`${ORIGIN}/connect`);
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    const html = await res.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBe(2);
    for (const tag of scripts) expect(tag).toBe(`<script nonce="${nonce}">`);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("serves its fonts from this Worker, and the page names only fonts that exist", async () => {
    const res = await SELF.fetch(`${ORIGIN}/`);
    expect(res.headers.get("content-security-policy")).toContain("font-src 'self'");
    const html = await res.text();
    const named = [...new Set([...html.matchAll(/\/fonts\/([a-z0-9-]+\.woff2)/g)].map((m) => m[1]))];
    expect(named.sort()).toEqual([...FONT_FILES].sort());
    for (const file of FONT_FILES) {
      const font = await SELF.fetch(`${ORIGIN}/fonts/${file}`);
      expect(font.status, file).toBe(200);
      expect(new Uint8Array(await font.arrayBuffer()).slice(0, 4)).toEqual(new TextEncoder().encode("wOF2"));
    }
    expect(html).not.toMatch(/https:\/\/fonts\.|googleapis/);
  });

  it("a signed-in browser's public pages lead to Dashboard, not Sign in, and no shared cache keeps either version", async () => {
    const cookie = `__Host-threadpacket-session=${"s".repeat(43)}`;
    for (const path of ["/", "/privacy", "/terms", "/about", "/contact"]) {
      const out = await home(path);
      expect(out.headers.get("cache-control"), path).toBe("private, no-cache");
      expect(await out.text(), path).toContain('href="/login">Sign in</a>');
      const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { cookie } }), control, createExecutionContext());
      const html = await res.text();
      expect(html, path).not.toContain(">Sign in</a>");
      expect(html, path).toContain('href="/packets">');
    }
    const signedIn = await (await worker.fetch(new Request(`${ORIGIN}/`, { headers: { cookie } }), control, createExecutionContext())).text();
    expect(signedIn).toContain('<a class="site-button primary" href="/packets">Dashboard</a>');
    expect(signedIn).toContain('<a class="site-button primary" href="/packets">Dashboard <span aria-hidden="true">→</span></a>');
    const priv = await (await SELF.fetch(`${ORIGIN}/privacy`, { headers: { cookie } })).text();
    expect(priv).not.toContain(">Sign in</a>");
    expect(priv).toContain('href="/packets">Dashboard</a>');
    for (const path of ["/b", "/admin", "/assets"]) expect((await home(path)).status, path).toBe(404);
  });

  it("the sign-in page uses the same fonts and light/dark palette", async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/authorize`)).text();
    expect(html).toContain("/fonts/ibm-plex-sans-latin-400-normal.woff2");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("the Courier Hybrid homepage presents the live packet workspace and CSS-switched self-host tab with zero scripts", async () => {
    const connectHtml = await (await SELF.fetch(`${ORIGIN}/connect`)).text();
    expect(connectHtml).not.toContain('<a href="/">Home</a>');

    const res = await home();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("media-src 'self'");
    expect(csp).not.toContain("script-src");

    const html = await res.text();
    expect(html).toContain("From your AI to theirs.");
    expect(html).toContain("No email required · Zero personal data");
    expect(html).toContain("No Email, No Personal Data");
    expect(html).toContain("Packet // joe (Claude) → anna (ChatGPT)");
    expect(html).toContain("Car insurance renewal");
    expect(html).toContain("“Continue the packet from joe.”");
    expect(html).toContain("renewal-offer.pdf");
    expect(html).toContain('<a class="site-button primary" href="/connect">Get started <span aria-hidden="true">→</span></a>');
    expect(html).toContain('<a class="site-button primary" href="/connect">Get started</a>');
    expect(html).toContain(`class="deploy-button" href="${DEPLOY_PATH}"`);
    expect(html).toContain('<img src="/img/deploy-to-cloudflare.svg" width="184" height="39" alt="Deploy to Cloudflare">');
    expect(html).toContain("THREADPACKET_SETUP_CODE");
    expect(html).toContain("npm run setup -- --members=tim,tom");
    expect(html.match(/href="\/deploy"/g)).toHaveLength(1);
    expect(html).toContain('<a class="nav-link nav-secondary" href="/login">Sign in</a>');
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).not.toContain("noindex");
    expect(html).not.toContain("—");
    expect(html).not.toMatch(/playground/i);
    expect(html).toBe(await (await home("/use-cases")).text());
    expect(html).toContain('src="/demo/threadpacket-demo.mp4"');
    expect(html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, "")).not.toContain("<script");

    const vid = await SELF.fetch(`${ORIGIN}/demo/threadpacket-demo.mp4`);
    expect(vid.status).toBe(200);
    expect(new Uint8Array(await vid.arrayBuffer()).slice(4, 8)).toEqual(new TextEncoder().encode("ftyp"));
  });

  it("hides Connect on inactive instances and offers setup or CLI installation guidance", async () => {
    await env.DB.prepare("DELETE FROM admin_members").run();

    const homeHtml = await (await home()).text();
    expect(homeHtml).not.toContain('href="/connect"');
    expect(homeHtml).toContain(`href="${DEPLOY_PATH}"`);
    expect(homeHtml).toContain(`href="${GITHUB_URL}"`);
    expect(homeHtml).toContain('href="/console/setup"');

    const connectHtml = await (await SELF.fetch(`${ORIGIN}/connect`)).text();
    expect(connectHtml).not.toContain('href="/connect"');
    expect(connectHtml).not.toContain(`data-copy="${ORIGIN}/mcp"`);
    expect(connectHtml).not.toContain('role="tablist"');
    expect(connectHtml).toContain('href="/console/setup">Set up this server');
    expect(connectHtml).toContain(`href="${INSTALL_URL}"`);
    expect(connectHtml).not.toContain(`href="${DEPLOY_PATH}"`);
    expect(connectHtml).toContain(`href="${GITHUB_URL}"`);
  });
});
