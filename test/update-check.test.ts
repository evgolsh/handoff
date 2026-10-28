import { beforeEach, describe, expect, it, vi } from "vitest";
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { DEPLOY_PATH, DEPLOY_URL } from "../src/http/header";
import { runUpdateCheck, updateState } from "../src/update-check";
import { VERSION, isNewer } from "../src/version";
import { ORIGIN, alice, send } from "./helpers";

type Call = { url: URL; init: RequestInit };
function mockFetch(reply: () => Response | Promise<Response>): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return reply();
  }) as typeof fetch;
  return { calls, fetch: f };
}

const ID = /^inst_[A-Za-z0-9_-]{16,32}$/;

// Storage is shared across the cases in this file: start each from nothing the check could have left behind.
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM instance"), env.DB.prepare("DELETE FROM instances_seen"), env.DB.prepare("DELETE FROM events")]);
});

describe("the daily update check (sending end)", () => {
  // The suite runs with the check off (vitest.config.ts); these cases turn it on.
  const on = { ...env, HANDOFF_UPDATE_CHECK: "" };

  it("sends one anonymous request a day: id, version and two buckets, nothing else", async () => {
    const m = mockFetch(() => Response.json({ latest: "9.9.9" }));
    const now = Date.now();
    expect(await runUpdateCheck(on, { now, fetch: m.fetch })).toEqual({ sent: true, latest: "9.9.9" });
    expect(m.calls).toHaveLength(1);
    const { url, init } = m.calls[0]!;
    expect(url.origin + url.pathname).toBe("https://handoff.infraworks.net/v1/update-check");
    expect([...url.searchParams.keys()].sort()).toEqual(["id", "m", "p", "v"]);
    expect(url.searchParams.get("id")).toMatch(ID);
    expect(url.searchParams.get("v")).toBe(VERSION);
    expect(url.searchParams.get("m")).toBe("0");
    expect(url.searchParams.get("p")).toBe("0");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(`handoff/${VERSION}`);

    // Within the day: nothing more is sent. The next day: the same id.
    expect(await runUpdateCheck(on, { now: now + 3_600_000, fetch: m.fetch })).toEqual({ sent: false, reason: "recent" });
    expect(m.calls).toHaveLength(1);
    expect(await runUpdateCheck(on, { now: now + 25 * 3_600_000, fetch: m.fetch })).toMatchObject({ sent: true });
    expect(m.calls[1]!.url.searchParams.get("id")).toBe(url.searchParams.get("id"));

    const state = await updateState(on);
    expect(state).toMatchObject({ version: VERSION, enabled: true, latest: "9.9.9" });
    expect(state.checkedAt).toBe(new Date(now + 25 * 3_600_000).toISOString());
  });

  it("HANDOFF_UPDATE_CHECK=off sends nothing and says so", async () => {
    const m = mockFetch(() => Response.json({ latest: "9.9.9" }));
    const off = { ...on, HANDOFF_UPDATE_CHECK: "off" };
    expect(await runUpdateCheck(off, { fetch: m.fetch })).toEqual({ sent: false, reason: "off" });
    expect(m.calls).toHaveLength(0);
    expect(await updateState(off)).toMatchObject({ enabled: false, latest: null, checkedAt: null });
  });

  it("a failing receiver costs one request a day and never throws", async () => {
    const m = mockFetch(() => {
      throw new TypeError("network down");
    });
    const now = Date.now();
    expect(await runUpdateCheck(on, { now, fetch: m.fetch })).toEqual({ sent: true, reason: "error", latest: null });
    expect(await runUpdateCheck(on, { now: now + 60_000, fetch: m.fetch })).toEqual({ sent: false, reason: "recent" });
    expect(m.calls).toHaveLength(1);
    const ev = await env.DB.prepare("SELECT outcome FROM events WHERE kind = 'update_check'").first<{ outcome: string }>();
    expect(ev?.outcome).toBe("error");
  });

  it("reports sizes as buckets, and a bad answer leaves 'latest' empty", async () => {
    const a = await alice();
    await send(a);
    await send(a);
    const at = new Date().toISOString();
    for (const h of ["x", "y", "z"]) await env.DB.prepare("INSERT INTO members (handle, code_salt, code_hash, created_at) VALUES (?, 's', 'h', ?)").bind(h, at).run();
    const m = mockFetch(() => Response.json({ latest: "not a version" }));
    expect(await runUpdateCheck(on, { fetch: m.fetch })).toEqual({ sent: true, latest: null });
    expect(m.calls[0]!.url.searchParams.get("m")).toBe("2-5");
    expect(m.calls[0]!.url.searchParams.get("p")).toBe("1-9");
    expect((await updateState(on)).latest).toBeNull();
  });

  it("runs from the hourly cron without failing it", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ latest: "0.1.1" }));
    try {
      const ctx = createExecutionContext();
      await worker.scheduled({ cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, on, ctx);
      await waitOnExecutionContext(ctx);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(await updateState(on)).toMatchObject({ latest: "0.1.1" });
  });
});

describe("the update check (receiving end)", () => {
  const ctx = () => createExecutionContext();
  const query = "id=inst_abcdefghijklmnopqrstuv&v=0.1.0&m=2-5&p=1-9";
  const receiver = { ...env, UPDATE_CHECK_RECEIVER: "1" };

  it("is not there unless UPDATE_CHECK_RECEIVER=1", async () => {
    const res = await worker.fetch(new Request(`${ORIGIN}/v1/update-check?${query}`), env, ctx());
    expect(res.status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM instances_seen").first<{ n: number }>()).toMatchObject({ n: 0 });
  });

  it("records one row per instance, counts the checks, and answers with its version", async () => {
    const first = await worker.fetch(new Request(`${ORIGIN}/v1/update-check?${query}`), receiver, ctx());
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ latest: VERSION });
    const again = await worker.fetch(new Request(`${ORIGIN}/v1/update-check?id=inst_abcdefghijklmnopqrstuv&v=0.2.0&m=6%2B&p=50%2B`), receiver, ctx());
    expect(again.status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM instances_seen").first<Record<string, unknown>>();
    expect(row).toMatchObject({ id: "inst_abcdefghijklmnopqrstuv", version: "0.2.0", members: "6+", packets: "50+", checks: 2 });
    expect(Object.keys(row!).sort()).toEqual(["checks", "first_seen", "id", "last_seen", "members", "packets", "version"]);
  });

  it("refuses anything but the four expected values", async () => {
    for (const q of ["id=nope&v=0.1.0&m=1&p=0", "id=inst_abcdefghijklmnopqrstuv&v=latest&m=1&p=0", "id=inst_abcdefghijklmnopqrstuv&v=0.1.0&m=7&p=0", "id=inst_abcdefghijklmnopqrstuv&v=0.1.0&m=1&p=lots", ""]) {
      const res = await worker.fetch(new Request(`${ORIGIN}/v1/update-check?${q}`), receiver, ctx());
      expect(res.status, q).toBe(400);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM instances_seen").first<{ n: number }>()).toMatchObject({ n: 0 });
  });
});

describe("the counted Deploy link", () => {
  it("/deploy records a visit and sends the browser to the Deploy to Cloudflare page", async () => {
    const res = await SELF.fetch(`${ORIGIN}${DEPLOY_PATH}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(DEPLOY_URL);
    const ev = await env.DB.prepare("SELECT kind, name, outcome FROM events WHERE kind = 'visit'").first();
    expect(ev).toMatchObject({ kind: "visit", name: "deploy", outcome: "ok" });
  });
});

describe("version comparison", () => {
  it("orders numeric parts and ignores a pre-release suffix", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0-beta", "0.1.0")).toBe(false);
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
  });
});
