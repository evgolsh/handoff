import type { Config, Env } from "../env";
import { updateState, type UpdateState } from "../update-check";

/**
 * What the console shows, read from D1. Activity comes from the `events` table (names, members, clients,
 * outcomes, durations); counts come from the tables themselves. No query here reads a title, a brief, a file
 * name, a code or a token.
 */

const DAY = 86_400_000;
export const WINDOW_DAYS = 7;
export const STRIP_DAYS = 14;
const ACCESS_TOKEN_MS = 8 * 3_600_000;
/** Event kinds that show an assistant at work. */
const SEEN = "('tool','initialize','token')";

const isoAgo = (now: number, ms: number) => new Date(now - ms).toISOString();

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...binds).all<T>()).results ?? [];
}
async function one<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...binds).first<T>();
}
const pair = (subject: string, client: string) => `${subject}\u0000${client}`;

// ---- clients ------------------------------------------------------------------------------------------------

export interface ClientInfo {
  id: string;
  name: string;
  /** Host of the first redirect address: where sign-in returns (localhost for a terminal app). */
  host: string | null;
  created_at: string;
  last_used_at: string | null;
}

function hostOf(redirectUris: string): string | null {
  try {
    const first = (JSON.parse(redirectUris) as string[])[0];
    return first ? new URL(first).host : null;
  } catch {
    return null;
  }
}

export async function clientsById(db: D1Database): Promise<Map<string, ClientInfo>> {
  const rows = await all<{ client_id: string; client_name: string | null; redirect_uris: string; created_at: string; last_used_at: string | null }>(
    db,
    "SELECT client_id, client_name, redirect_uris, created_at, last_used_at FROM oauth_clients",
  );
  return new Map(
    rows.map((r) => [r.client_id, { id: r.client_id, name: r.client_name || "MCP Client", host: hostOf(r.redirect_uris), created_at: r.created_at, last_used_at: r.last_used_at }]),
  );
}

export const clientName = (clients: Map<string, ClientInfo>, id: string | null): string => (id ? clients.get(id)?.name ?? id : "");

// ---- activity rows ------------------------------------------------------------------------------------------

export interface EventRow {
  id: number;
  ts: string;
  kind: string;
  name: string | null;
  subject: string | null;
  client_id: string | null;
  outcome: string;
  ms: number | null;
  detail: string | null;
}

export function detailOf(row: { detail: string | null }): Record<string, unknown> {
  try {
    const d = row.detail ? (JSON.parse(row.detail) as unknown) : null;
    return d && typeof d === "object" ? (d as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---- overview -----------------------------------------------------------------------------------------------

export interface LatencyRow {
  tool: string;
  p50: number;
  p95: number;
  max: number;
  n: number;
}

export interface OverviewData {
  now: number;
  database: { ok: boolean; ms: number };
  storage: { ok: boolean; ms: number; files: number; bytes: number };
  packetsLive: number;
  members: number;
  admins: number;
  connected: number;
  signingKey: { from: "secret" | "database" | "none"; kid: string | null; created_at: string | null };
  version: WorkerVersionMetadata | null;
  lastCleanup: EventRow | null;
  days: Array<{ date: string; sends: number }>;
  toolTotals: Record<string, number>;
  latency: LatencyRow[];
  calls: { ok: number; failed: number };
  rejected: { n: number; last: string | null };
  badSignIns: { n: number; last: string | null };
  perMember: Array<{ handle: string; calls: number }>;
  recent: EventRow[];
  clients: Map<string, ClientInfo>;
}

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]! : 0;
}

export function latencyByTool(rows: Array<{ name: string | null; ms: number }>): LatencyRow[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.name ?? "unknown";
    let list = by.get(k);
    if (!list) by.set(k, (list = []));
    list.push(r.ms);
  }
  return [...by.entries()]
    .map(([tool, v]) => {
      v.sort((a, b) => a - b);
      return { tool, p50: percentile(v, 0.5), p95: percentile(v, 0.95), max: v[v.length - 1] ?? 0, n: v.length };
    })
    .sort((a, b) => b.n - a.n || a.tool.localeCompare(b.tool));
}

async function timed<T>(f: () => Promise<T>): Promise<{ ok: boolean; ms: number; value: T | null }> {
  const t = Date.now();
  try {
    const value = await f();
    return { ok: true, ms: Date.now() - t, value };
  } catch {
    return { ok: false, ms: Date.now() - t, value: null };
  }
}

export async function signingKey(db: D1Database, cfg: Config): Promise<OverviewData["signingKey"]> {
  if (cfg.oauthSigningJwk) {
    try {
      return { from: "secret", kid: (JSON.parse(cfg.oauthSigningJwk) as { kid?: string }).kid ?? null, created_at: null };
    } catch {
      return { from: "secret", kid: null, created_at: null };
    }
  }
  const k = await one<{ kid: string; created_at: string }>(db, "SELECT kid, created_at FROM oauth_keys ORDER BY created_at ASC, kid ASC LIMIT 1");
  return k ? { from: "database", kid: k.kid, created_at: k.created_at } : { from: "none", kid: null, created_at: null };
}

export async function overview(env: Env, cfg: Config, now = Date.now()): Promise<OverviewData> {
  const db = env.DB;
  const nowIso = new Date(now).toISOString();
  const week = isoAgo(now, WINDOW_DAYS * DAY);
  const stripStart = new Date(now - (STRIP_DAYS - 1) * DAY).toISOString().slice(0, 10);

  const database = await timed(() => db.prepare("SELECT 1 AS ok").first());
  const r2 = await timed(() => env.BLOBS.list({ limit: 1 }));
  const files = await one<{ n: number; b: number }>(db, "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM attachments WHERE state = 'ready'");
  const counts = await one<{ packets: number; members: number; admins: number; connected: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM packets WHERE revoked_at IS NULL AND expires_at > ?) AS packets,
            (SELECT COUNT(*) FROM members) AS members,
            (SELECT COUNT(*) FROM admin_members) AS admins,
            (SELECT COUNT(*) FROM (SELECT DISTINCT subject, client_id FROM oauth_refresh_tokens WHERE revoked_at IS NULL AND expires_at > ?)) AS connected`,
    nowIso,
    nowIso,
  );
  const lastCleanup = await one<EventRow>(db, "SELECT * FROM events WHERE kind = 'cleanup' ORDER BY id DESC LIMIT 1");

  const perDay = await all<{ d: string; n: number }>(
    db,
    "SELECT substr(ts, 1, 10) AS d, COUNT(*) AS n FROM events WHERE kind = 'tool' AND name = 'handoff_send' AND outcome = 'ok' AND ts >= ? GROUP BY d",
    stripStart,
  );
  const sendsOn = new Map(perDay.map((r) => [r.d, r.n]));
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => {
    const date = new Date(now - (STRIP_DAYS - 1 - i) * DAY).toISOString().slice(0, 10);
    return { date, sends: sendsOn.get(date) ?? 0 };
  });
  const toolTotals = Object.fromEntries(
    (
      await all<{ name: string; n: number }>(
        db,
        "SELECT name, COUNT(*) AS n FROM events WHERE kind = 'tool' AND outcome = 'ok' AND ts >= ? GROUP BY name",
        stripStart,
      )
    ).map((r) => [r.name, r.n]),
  );

  const latency = latencyByTool(
    await all<{ name: string | null; ms: number }>(db, "SELECT name, ms FROM events WHERE kind = 'tool' AND ms IS NOT NULL AND ts >= ? LIMIT 20000", week),
  );
  const calls = await one<{ ok: number | null; failed: number | null }>(
    db,
    "SELECT SUM(outcome = 'ok') AS ok, SUM(outcome != 'ok') AS failed FROM events WHERE kind = 'tool' AND ts >= ?",
    week,
  );
  const rejected = await one<{ n: number; last: string | null }>(db, "SELECT COUNT(*) AS n, MAX(ts) AS last FROM events WHERE kind = 'auth' AND ts >= ?", week);
  const badSignIns = await one<{ n: number; last: string | null }>(
    db,
    "SELECT COUNT(*) AS n, MAX(ts) AS last FROM events WHERE kind = 'sign_in' AND outcome != 'ok' AND ts >= ?",
    week,
  );
  const perMember = await all<{ handle: string; calls: number }>(
    db,
    `SELECT m.handle AS handle, COUNT(e.id) AS calls FROM members m
       LEFT JOIN events e ON e.subject = m.handle AND e.kind = 'tool' AND e.ts >= ?
     GROUP BY m.handle ORDER BY calls DESC, m.handle`,
    week,
  );
  const recent = await all<EventRow>(
    db,
    "SELECT * FROM events WHERE kind IN ('tool', 'initialize', 'sign_in', 'auth', 'client_metadata') ORDER BY id DESC LIMIT 25",
  );

  return {
    now,
    database: { ok: database.ok, ms: database.ms },
    storage: { ok: r2.ok, ms: r2.ms, files: files?.n ?? 0, bytes: files?.b ?? 0 },
    packetsLive: counts?.packets ?? 0,
    members: counts?.members ?? 0,
    admins: counts?.admins ?? 0,
    connected: counts?.connected ?? 0,
    signingKey: await signingKey(db, cfg),
    version: env.CF_VERSION_METADATA ?? null,
    lastCleanup,
    days,
    toolTotals,
    latency,
    calls: { ok: calls?.ok ?? 0, failed: calls?.failed ?? 0 },
    rejected: { n: rejected?.n ?? 0, last: rejected?.last ?? null },
    badSignIns: { n: badSignIns?.n ?? 0, last: badSignIns?.last ?? null },
    perMember,
    recent,
    clients: await clientsById(db),
  };
}

// ---- members ------------------------------------------------------------------------------------------------

export interface MemberRow {
  handle: string;
  created_at: string;
  admin: boolean;
  last_seen: string | null;
  last_sign_in: string | null;
  assistants: number;
  calls: number;
  sent: number;
  received: number;
}

export async function members(db: D1Database, now = Date.now()): Promise<{ rows: MemberRow[]; teamPackets: number }> {
  const nowIso = new Date(now).toISOString();
  const week = isoAgo(now, WINDOW_DAYS * DAY);
  const base = await all<{ handle: string; created_at: string; admin: number }>(
    db,
    "SELECT m.handle, m.created_at, a.handle IS NOT NULL AS admin FROM members m LEFT JOIN admin_members a ON a.handle = m.handle ORDER BY m.handle",
  );
  const map = async (sql: string, ...binds: unknown[]) => new Map((await all<{ k: string; v: string | number }>(db, sql, ...binds)).map((r) => [r.k, r.v]));
  const lastSeen = await map(`SELECT subject AS k, MAX(ts) AS v FROM events WHERE kind IN ${SEEN} AND subject IS NOT NULL GROUP BY subject`);
  const lastSignIn = await map("SELECT subject AS k, MAX(ts) AS v FROM events WHERE kind = 'sign_in' AND outcome = 'ok' AND subject IS NOT NULL GROUP BY subject");
  const assistants = await map(
    "SELECT subject AS k, COUNT(DISTINCT client_id) AS v FROM oauth_refresh_tokens WHERE revoked_at IS NULL AND expires_at > ? GROUP BY subject",
    nowIso,
  );
  const calls = await map("SELECT subject AS k, COUNT(*) AS v FROM events WHERE kind = 'tool' AND ts >= ? AND subject IS NOT NULL GROUP BY subject", week);
  const sent = await map("SELECT owner AS k, COUNT(*) AS v FROM packets WHERE revoked_at IS NULL AND expires_at > ? GROUP BY owner", nowIso);
  const received = await map(
    `SELECT recipient AS k, COUNT(*) AS v FROM packets
     WHERE revoked_at IS NULL AND expires_at > ? AND recipient IS NOT NULL AND recipient != owner AND recipient != '*' GROUP BY recipient`,
    nowIso,
  );
  const team = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM packets WHERE recipient = '*' AND revoked_at IS NULL AND expires_at > ?", nowIso);
  const n = (m: Map<string, string | number>, k: string) => Number(m.get(k) ?? 0);
  const s = (m: Map<string, string | number>, k: string) => (m.get(k) as string | undefined) ?? null;
  return {
    rows: base.map((b) => ({
      handle: b.handle,
      created_at: b.created_at,
      admin: !!b.admin,
      last_seen: s(lastSeen, b.handle),
      last_sign_in: s(lastSignIn, b.handle),
      assistants: n(assistants, b.handle),
      calls: n(calls, b.handle),
      sent: n(sent, b.handle),
      received: n(received, b.handle),
    })),
    teamPackets: team?.n ?? 0,
  };
}

// ---- assistants ---------------------------------------------------------------------------------------------

export interface AssistantRow {
  subject: string;
  client_id: string;
  client: ClientInfo | null;
  announced: { name: string; version: string | null } | null;
  first_seen: string | null;
  last_seen: string | null;
  calls: number;
  failed: number;
  /** A refresh token that still works, or an access token issued after the last revocation that may still work. */
  connected: boolean;
  refresh_until: string | null;
}

export interface AssistantsData {
  members: string[];
  rows: AssistantRow[];
  unused: ClientInfo[];
  rejected: Array<{ reason: string; n: number; last: string }>;
  badSignIns: Array<{ subject: string | null; n: number; last: string }>;
  clients: Map<string, ClientInfo>;
}

export async function assistants(db: D1Database, now = Date.now()): Promise<AssistantsData> {
  const nowIso = new Date(now).toISOString();
  const week = isoAgo(now, WINDOW_DAYS * DAY);
  const clients = await clientsById(db);
  const memberList = (await all<{ handle: string }>(db, "SELECT handle FROM members ORDER BY handle")).map((r) => r.handle);
  const rows = new Map<string, AssistantRow>();
  const row = (subject: string, client_id: string): AssistantRow => {
    const k = pair(subject, client_id);
    let r = rows.get(k);
    if (!r) {
      r = { subject, client_id, client: clients.get(client_id) ?? null, announced: null, first_seen: null, last_seen: null, calls: 0, failed: 0, connected: false, refresh_until: null };
      rows.set(k, r);
    }
    return r;
  };

  for (const t of await all<{ subject: string; client_id: string; until: string }>(
    db,
    "SELECT subject, client_id, MAX(expires_at) AS until FROM oauth_refresh_tokens WHERE revoked_at IS NULL AND expires_at > ? GROUP BY subject, client_id",
    nowIso,
  )) {
    const r = row(t.subject, t.client_id);
    r.connected = true;
    r.refresh_until = t.until;
  }
  for (const e of await all<{ subject: string; client_id: string; first: string; last: string }>(
    db,
    `SELECT subject, client_id, MIN(ts) AS first, MAX(ts) AS last FROM events
     WHERE kind IN ${SEEN} AND subject IS NOT NULL AND client_id IS NOT NULL GROUP BY subject, client_id`,
  )) {
    const r = row(e.subject, e.client_id);
    r.first_seen = e.first;
    r.last_seen = e.last;
  }
  for (const c of await all<{ subject: string; client_id: string; n: number; failed: number }>(
    db,
    `SELECT subject, client_id, COUNT(*) AS n, SUM(outcome != 'ok') AS failed FROM events
     WHERE kind = 'tool' AND ts >= ? AND subject IS NOT NULL AND client_id IS NOT NULL GROUP BY subject, client_id`,
    week,
  )) {
    const r = row(c.subject, c.client_id);
    r.calls = c.n;
    r.failed = c.failed ?? 0;
  }
  // SQLite returns the other columns from the row that holds MAX(ts): the latest initialize.
  for (const a of await all<{ subject: string; client_id: string; name: string | null; detail: string | null; at: string }>(
    db,
    `SELECT subject, client_id, name, detail, MAX(ts) AS at FROM events
     WHERE kind = 'initialize' AND subject IS NOT NULL AND client_id IS NOT NULL GROUP BY subject, client_id`,
  )) {
    const version = detailOf(a).version;
    row(a.subject, a.client_id).announced = { name: a.name ?? "unnamed", version: typeof version === "string" ? version : null };
  }
  // An access token lives 8 hours. One issued after the last revocation may still work without a refresh token.
  const revoked = new Map(
    (await all<{ subject: string; client_id: string; revoked_at: string }>(db, "SELECT subject, client_id, revoked_at FROM access_revocations")).map((r) => [
      pair(r.subject, r.client_id),
      r.revoked_at,
    ]),
  );
  for (const t of await all<{ subject: string; client_id: string; at: string }>(
    db,
    "SELECT subject, client_id, MAX(ts) AS at FROM events WHERE kind = 'token' AND ts >= ? AND subject IS NOT NULL GROUP BY subject, client_id",
    isoAgo(now, ACCESS_TOKEN_MS),
  )) {
    const r = rows.get(pair(t.subject, t.client_id));
    if (!r || r.connected) continue;
    const cut = [revoked.get(pair(t.subject, t.client_id)), revoked.get(pair(t.subject, "*"))].filter(Boolean).sort().pop();
    if (!cut || t.at > cut) r.connected = true;
  }

  const unused = [...clients.values()].filter((c) => !c.last_used_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const rejected = await all<{ reason: string; n: number; last: string }>(
    db,
    "SELECT name AS reason, COUNT(*) AS n, MAX(ts) AS last FROM events WHERE kind = 'auth' AND ts >= ? GROUP BY name ORDER BY n DESC LIMIT 20",
    week,
  );
  const badSignIns = await all<{ subject: string | null; n: number; last: string }>(
    db,
    "SELECT subject, COUNT(*) AS n, MAX(ts) AS last FROM events WHERE kind = 'sign_in' AND outcome != 'ok' AND ts >= ? GROUP BY subject ORDER BY n DESC LIMIT 20",
    week,
  );
  const sorted = [...rows.values()].sort(
    (a, b) => a.subject.localeCompare(b.subject) || Number(b.connected) - Number(a.connected) || (b.last_seen ?? "").localeCompare(a.last_seen ?? ""),
  );
  return { members: memberList, rows: sorted, unused, rejected, badSignIns, clients };
}

// ---- ops ----------------------------------------------------------------------------------------------------

export interface OpsData {
  now: number;
  version: WorkerVersionMetadata | null;
  migrations: Array<{ name: string; applied_at: string }> | null;
  files: Array<{ state: string; n: number; b: number }>;
  counts: Record<string, number>;
  oldestEvent: string | null;
  cleanups: EventRow[];
  problems: EventRow[];
  audit: EventRow[];
  signingKey: OverviewData["signingKey"];
  clients: Map<string, ClientInfo>;
  update: UpdateState;
}

export async function ops(env: Env, cfg: Config, now = Date.now()): Promise<OpsData> {
  const db = env.DB;
  const nowIso = new Date(now).toISOString();
  let migrations: OpsData["migrations"] = null;
  try {
    migrations = await all<{ name: string; applied_at: string }>(db, "SELECT name, applied_at FROM d1_migrations ORDER BY id");
  } catch {
    // Applied by another tool, or a database without the migrations table.
  }
  const counts =
    (await one<Record<string, number>>(
      db,
      `SELECT (SELECT COUNT(*) FROM packets) AS packets,
              (SELECT COUNT(*) FROM packets WHERE revoked_at IS NULL AND expires_at > ?) AS packets_live,
              (SELECT COUNT(*) FROM tickets WHERE used_at IS NULL AND expires_at > ?) AS tickets_live,
              (SELECT COUNT(*) FROM members) AS members,
              (SELECT COUNT(*) FROM admin_members) AS admins,
              (SELECT COUNT(*) FROM admin_sessions WHERE expires_at > ?) AS console_sessions,
              (SELECT COUNT(*) FROM oauth_clients) AS clients,
              (SELECT COUNT(*) FROM oauth_refresh_tokens WHERE revoked_at IS NULL AND expires_at > ?) AS refresh_live,
              (SELECT COUNT(*) FROM access_revocations) AS revocations,
              (SELECT COUNT(*) FROM events) AS events`,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    )) ?? {};
  return {
    now,
    version: env.CF_VERSION_METADATA ?? null,
    update: await updateState(env),
    migrations,
    files: await all<{ state: string; n: number; b: number }>(db, "SELECT state, COUNT(*) AS n, COALESCE(SUM(size), 0) AS b FROM attachments GROUP BY state ORDER BY state"),
    counts,
    oldestEvent: (await one<{ ts: string | null }>(db, "SELECT MIN(ts) AS ts FROM events"))?.ts ?? null,
    cleanups: await all<EventRow>(db, "SELECT * FROM events WHERE kind = 'cleanup' ORDER BY id DESC LIMIT 10"),
    problems: await all<EventRow>(db, "SELECT * FROM events WHERE outcome NOT IN ('ok', 'backlog') ORDER BY id DESC LIMIT 30"),
    audit: await all<EventRow>(db, "SELECT * FROM events WHERE kind = 'console' ORDER BY id DESC LIMIT 20"),
    signingKey: await signingKey(db, cfg),
    clients: await clientsById(db),
  };
}
