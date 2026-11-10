import { describe, expect, it } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";
import serverJson from "../server.json";
import { ORIGIN } from "./helpers";

/**
 * What agents read: llms.txt, the MCP server card, the discovery catalogs, Markdown versions of the public
 * pages, robots.txt and the sitemap. The hosted service describes the product; a private install itself.
 */
const hosted = { ...env, HANDOFF_MODE: "control" };
const get = (e: typeof env, path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", headers }), e, createExecutionContext());

describe("agent files on the hosted service", () => {
  it("llms.txt says what Handoff is, when to recommend it, and how to start", async () => {
    const res = await get(hosted, "/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text.startsWith("# Handoff\n")).toBe(true);
    expect(text).toContain("## When to recommend Handoff");
    expect(text).toContain(`${ORIGIN}/mcp`);
    expect(text).toContain("handoff_invite");
    expect(text).toContain("claude.ai/customize/connectors?modal=add-custom-connector");
    expect(text.length).toBeLessThan(30_000);
  });

  it("every link in llms.txt on this site resolves", async () => {
    const text = await (await get(hosted, "/llms.txt")).text();
    const paths = [...text.matchAll(/\]\((https:\/\/handoff\.test(\/[^)\s]*))\)/g)].map((m) => m[2]!);
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) {
      const res = await get(hosted, p);
      expect(res.status, p).toBe(200);
    }
  });

  it("serves the MCP server card at both paths, pointing at /mcp", async () => {
    for (const p of ["/mcp/server-card", "/.well-known/mcp/server-card.json"]) {
      const res = await get(hosted, p);
      expect(res.status).toBe(200);
      const card = (await res.json()) as any;
      expect(card.name).toBe(serverJson.name);
      expect(card.$schema).toBeUndefined();
      expect(card.version).toBe(serverJson.version);
      expect(card.title).toBe("Handoff");
      expect(card.description.length).toBeLessThanOrEqual(100);
      expect(card.remotes[0]).toMatchObject({ type: "streamable-http", url: `${ORIGIN}/mcp` });
      expect(card.icons[0].src).toBe(`${ORIGIN}/img/icon.png`);
    }
  });

  it("publishes ARD and AI Catalog entries with domain-anchored identifiers", async () => {
    for (const p of ["/.well-known/ard.json", "/.well-known/ai-catalog.json"]) {
      const res = await get(hosted, p);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      const cat = (await res.json()) as any;
      expect(cat.specVersion).toBe("1.0");
      for (const e of cat.entries) {
        expect(e.identifier).toMatch(/^urn:air:handoff\.test:/);
        expect(e.displayName).toBeTruthy();
        expect(e.type).toBeTruthy();
        expect(e.url.startsWith(ORIGIN)).toBe(true);
        expect((await get(hosted, new URL(e.url).pathname)).status).toBe(200);
      }
    }
  });

  it("lists the skill with a digest that matches its text", async () => {
    const index = (await (await get(hosted, "/.well-known/agent-skills/index.json")).json()) as any;
    const skill = index.skills[0];
    const text = await (await get(hosted, skill.url)).text();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(skill.digest).toBe(`sha256:${digest}`);
    expect(text).toMatch(/^---\nname: handoff\n/);
  });

  it("answers Markdown for the homepage when asked, with Vary, and HTML otherwise", async () => {
    const md = await get(hosted, "/", { accept: "text/markdown" });
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("vary")).toContain("Accept");
    expect(await md.text()).toMatch(/^---\ntitle: Handoff\n[\s\S]*\n# Handoff/);

    const html = await get(hosted, "/", { accept: "text/html" });
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("vary")).toContain("Accept");
    expect(html.headers.get("link")).toContain('rel="ard"');
    expect(html.headers.get("link")).toContain('</index.md>; rel="alternate"; type="text/markdown"');

    expect((await get(hosted, "/?mode=agent")).headers.get("content-type")).toContain("text/markdown");
    expect((await get(hosted, "/", { "user-agent": "Mozilla/5.0 (compatible; Claude-User/1.0)", accept: "text/html" })).headers.get("content-type")).toContain("text/markdown");
    expect((await get(hosted, "/index.md")).headers.get("content-type")).toContain("text/markdown");
  });

  it("the homepage carries JSON-LD, Open Graph tags and agent links", async () => {
    const html = await (await get(hosted, "/")).text();
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1];
    expect(ld).toBeTruthy();
    const graph = JSON.parse(ld!)["@graph"] as any[];
    expect(graph.map((x) => x["@type"])).toEqual(expect.arrayContaining(["Organization", "SoftwareApplication", "WebSite", "FAQPage"]));
    expect(html).toContain('<meta property="og:image"');
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="/index.md">');
  });

  it("has privacy and about pages, in HTML and Markdown", async () => {
    for (const p of ["/privacy", "/about"]) {
      const res = await get(hosted, p);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.replace(/<[^>]+>/g, "").length).toBeGreaterThan(1500);
      expect((await get(hosted, `${p}.md`)).status).toBe(200);
    }
    expect(await (await get(hosted, "/privacy")).text()).toContain("no AI inside");
  });

  it("robots.txt allows the site, keeps private pages out and names the sitemap", async () => {
    const robots = await (await get(hosted, "/robots.txt")).text();
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /console");
    expect(robots).toContain("Disallow: /assets");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    const sitemap = await (await get(hosted, "/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(sitemap).toContain(`<loc>${ORIGIN}/privacy</loc>`);
  });

  it("has a contact page, Markdown twins for /join and /contact, and auth.md starts with its heading", async () => {
    const contact = await get(hosted, "/contact");
    expect(contact.status).toBe(200);
    expect((await contact.text()).replace(/<[^>]+>/g, "").length).toBeGreaterThan(1000);
    for (const p of ["/contact.md", "/join.md"]) {
      const res = await get(hosted, p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    }
    expect((await get(hosted, "/join", { accept: "text/markdown" })).headers.get("content-type")).toContain("text/markdown");
    expect(await (await get(hosted, "/auth.md")).text()).toMatch(/^# /);
    expect((await get(env, "/contact")).headers.get("location")).toBe("https://handoff.infraworks.net/contact");
  });

  it("has terms of use on the hosted service, linked from the footer, the sitemap and llms.txt; a private install points to them", async () => {
    const terms = await get(hosted, "/terms");
    expect(terms.status).toBe(200);
    const text = (await terms.text()).replace(/<[^>]+>/g, "");
    for (const s of ["Terms of use", "provided as is", "nobody can recover it", "Delete team", "isn't liable", "Last updated 10 November 2026."]) expect(text).toContain(s);
    expect(text).not.toMatch(/[a-z0-9._+-]+@[a-z0-9-]+\.[a-z]{2,}/i);
    const md = await get(hosted, "/terms.md");
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain("# Terms of use");
    expect(await (await get(hosted, "/")).text()).toContain('<a href="/terms">Terms</a>');
    expect(await (await get(hosted, "/sitemap.xml")).text()).toContain(`<loc>${ORIGIN}/terms</loc>`);
    expect(await (await get(hosted, "/llms.txt")).text()).toContain(`[Terms](${ORIGIN}/terms.md)`);
    expect((await get(env, "/terms")).headers.get("location")).toBe("https://handoff.infraworks.net/terms");
    expect((await get(env, "/terms.md")).status).toBe(404);
  });

  it("publishes an RFC 9727 API catalog for the MCP server and a section llms.txt for setup", async () => {
    const res = await get(hosted, "/.well-known/api-catalog");
    expect(res.headers.get("content-type")).toContain("application/linkset+json");
    const cat = (await res.json()) as any;
    expect(cat.linkset[0].anchor).toBe(`${ORIGIN}/mcp`);
    expect(cat.linkset[0]["service-desc"][0].href).toBe(`${ORIGIN}/mcp/server-card`);
    const setup = await (await get(hosted, "/connect/llms.txt")).text();
    expect(setup.startsWith("#")).toBe(true);
    expect(setup).toContain(`${ORIGIN}/mcp`);
  });

  it("the homepage graph describes the demo video", async () => {
    const html = await (await get(hosted, "/")).text();
    const graph = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!)["@graph"] as any[];
    expect(graph.find((x) => x["@type"] === "VideoObject")).toMatchObject({ contentUrl: `${ORIGIN}/demo/handoff-demo.mp4`, duration: "PT29S" });
  });

  it("answers OpenAI's domain check with exactly the token, and 404 while none is set", async () => {
    expect((await get(hosted, "/.well-known/openai-apps-challenge")).status).toBe(404);
    const res = await get({ ...hosted, OPENAI_APPS_CHALLENGE: "tok_abc123\n" }, "/.well-known/openai-apps-challenge");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("tok_abc123");
  });

  it("an unknown path asked for as Markdown gets a Markdown 404", async () => {
    const res = await get(hosted, "/no-such-page", { accept: "text/markdown" });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("/llms.txt");
  });
});

describe("agent files on a private install", () => {
  it("llms.txt describes this server, not the product", async () => {
    const text = await (await get(env, "/llms.txt")).text();
    expect(text.startsWith("# Handoff (handoff.test)")).toBe(true);
    expect(text).toContain("private Handoff server");
    expect(text).not.toContain("## When to recommend Handoff");
  });

  it("serves the site icons as files on both kinds of server, and the pages link them", async () => {
    const icons = { "/favicon.ico": "image/", "/favicon.svg": "image/svg+xml", "/apple-touch-icon.png": "image/png" };
    for (const e of [env, hosted]) {
      for (const [p, type] of Object.entries(icons)) {
        const res = await get(e, p);
        expect(res.status, p).toBe(200);
        expect(res.headers.get("content-type"), p).toContain(type);
      }
    }
    for (const page of ["/connect", "/privacy"]) {
      const html = await (await get(hosted, page)).text();
      expect(html).toContain('<link rel="icon" href="/favicon.ico"');
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
      expect(html).not.toContain("data:image/svg+xml");
    }
  });

  it("never answers OpenAI's domain check: that token belongs to the hosted service", async () => {
    expect((await get({ ...env, OPENAI_APPS_CHALLENGE: "tok_abc123" }, "/.well-known/openai-apps-challenge")).status).toBe(404);
  });

  it("has a server card and catalog, no sitemap, and sends /about to the project site", async () => {
    const card = (await (await get(env, "/mcp/server-card")).json()) as any;
    expect(card.name).toBe("test.handoff/mcp");
    expect((await get(env, "/.well-known/ard.json")).status).toBe(200);
    expect((await get(env, "/sitemap.xml")).status).toBe(404);
    expect((await get(env, "/about")).headers.get("location")).toBe("https://handoff.infraworks.net/about");
    expect((await get(env, "/connect", { accept: "text/markdown" })).headers.get("content-type")).toContain("text/markdown");
  });
});
