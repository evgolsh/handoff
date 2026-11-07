import { constantTimeEqual } from "../auth/builtin";
import { newTicketToken, nowIso, sha256Hex } from "../domain/ids";

/**
 * Browser sessions. The browser holds a random token in a __Host- cookie (Secure, HttpOnly, SameSite=Strict);
 * D1 keeps only its hash, bound to the member's code hash, so a code reset ends the session. Two kinds: the
 * console, where only members in admin_members sign in (the operator grants that with `npm run admin`), and
 * My account (/account), where any member signs in. Each kind has its own cookie and table, so a member's
 * account session never opens the console. One sign-in starts both for an admin (startSessions), and signing
 * out ends both (endSessions).
 */
export interface SessionKind {
  cookie: string;
  table: "admin_sessions" | "member_sessions";
  /** Console sessions also need the admin grant, checked on every request. */
  adminOnly: boolean;
}
export const CONSOLE_SESSIONS: SessionKind = { cookie: "__Host-handoff-console", table: "admin_sessions", adminOnly: true };
export const ACCOUNT_SESSIONS: SessionKind = { cookie: "__Host-handoff-account", table: "member_sessions", adminOnly: false };

export const COOKIE = CONSOLE_SESSIONS.cookie;
export const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60_000;

export interface Session {
  handle: string;
  /** sha256 of the cookie token: the session's id in D1. */
  hash: string;
  /** Hidden value in every form: sha256("csrf:" + cookie token). A page from another site cannot know it. */
  csrf: string;
}

export const sessionCookie = (value: string, seconds: number, kind: SessionKind = CONSOLE_SESSIONS): string =>
  `${kind.cookie}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;

export function cookieToken(header: string | undefined, kind: SessionKind = CONSOLE_SESSIONS): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === kind.cookie) {
      const v = rest.join("=");
      return v && v.length <= 200 ? v : null;
    }
  }
  return null;
}

export async function sessionFrom(db: D1Database, raw: string | null, kind: SessionKind = CONSOLE_SESSIONS): Promise<Session | null> {
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const row = await db
    .prepare(
      `SELECT s.handle FROM ${kind.table} s
         JOIN members m ON m.handle = s.handle AND m.code_hash = s.credential_hash
         ${kind.adminOnly ? "JOIN admin_members a ON a.handle = s.handle" : ""}
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(hash, nowIso())
    .first<{ handle: string }>();
  return row ? { handle: row.handle, hash, csrf: await sha256Hex(`csrf:${raw}`) } : null;
}

/** Starts a session for a member whose code was checked (for the console, an admin). Returns the Set-Cookie value. */
export async function startSession(db: D1Database, handle: string, kind: SessionKind = CONSOLE_SESSIONS): Promise<string | null> {
  const member = await db
    .prepare(
      kind.adminOnly
        ? "SELECT m.code_hash FROM members m JOIN admin_members a ON a.handle = m.handle WHERE m.handle = ?"
        : "SELECT code_hash FROM members WHERE handle = ?",
    )
    .bind(handle)
    .first<{ code_hash: string }>();
  if (!member) return null;
  const raw = newTicketToken();
  await db
    .prepare(`INSERT INTO ${kind.table} (token_hash, handle, credential_hash, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(await sha256Hex(raw), handle, member.code_hash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString())
    .run();
  return sessionCookie(raw, SESSION_SECONDS, kind);
}

/**
 * One sign-in for both areas, after the member's code was checked: a My account session for every member, and a
 * console session too when the member is an admin. The console still checks the admin grant on every request.
 * Returns the Set-Cookie values, the console's first; empty if the member does not exist.
 */
export async function startSessions(db: D1Database, handle: string): Promise<string[]> {
  const cookies: string[] = [];
  for (const kind of [CONSOLE_SESSIONS, ACCOUNT_SESSIONS]) {
    const cookie = await startSession(db, handle, kind);
    if (cookie) cookies.push(cookie);
  }
  return cookies;
}

/** Signing out of either area ends this browser's sessions of both kinds. Returns the Set-Cookie values that clear them. */
export async function endSessions(db: D1Database, cookieHeader: string | undefined): Promise<string[]> {
  for (const kind of [ACCOUNT_SESSIONS, CONSOLE_SESSIONS]) {
    const raw = cookieToken(cookieHeader, kind);
    if (raw) await db.prepare(`DELETE FROM ${kind.table} WHERE token_hash = ?`).bind(await sha256Hex(raw)).run();
  }
  return [sessionCookie("", 0, ACCOUNT_SESSIONS), sessionCookie("", 0, CONSOLE_SESSIONS)];
}

/** Whether the member has the admin grant (My account then links to the console). */
export async function isAdmin(db: D1Database, handle: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM admin_members WHERE handle = ?").bind(handle).first());
}

/** A 303 redirect that sets several cookies (a header object cannot repeat Set-Cookie). */
export function redirectSetting(to: string, cookies: string[]): Response {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 303, headers });
}

export const csrfOk = (s: Session, sent: unknown): boolean => typeof sent === "string" && constantTimeEqual(sent, s.csrf);

/** A form POST must come from a page of this origin. Browsers send Origin on every form POST. */
export const sameOrigin = (origin: string | undefined, publicUrl: string): boolean => {
  try {
    return !!origin && origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
};

/**
 * Counts a sign-in attempt from this address: at most 10 in 10 minutes. Cloudflare sets CF-Connecting-IP;
 * only its hash is stored. Returns false when the limit is reached.
 */
export async function loginAllowed(db: D1Database, ip: string | undefined, purpose = "console-login"): Promise<boolean> {
  const bucket = await sha256Hex(`${purpose}:${ip ?? "local"}`);
  const now = nowIso();
  await db.prepare("DELETE FROM admin_login_limits WHERE expires_at <= ?").bind(now).run();
  const row = await db
    .prepare(
      `INSERT INTO admin_login_limits (bucket, attempts, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1
       RETURNING attempts`,
    )
    .bind(bucket, new Date(Date.now() + LOGIN_WINDOW_MS).toISOString())
    .first<{ attempts: number }>();
  return !!row && row.attempts <= LOGIN_ATTEMPTS;
}
