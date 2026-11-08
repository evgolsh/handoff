import { constantTimeEqual } from "../auth/builtin";
import { newTicketToken, nowIso, sha256Hex } from "../domain/ids";

/**
 * Browser sessions: one per signed-in member, from whichever page they signed in. The browser holds a random
 * token in a __Host- cookie (Secure, HttpOnly, SameSite=Strict); D1 keeps only its hash, bound to the member's
 * code hash, so a code reset ends the session. Every page knows who is signed in; the console also checks the
 * admin grant on every request.
 */
export const COOKIE = "__Host-handoff-session";
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

/** Whether the browser sent a session cookie. Public pages use it to show Assets instead of Sign in. */
export const hasSessionCookie = (header: string | undefined): boolean => cookieToken(header) !== null;

export async function sessionFrom(db: D1Database, header: string | undefined): Promise<Session | null> {
  const raw = cookieToken(header);
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const row = await db
    .prepare(
      `SELECT s.handle FROM member_sessions s
         JOIN members m ON m.handle = s.handle AND m.code_hash = s.credential_hash
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(hash, nowIso())
    .first<{ handle: string }>();
  return row ? { handle: row.handle, hash, csrf: await sha256Hex(`csrf:${raw}`) } : null;
}

/** Starts a session for a member whose code was checked. Returns the Set-Cookie value, or null if no such member. */
export async function startSession(db: D1Database, handle: string): Promise<string | null> {
  const member = await db.prepare("SELECT code_hash FROM members WHERE handle = ?").bind(handle).first<{ code_hash: string }>();
  if (!member) return null;
  const raw = newTicketToken();
  await db
    .prepare("INSERT INTO member_sessions (token_hash, handle, credential_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(raw), handle, member.code_hash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString())
    .run();
  return sessionCookie(raw, SESSION_SECONDS);
}

/** Ends this browser's session. Returns the Set-Cookie value that clears it. */
export async function endSession(db: D1Database, header: string | undefined): Promise<string> {
  const raw = cookieToken(header);
  if (raw) await db.prepare("DELETE FROM member_sessions WHERE token_hash = ?").bind(await sha256Hex(raw)).run();
  return sessionCookie("", 0);
}

/**
 * Where to go after signing in: a path on this site. Never another site's address ("//host", or any backslash,
 * which browsers may read as a slash), never a control character, and never the sign-in itself. Otherwise null.
 */
export function safeNext(next: string | undefined | null): string | null {
  if (!next || next.length > 512 || !next.startsWith("/") || next.startsWith("//")) return null;
  if (/[\u0000-\u001f\\]/.test(next)) return null;
  const path = next.split(/[?#]/)[0]!;
  return path === "/login" || path === "/logout" ? null : next;
}

/** Whether the member has the admin grant (the left menu then shows the team's pages). */
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
export async function loginAllowed(db: D1Database, ip: string | undefined, purpose = "login"): Promise<boolean> {
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
