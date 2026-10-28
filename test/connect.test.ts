import { beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import worker from "../src/index";
import { ORIGIN } from "./helpers";

/** The homepage is served by the control center (HANDOFF_MODE=control); a private install sends / to /connect. */
const control = { ...env, HANDOFF_MODE: "control" };
const home = (path = "/") => worker.fetch(new Request(`${ORIGIN}${path}`), control, createExecutionContext());
import { FONT_FILES } from "../src/http/style";
import { DEPLOY_PATH, GITHUB_URL } from "../src/http/header";

describe("connect page", () => {
  beforeEach(async () => {
    // An instance is active once an admin exists in admin_members.
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES ('tim', 's', 'h', '2026-10-27T00:00:00Z')"),
      env.DB.prepare("INSERT OR IGNORE INTO admin_members (handle) VALUES ('tim')"),
    ]);
  });

  it("/connect shows the server address and setup steps for each host on an active instance", async () => {
    const res = await SELF.fetch(`${ORIGIN}/connect`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(`data-copy="${ORIGIN}/mcp"`);
    expect(html).toContain(`claude mcp add --transport http --scope user handoff ${ORIGIN}/mcp`);
    expect(html).toContain(`hermes mcp add handoff --url ${ORIGIN}/mcp --auth oauth`);
    expect(html).toContain(`codex mcp add handoff --url ${ORIGIN}/mcp`);
    for (const host of ["Claude Code", "Hermes", "Claude", "Codex", "ChatGPT"]) expect(html).toContain(`<span class="tab-name">${host}</span>`);
    // Each host says how far it was tested: the steps end to end, a part of them, or only the host's docs.
    const tags = [...html.matchAll(/<span class="tab-state">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(tags).toEqual(["Tested", "Tested", "Sign-in tested", "Plugin tested", "From docs"]);
    // Every tab has the assistant's mark: the Claude logo, the OpenAI logo, or Hermes's (a CSS mask image).
    expect(html.match(/<span class="tab-logo [a-z-]+" aria-hidden="true">/g)?.length).toBe(5);
    expect(html).toContain('<span class="tab-logo hermes" aria-hidden="true"></span>');
    expect(html).toMatch(/\.tab-logo\.hermes \{[^}]*mask:url\("data:image\/png;base64,/);
    expect(html).toContain("They connected the Claude desktop app and signed in; sending and reading are not yet tested with Handoff.");
    expect(html.match(/not yet tested with Handoff/g)?.length).toBe(3);
    // Codex names the route that was tested; download links are said to be bearer links.
    expect(html).toContain("Tested with Handoff in the Codex app on macOS, installed as a local plugin");
    expect(html).toContain("<code>codex plugin marketplace add</code>");
    expect(html).toContain("works for anyone who has it, for 10 minutes");
    expect(html).toContain("Plan in one AI. Build in another.");
  });

  it("allows only its own nonce script", async () => {
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

  it("the sign-in page uses the same fonts and the light and dark palette", async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/authorize`)).text();
    expect(html).toContain("/fonts/ibm-plex-sans-latin-400-normal.woff2");
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("the control center's homepage leads with self-hosting, offers the playground second, and has /use-cases as an alias", async () => {
    const connectHtml = await (await SELF.fetch(`${ORIGIN}/connect`)).text();
    expect(connectHtml).toContain('href="/#use-cases"');

    const res = await home();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("media-src 'self'");
    expect(csp).not.toContain("script-src");

    const html = await res.text();
    expect(html).toContain("Your next chat.");
    expect(html).toContain(`class="site-button primary" href="${DEPLOY_PATH}"`);
    expect(html).toContain('class="site-button" href="/join">Try the playground');
    expect(html).not.toContain('class="site-button primary" href="/join"');
    expect(html).toContain("MIT licensed · Runs on your Cloudflare account");
    expect(html).toContain("Your context. Your files. Your Cloudflare account.");
    expect(html).toContain("30 days by default on your own install, 24 hours on the playground");
    expect(html).toContain('href="/connect">Connect your assistants');
    expect(html).toContain(`href="${GITHUB_URL}"`);
    expect(html).toContain(`href="${DEPLOY_PATH}"`);
    expect(html).toBe(await (await home("/use-cases")).text());
    expect(html).toContain('src="/demo/handoff-demo.mp4"');
    expect(html).toContain('id="household-last-mile"');
    expect(html).toContain('id="micro-team-relay"');
    expect(html).toContain('id="adversarial-review"');
    expect(html).toContain('id="home-server-to-laptop"');
    expect(html).toContain('id="pm-designer-to-engineer"');
    expect(html).toContain("vat-q3-summary.pdf");
    expect(html).not.toContain("<script");

    const vid = await SELF.fetch(`${ORIGIN}/demo/handoff-demo.mp4`);
    expect(vid.status).toBe(200);
    expect(new Uint8Array(await vid.arrayBuffer()).slice(4, 8)).toEqual(new TextEncoder().encode("ftyp"));
  });

  it("hides Connect on the home page and sends /connect to setup or Deploy when the instance is not active", async () => {
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
    expect(connectHtml).toContain(`href="${DEPLOY_PATH}"`);
    expect(connectHtml).toContain(`href="${GITHUB_URL}"`);
  });
});
