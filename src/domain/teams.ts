import type { Config } from "../env";
import { codeRecord, isValidHandle, newAccessCode, normalizeHandle } from "../auth/builtin";
import { loginAllowed } from "../console/session";
import { recordEvent } from "../store/events";
import { nowIso } from "./ids";
import { isValidTenant, qualify } from "./tenant";

/**
 * Creating a team on the hosted service: the team, its first member and that member's admin grant, in one
 * transaction. Used by the sign-up page (/join) and by the sign-in page an assistant opens (/authorize), so a
 * new person can start from either. The team name is optional: someone on their own gets a team named after
 * their username (with a number when that name is taken), and never has to type it, because sign-in asks only
 * for the username and access code.
 */

export const JOIN_ATTEMPTS_PURPOSE = "join";

export type CreatedTeam =
  | { ok: true; team: string; handle: string; identity: string; code: string }
  | { ok: false; team: string; handle: string; error: string; status: number };

/** A team name made from a username: dots and underscores become hyphens, and a short one gets "-team". */
export function teamFromUsername(handle: string): string {
  let t = handle.replace(/[._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32).replace(/-$/, "");
  if (t.length < 3) t = `${t}-team`;
  return isValidTenant(t) ? t : `${t.slice(0, 27).replace(/-$/, "")}-team`;
}

export async function createTeam(db: D1Database, cfg: Config, rawTeam: string, rawHandle: string, ip: string | undefined): Promise<CreatedTeam> {
  const typed = normalizeHandle(rawTeam);
  const handle = normalizeHandle(rawHandle);
  const fail = (error: string, status: number, team = typed): CreatedTeam => ({ ok: false, team, handle, error, status });
  if (!(await loginAllowed(db, ip, JOIN_ATTEMPTS_PURPOSE))) return fail("Too many attempts from this address. Try again in 10 minutes.", 429);
  if (!isValidHandle(handle)) return fail("Username: 1 to 63 letters, digits, dots, underscores or hyphens, starting with a letter or digit. team and all are reserved.", 400);
  if (typed && !isValidTenant(typed)) return fail("Team name: 3 to 32 lower-case letters, digits or hyphens, starting and ending with a letter or digit. Some names are reserved.", 400);

  // A typed name is used as it is. Without one: the username's own team, then a numbered one if that is taken.
  const base = typed || teamFromUsername(handle);
  const names = typed ? [base] : [base, ...[0, 1, 2].map(() => `${base.slice(0, 27).replace(/-$/, "")}-${100 + Math.floor(Math.random() * 900)}`)];
  for (const team of names) {
    const made = await insertTeam(db, cfg, team, handle);
    if (made) return made;
  }
  await recordEvent(db, { kind: "console", name: "join", outcome: "taken" }, { unauthenticated: true });
  return fail(`The team name ${base} is taken. Choose another, or ask that team's admin to invite you.`, 409);
}

/** One try at a team name. Null when the name is taken. */
async function insertTeam(db: D1Database, cfg: Config, team: string, handle: string): Promise<CreatedTeam | null> {
  const identity = qualify(team, handle);
  const code = newAccessCode();
  const { salt, hash, lookup } = await codeRecord(code);
  const at = nowIso();
  // One transaction: the tenant, its first member and the admin grant are written only if the name is free.
  const done = await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenants (slug, name, created_at, members_cap) VALUES (?, ?, ?, ?)").bind(team, team, at, cfg.tenantMembersCap || 10),
    db
      .prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, code_lookup, created_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tenants WHERE slug = ? AND created_at = ?)")
      .bind(identity, salt, hash, lookup, at, team, at),
    db.prepare("INSERT OR IGNORE INTO admin_members (handle) SELECT ? WHERE EXISTS (SELECT 1 FROM members WHERE handle = ? AND code_hash = ?)").bind(identity, identity, hash),
  ]);
  if ((done[0]?.meta.changes ?? 0) !== 1) return null;
  await recordEvent(db, { kind: "console", name: "join", subject: identity, outcome: "ok" });
  return { ok: true, team, handle, identity, code };
}
