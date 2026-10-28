import { nowIso } from "../domain/ids";

/** What the console shows about activity. Never content: no titles, briefs, file names, codes or tokens. */
export interface HandoffEvent {
  kind: "tool" | "initialize" | "auth" | "sign_in" | "token" | "client_metadata" | "console" | "cleanup" | "update_check" | "visit";
  name?: string | null;
  subject?: string | null;
  client_id?: string | null;
  outcome: string;
  ms?: number | null;
  detail?: Record<string, unknown> | null;
}

/**
 * Events that anyone can cause without a valid token (rejected tokens, wrong codes) are capped per isolate,
 * so a flood of bad requests cannot fill the table. The console counts what was recorded.
 */
const UNAUTHENTICATED_PER_MINUTE = 60;
let floodWindow = 0;
let floodCount = 0;
function underFloodCap(): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== floodWindow) {
    floodWindow = minute;
    floodCount = 0;
  }
  return ++floodCount <= UNAUTHENTICATED_PER_MINUTE;
}

/** Records an event. Never throws: activity records must not break the call they describe. */
export async function recordEvent(db: D1Database, e: HandoffEvent, opts: { unauthenticated?: boolean } = {}): Promise<void> {
  if (opts.unauthenticated && !underFloodCap()) return;
  try {
    await db
      .prepare("INSERT INTO events (ts, kind, name, subject, client_id, outcome, ms, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        nowIso(),
        e.kind,
        e.name?.slice(0, 120) ?? null,
        e.subject?.slice(0, 128) ?? null,
        e.client_id?.slice(0, 512) ?? null,
        e.outcome.slice(0, 64),
        e.ms ?? null,
        e.detail ? JSON.stringify(e.detail).slice(0, 2000) : null,
      )
      .run();
  } catch {
    // Missing table (before migration 0005) or a D1 hiccup: the call itself goes on.
  }
}

/**
 * Ends a member's access through one client, or through every client ("*"): their refresh tokens stop
 * working, and access tokens issued until now are refused (src/auth/verify.ts). Signing in again works.
 */
export async function revokeAccess(db: D1Database, subject: string, clientId: string | "*"): Promise<void> {
  const at = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO access_revocations (subject, client_id, revoked_at) VALUES (?, ?, ?)
         ON CONFLICT(subject, client_id) DO UPDATE SET revoked_at = excluded.revoked_at`,
      )
      .bind(subject, clientId, at),
    clientId === "*"
      ? db.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE subject = ? AND revoked_at IS NULL").bind(at, subject)
      : db
          .prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE subject = ? AND client_id = ? AND revoked_at IS NULL")
          .bind(at, subject, clientId),
  ]);
}

/** The latest revocation that covers this member and client, as epoch milliseconds, or null. */
export async function revokedSince(db: D1Database, subject: string, clientId: string): Promise<number | null> {
  try {
    const row = await db
      .prepare("SELECT MAX(revoked_at) AS at FROM access_revocations WHERE subject = ? AND client_id IN (?, '*')")
      .bind(subject, clientId)
      .first<{ at: string | null }>();
    return row?.at ? Date.parse(row.at) : null;
  } catch {
    // Before migration 0005 there is nothing to revoke.
    return null;
  }
}

/** Notes that a client received tokens, so cleanup keeps its registration. */
export async function markClientUsed(db: D1Database, clientId: string): Promise<void> {
  try {
    await db.prepare("UPDATE oauth_clients SET last_used_at = ? WHERE client_id = ?").bind(nowIso(), clientId).run();
  } catch {
    // Before migration 0005.
  }
}

/** Removes update checks from instances not heard from in 90 days (src/update-check.ts). 0 before migration 0007. */
async function pruneInstances(db: D1Database, now: Date): Promise<number> {
  try {
    const r = await db.prepare("DELETE FROM instances_seen WHERE last_seen < ?").bind(new Date(now.getTime() - 90 * 86_400_000).toISOString()).run();
    return r.meta.changes ?? 0;
  } catch {
    return 0;
  }
}

export interface RecordsPruned {
  events: number;
  oauth_codes: number;
  refresh_tokens: number;
  unused_clients: number;
  revocations: number;
  console_sessions: number;
  /** Update checks from instances not heard from in 90 days (the hosted instance only). */
  instances: number;
}

/**
 * Removes records that no longer do anything: events older than 30 days, expired sign-in codes, refresh tokens
 * that expired or were revoked more than 7 days ago, client registrations never used in 7 days, revocations
 * older than any access token (9 hours), ended console sessions and login limits, and (where the update
 * check receiver is on) instances not heard from in 90 days.
 */
export async function pruneRecords(db: D1Database, now: Date = new Date()): Promise<RecordsPruned> {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const at = now.toISOString();
  const day = 86_400_000;
  const r = await db.batch([
    db.prepare("DELETE FROM events WHERE ts < ?").bind(ago(30 * day)),
    db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(at),
    db.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at < ? OR revoked_at < ?").bind(at, ago(7 * day)),
    db
      .prepare(
        `DELETE FROM oauth_clients WHERE last_used_at IS NULL AND created_at < ?
           AND client_id NOT IN (SELECT client_id FROM oauth_codes)
           AND client_id NOT IN (SELECT client_id FROM oauth_refresh_tokens)`,
      )
      .bind(ago(7 * day)),
    db.prepare("DELETE FROM access_revocations WHERE revoked_at < ?").bind(ago(9 * 3_600_000)),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(at),
    db.prepare("DELETE FROM admin_login_limits WHERE expires_at <= ?").bind(at),
  ]);
  const n = (i: number) => r[i]?.meta.changes ?? 0;
  const instances = await pruneInstances(db, now);
  return { events: n(0), oauth_codes: n(1), refresh_tokens: n(2), unused_clients: n(3), revocations: n(4), console_sessions: n(5) + n(6), instances };
}
