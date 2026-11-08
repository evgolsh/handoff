import { constantTimeEqual } from "../auth/builtin";
import { newTicketToken, nowIso, sha256Hex } from "../domain/ids";

/**
 * Browser sessions. A browser can be signed in to a few accounts at once (on the hosted service, one per team),
 * like any service with an account switcher: the cookie holds one random token per account, the active one first.
 * D1 keeps only each token's hash, bound to the member's code hash, so a code reset ends that session. Every page
 * knows who is signed in; the console also checks the admin grant on every request.
 *
 * A session lasts 30 days and is renewed while used. The cookie itself lives longer (400 days, the most browsers
 * keep), because D1 decides when a session ends; the sign-in page clears a cookie whose sessions all ended.
 */
export const COOKIE = "__Host-handoff-session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_SECONDS = 400 * 24 * 60 * 60;
/** Renew a session's 30 days at most once a day. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_ACCOUNTS = 5;
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 10 * 60_000;

export interface Session {
  handle: string;
  /** sha256 of the cookie token: the session's id in D1. */
  hash: string;
  /** Hidden value in every form: sha256("csrf:" + cookie token). A page from another site cannot know it. */
  csrf: string;
  /** The other accounts this browser is signed in to, as identities, in the order they were last used. */
  others: string[];
}

export const sessionCookie = (value: string, seconds: number): string =>
  `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;

const cookieValue = (header: string | undefined, name: string): string | null => {
  for (const part of (header ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
};

/** The session tokens the browser sent, the active one first. */
export function cookieTokens(header: string | undefined): string[] {
  const v = cookieValue(header, COOKIE);
  if (!v || v.length > 400) return [];
  return v.split(".").filter((t) => /^[A-Za-z0-9_-]{20,64}$/.test(t)).slice(0, MAX_ACCOUNTS);
}

/** Whether the browser sent a session cookie. Public pages use it to show Assets instead of Sign in. */
export const hasSessionCookie = (header: string | undefined): boolean => cookieTokens(header).length > 0;

interface Live {
  raw: string;
  hash: string;
  handle: string;
  expires: string;
}

/** The browser's sessions that are still valid, in cookie order. */
async function liveSessions(db: D1Database, header: string | undefined): Promise<Live[]> {
  const tokens = cookieTokens(header);
  if (!tokens.length) return [];
  const hashes = await Promise.all(tokens.map((t) => sha256Hex(t)));
  const rows = await db
    .prepare(
      `SELECT s.token_hash, s.handle, s.expires_at FROM member_sessions s
         JOIN members m ON m.handle = s.handle AND m.code_hash = s.credential_hash
       WHERE s.token_hash IN (${hashes.map(() => "?").join(", ")}) AND s.expires_at > ?`,
    )
    .bind(...hashes, nowIso())
    .all<{ token_hash: string; handle: string; expires_at: string }>();
  const byHash = new Map(rows.results.map((r) => [r.token_hash, r]));
  return tokens.flatMap((raw, i) => {
    const r = byHash.get(hashes[i]!);
    return r ? [{ raw, hash: r.token_hash, handle: r.handle, expires: r.expires_at }] : [];
  });
}

/** The active session (the first of the browser's sessions that is still valid), renewed while used. */
export async function sessionFrom(db: D1Database, header: string | undefined): Promise<Session | null> {
  const live = await liveSessions(db, header);
  const active = live[0];
  if (!active) return null;
  if (Date.parse(active.expires) < Date.now() + SESSION_SECONDS * 1000 - RENEW_AFTER_MS) {
    await db
      .prepare("UPDATE member_sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(), active.hash)
      .run();
  }
  return { handle: active.handle, hash: active.hash, csrf: await sha256Hex(`csrf:${active.raw}`), others: live.slice(1).map((l) => l.handle) };
}

/**
 * Starts a session for a member whose code was checked and makes it this browser's active one. The browser's
 * other accounts stay signed in; an older session of the same member is replaced. Returns the Set-Cookie value,
 * or null if there is no such member.
 */
export async function startSession(db: D1Database, handle: string, header?: string): Promise<string | null> {
  const member = await db.prepare("SELECT code_hash FROM members WHERE handle = ?").bind(handle).first<{ code_hash: string }>();
  if (!member) return null;
  const raw = newTicketToken();
  await db
    .prepare("INSERT INTO member_sessions (token_hash, handle, credential_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(raw), handle, member.code_hash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString())
    .run();
  const live = await liveSessions(db, header);
  const kept = live.filter((l) => l.handle !== handle).slice(0, MAX_ACCOUNTS - 1);
  const dropped = live.filter((l) => !kept.includes(l));
  if (dropped.length) {
    await db.prepare(`DELETE FROM member_sessions WHERE token_hash IN (${dropped.map(() => "?").join(", ")})`).bind(...dropped.map((l) => l.hash)).run();
  }
  return sessionCookie([raw, ...kept.map((l) => l.raw)].join("."), COOKIE_SECONDS);
}

/** Makes another of this browser's accounts the active one. Returns the Set-Cookie value, or null if it is not signed in here. */
export async function switchSession(db: D1Database, header: string | undefined, identity: string): Promise<string | null> {
  const live = await liveSessions(db, header);
  const to = live.find((l) => l.handle === identity);
  if (!to) return null;
  return sessionCookie([to, ...live.filter((l) => l !== to)].map((l) => l.raw).join("."), COOKIE_SECONDS);
}

/** Signs this browser out of every account. Returns the Set-Cookie value that clears the cookie. */
export async function endSession(db: D1Database, header: string | undefined): Promise<string> {
  const tokens = cookieTokens(header);
  if (tokens.length) {
    const hashes = await Promise.all(tokens.map((t) => sha256Hex(t)));
    await db.prepare(`DELETE FROM member_sessions WHERE token_hash IN (${hashes.map(() => "?").join(", ")})`).bind(...hashes).run();
  }
  return sessionCookie("", 0);
}

/**
 * The teams this browser signed in to on the hosted service, most recent first, so the sign-in pages fill in the
 * team. Not a secret and not a session. SameSite=Lax, because an assistant opens the sign-in page from its own site.
 */
export const TEAMS_COOKIE = "__Host-handoff-teams";

export function rememberedTeams(header: string | undefined): string[] {
  const v = cookieValue(header, TEAMS_COOKIE);
  if (!v || v.length > 200) return [];
  return [...new Set(v.split(".").filter((t) => /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(t)))].slice(0, MAX_ACCOUNTS);
}

/** The Set-Cookie value that puts this team first among the remembered ones. */
export function rememberTeam(header: string | undefined, team: string): string {
  const teams = [team, ...rememberedTeams(header).filter((t) => t !== team)].slice(0, MAX_ACCOUNTS);
  return `${TEAMS_COOKIE}=${teams.join(".")}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_SECONDS}`;
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
