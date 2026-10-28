import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { upsertMember, verifyMemberCode } from "../src/auth/builtin";
import type { Env } from "../src/env";
import { ORIGIN } from "./helpers";

// Setup is open only while no member is an admin, so each test starts from empty tables.
beforeEach(async () => {
  await env.DB.batch(
    ["admin_sessions", "admin_members", "admin_login_limits", "events", "members"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
});
const SETUP = "correct-horse-battery-staple";
const app = createApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const uid = () => crypto.randomUUID().slice(0, 8);

function fetchWith(setupCode: string | undefined, path: string, init: RequestInit = {}): Promise<Response> {
  const e = { ...env, PUBLIC_URL: ORIGIN, HANDOFF_SETUP_CODE: setupCode } as Env;
  return Promise.resolve(app.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), e, ctx));
}

function submit(fields: Record<string, string>, opts: { setupCode?: string; origin?: string; ip?: string } = {}): Promise<Response> {
  return fetchWith("setupCode" in opts ? opts.setupCode : SETUP, "/console/setup", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: opts.origin ?? ORIGIN,
      "cf-connecting-ip": opts.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}-${uid()}`,
    },
    body: new URLSearchParams(fields),
  });
}

const secretIn = (html: string): string => /<div class="secret" aria-label="access code">([^<]+)<\/div>/.exec(html)?.[1] ?? "";
const admins = async () => (await env.DB.prepare("SELECT handle FROM admin_members ORDER BY handle").all<{ handle: string }>()).results.map((r) => r.handle);

describe("first admin at /console/setup (servers deployed without a terminal)", () => {
  it("without a setup code, explains how to set one and accepts nothing", async () => {
    for (const code of [undefined, "", "too-short"]) {
      const page = await (await fetchWith(code, "/console/setup")).text();
      // A short secret (the Deploy button cannot check its length) is named as such, so the fix is clear.
      expect(page).toContain(code === "too-short" ? "shorter than 12 characters" : "no setup code is set");
      expect(page).toContain("HANDOFF_SETUP_CODE");
      expect(page).not.toContain("<form");
      const res = await submit({ setup_code: code ?? "", handle: "owner" }, { setupCode: code });
      expect(res.status).toBe(403);
    }
    expect(await admins()).toEqual([]);
  });

  it("with a setup code: points to setup from the login and Connect pages, and refuses wrong codes and other origins", async () => {
    expect(await (await fetchWith(SETUP, "/console/setup")).text()).toContain('<form method="post" action="/console/setup"');
    expect(await (await fetchWith(SETUP, "/console/login")).text()).toContain('href="/console/setup"');
    expect(await (await fetchWith(SETUP, "/connect")).text()).toContain('href="/console/setup"');

    const wrong = await submit({ setup_code: "not-the-setup-code", handle: "owner" });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("not this server&#39;s setup code");
    expect(await env.DB.prepare("SELECT outcome FROM events WHERE kind = 'console' AND name = 'setup'").first("outcome")).toBe("refused");

    expect((await submit({ setup_code: SETUP, handle: "owner" }, { origin: "https://evil.example.net" })).status).toBe(403);
    expect((await submit({ setup_code: SETUP, handle: "team" })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first("n")).toBe(0);
    expect(await admins()).toEqual([]);
  });

  it("makes the first admin once: shows the code, signs them in, then closes", async () => {
    const res = await submit({ setup_code: SETUP, handle: "Owner" });
    expect(res.status).toBe(200);
    const page = await res.text();
    const code = secretIn(page);
    expect(code).toMatch(/^hf-[A-Za-z0-9_-]{16}$/);
    expect(await verifyMemberCode(env.DB, "owner", code)).toBe("owner");
    expect(await admins()).toEqual(["owner"]);

    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toMatch(/^__Host-handoff-console=/);
    expect((await fetchWith(SETUP, "/console/overview", { headers: { cookie } })).status).toBe(200);

    // Closed: the page sends you to sign in, and the setup code makes no one else an admin.
    const again = await fetchWith(SETUP, "/console/setup");
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe("/console/login");
    expect((await submit({ setup_code: SETUP, handle: "intruder" })).status).toBe(303);
    expect(await admins()).toEqual(["owner"]);
    expect(await env.DB.prepare("SELECT 1 FROM members WHERE handle = 'intruder'").first()).toBeNull();
    expect(await (await fetchWith(SETUP, "/console/login")).text()).not.toContain('href="/console/setup"');
    expect(await (await fetchWith(SETUP, "/connect")).text()).not.toContain('href="/console/setup"');
  });

  it("does not take over an existing member's handle", async () => {
    await upsertMember(env.DB, "alex", "alex-code-2026");
    const res = await submit({ setup_code: SETUP, handle: "alex" });
    expect(res.status).toBe(409);
    expect(await verifyMemberCode(env.DB, "alex", "alex-code-2026")).toBe("alex");
    expect(await admins()).toEqual([]);
  });

  it("makes one admin when two setup forms arrive at once", async () => {
    const [a, b] = await Promise.all([submit({ setup_code: SETUP, handle: "first" }), submit({ setup_code: SETUP, handle: "second" })]);
    expect([a.status, b.status].sort()).toEqual([200, 303]);
    expect(await admins()).toHaveLength(1);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first("n")).toBe(1);
  });

  it("limits guesses from one address", async () => {
    const ip = `198.51.100.7-${uid()}`;
    for (let i = 0; i < 10; i++) expect((await submit({ setup_code: `guess-${i}-guess-${i}`, handle: "owner" }, { ip })).status).toBe(401);
    expect((await submit({ setup_code: SETUP, handle: "owner" }, { ip })).status).toBe(429);
    expect(await admins()).toEqual([]);
  });
});
