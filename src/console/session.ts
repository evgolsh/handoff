import { constantTimeEqual } from "../auth/builtin";
import { newTicketToken, nowIso, sha256Hex } from "../domain/ids";

/**
 * Console sessions. The browser holds a random token in a __Host- cookie (Secure, HttpOnly, SameSite=Strict);
 * D1 keeps only its hash, bound to the member's code hash, so a code reset ends the session. Only members in
 * admin_members can sign in; the operator grants that with `npm run admin`.
 */
export const COOKIE = "__Host-handoff-console";
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

export const sessionCookie = (value: string, seconds: number): string =>
  `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;

export function cookieToken(header: string | undefined): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) {
      const v = rest.join("=");
      return v && v.length <= 200 ? v : null;
    }
  }
  return null;
}

export async function sessionFrom(db: D1Database, raw: string | null): Promise<Session | null> {
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const row = await db
    .prepare(
      `SELECT s.handle FROM admin_sessions s
         JOIN members m ON m.handle = s.handle AND m.code_hash = s.credential_hash
         JOIN admin_members a ON a.handle = s.handle
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(hash, nowIso())
    .first<{ handle: string }>();
  return row ? { handle: row.handle, hash, csrf: await sha256Hex(`csrf:${raw}`) } : null;
}

/** Starts a session for an admin whose code was checked. Returns the Set-Cookie value. */
export async function startSession(db: D1Database, handle: string): Promise<string | null> {
  const member = await db
    .prepare("SELECT m.code_hash FROM members m JOIN admin_members a ON a.handle = m.handle WHERE m.handle = ?")
    .bind(handle)
    .first<{ code_hash: string }>();
  if (!member) return null;
  const raw = newTicketToken();
  await db
    .prepare("INSERT INTO admin_sessions (token_hash, handle, credential_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(raw), handle, member.code_hash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString())
    .run();
  return sessionCookie(raw, SESSION_SECONDS);
}

export async function endSession(db: D1Database, s: Session): Promise<void> {
  await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(s.hash).run();
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
