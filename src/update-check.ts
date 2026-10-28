import type { Env } from "./env";
import { base64url } from "./domain/ids";
import { recordEvent } from "./store/events";
import { VERSION } from "./version";

/**
 * The update check. Once a day the hourly cron (src/index.ts) asks the project's hosted instance for the latest
 * version and the console's Ops page shows the answer. The request carries a random id made once for this
 * deployment, its version, and two size buckets: nothing else, so the project can count deployments in use
 * without learning who runs them. HANDOFF_UPDATE_CHECK=off turns it off.
 *
 * The same module is the receiving end, active only where UPDATE_CHECK_RECEIVER=1.
 */
export const DEFAULT_UPDATE_CHECK_URL = "https://handoff.infraworks.net/v1/update-check";
export const RELEASES_URL = "https://github.com/evgolsh/handoff/releases";

const DAY = 86_400_000;

export const MEMBER_BUCKETS = ["0", "1", "2-5", "6+"] as const;
export const PACKET_BUCKETS = ["0", "1-9", "10-49", "50+"] as const;
export const bucketMembers = (n: number): (typeof MEMBER_BUCKETS)[number] => (n <= 0 ? "0" : n === 1 ? "1" : n <= 5 ? "2-5" : "6+");
export const bucketPackets = (n: number): (typeof PACKET_BUCKETS)[number] => (n <= 0 ? "0" : n < 10 ? "1-9" : n < 50 ? "10-49" : "50+");

export function updateCheckEnabled(env: Env): boolean {
  const v = (env.HANDOFF_UPDATE_CHECK ?? "").trim().toLowerCase();
  return !["off", "0", "false", "no"].includes(v);
}

export const receiverEnabled = (env: Env): boolean =>
  (env.UPDATE_CHECK_RECEIVER ?? "").trim() === "1" || (env.HANDOFF_MODE ?? "").trim().toLowerCase() === "control";

async function setting(db: D1Database, key: string): Promise<string | null> {
  try {
    const row = await db.prepare("SELECT value FROM instance WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null; // Before migration 0007.
  }
}

async function setSetting(db: D1Database, key: string, value: string, at: string): Promise<void> {
  await db
    .prepare("INSERT INTO instance (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value, at)
    .run();
}

/** The random id of this deployment, made on first use. Nothing about the deployment can be derived from it. */
export async function instanceId(db: D1Database, at: string): Promise<string> {
  const existing = await setting(db, "instance_id");
  if (existing) return existing;
  const fresh = `inst_${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  await db.prepare("INSERT OR IGNORE INTO instance (key, value, updated_at) VALUES ('instance_id', ?, ?)").bind(fresh, at).run();
  return (await setting(db, "instance_id")) ?? fresh;
}

export interface UpdateState {
  version: string;
  enabled: boolean;
  latest: string | null;
  checkedAt: string | null;
}

/** What the Ops page shows: this version, whether the check is on, and what it last learned. */
export async function updateState(env: Env): Promise<UpdateState> {
  return {
    version: VERSION,
    enabled: updateCheckEnabled(env),
    latest: await setting(env.DB, "latest_version"),
    checkedAt: await setting(env.DB, "last_update_check"),
  };
}

export interface UpdateCheckResult {
  sent: boolean;
  reason?: "off" | "recent" | "error";
  latest?: string | null;
}

/**
 * Runs the check if it is on and none ran in the last 24 hours. The attempt is recorded before the request, so
 * a failing receiver costs one request a day. Never throws: the cron's cleanup must not depend on it.
 */
export async function runUpdateCheck(env: Env, opts: { now?: number; fetch?: typeof fetch } = {}): Promise<UpdateCheckResult> {
  if (!updateCheckEnabled(env)) return { sent: false, reason: "off" };
  const now = opts.now ?? Date.now();
  const at = new Date(now).toISOString();
  const db = env.DB;
  const last = await setting(db, "last_update_check");
  if (last && now - Date.parse(last) < DAY) return { sent: false, reason: "recent" };
  await setSetting(db, "last_update_check", at, at);

  const id = await instanceId(db, at);
  const counts = await db
    .prepare("SELECT (SELECT COUNT(*) FROM members) AS m, (SELECT COUNT(*) FROM packets WHERE created_at >= ?) AS p")
    .bind(new Date(now - 30 * DAY).toISOString())
    .first<{ m: number; p: number }>();
  const url = new URL(env.UPDATE_CHECK_URL?.trim() || DEFAULT_UPDATE_CHECK_URL);
  url.search = new URLSearchParams({ id, v: VERSION, m: bucketMembers(counts?.m ?? 0), p: bucketPackets(counts?.p ?? 0) }).toString();

  const doFetch = opts.fetch ?? fetch;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5_000);
  try {
    const res = await doFetch(url.toString(), {
      method: "GET",
      headers: { "user-agent": `handoff/${VERSION}`, accept: "application/json" },
      signal: abort.signal,
    });
    const body = res.ok ? ((await res.json().catch(() => null)) as { latest?: unknown } | null) : null;
    const latest = typeof body?.latest === "string" && /^\d+\.\d+\.\d+/.test(body.latest) ? body.latest.slice(0, 32) : null;
    if (latest) await setSetting(db, "latest_version", latest, at);
    await recordEvent(db, { kind: "update_check", name: url.host, outcome: res.ok ? "ok" : `http_${res.status}`, detail: latest ? { latest } : null });
    return { sent: true, latest };
  } catch (err) {
    await recordEvent(db, { kind: "update_check", name: url.host, outcome: "error", detail: { error: (err as Error).name } });
    return { sent: true, reason: "error", latest: null };
  } finally {
    clearTimeout(timer);
  }
}

const ID = /^inst_[A-Za-z0-9_-]{16,32}$/;
const VER = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]{1,20})?$/;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** The receiving end: records the check and answers with this deployment's version. Off unless UPDATE_CHECK_RECEIVER=1. */
export async function receiveUpdateCheck(env: Env, url: URL, now = Date.now()): Promise<Response> {
  if (!receiverEnabled(env)) return json({ error: "not_found", message: "no such route" }, 404);
  const q = (k: string) => url.searchParams.get(k) ?? "";
  const [id, v, m, p] = [q("id"), q("v"), q("m"), q("p")];
  if (!ID.test(id) || !VER.test(v) || !(MEMBER_BUCKETS as readonly string[]).includes(m) || !(PACKET_BUCKETS as readonly string[]).includes(p)) {
    return json({ error: "invalid_input", message: "expected id, v, m and p" }, 400);
  }
  const at = new Date(now).toISOString();
  await env.DB.prepare(
    `INSERT INTO instances_seen (id, version, members, packets, first_seen, last_seen, checks) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, members = excluded.members, packets = excluded.packets,
       last_seen = excluded.last_seen, checks = instances_seen.checks + 1`,
  )
    .bind(id, v, m, p, at, at)
    .run();
  return json({ latest: VERSION }, 200);
}
