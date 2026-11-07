import type { Config } from "../env";
import { hashAccessCode, isValidHandle, newAccessCode, normalizeHandle } from "../auth/builtin";
import { loginAllowed } from "../console/session";
import { recordEvent } from "../store/events";
import { nowIso, sha256Hex } from "./ids";
import { isValidTenant, qualify } from "./tenant";

/**
 * Creating a team on the hosted service: the team, its first member and that member's admin grant, in one
 * transaction. Used by the sign-up page (/join) and by the sign-in page an assistant opens (/authorize), so a
 * new person can start from either.
 */

export const JOIN_ATTEMPTS_PURPOSE = "join";

export type CreatedTeam =
  | { ok: true; team: string; handle: string; identity: string; code: string }
  | { ok: false; team: string; handle: string; error: string; status: number };

export async function createTeam(db: D1Database, cfg: Config, rawTeam: string, rawHandle: string, ip: string | undefined): Promise<CreatedTeam> {
  const team = normalizeHandle(rawTeam);
  const handle = normalizeHandle(rawHandle);
  const fail = (error: string, status: number): CreatedTeam => ({ ok: false, team, handle, error, status });
  if (!(await loginAllowed(db, ip, JOIN_ATTEMPTS_PURPOSE))) return fail("Too many attempts from this address. Try again in 10 minutes.", 429);
  if (!isValidTenant(team)) return fail("Team name: 3 to 32 lower-case letters, digits or hyphens, starting and ending with a letter or digit. Some names are reserved.", 400);
  if (!isValidHandle(handle)) return fail("Username: 1 to 63 letters, digits, dots, underscores or hyphens, starting with a letter or digit. team and all are reserved.", 400);

  const identity = qualify(team, handle);
  const code = newAccessCode();
  const salt = await sha256Hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashAccessCode(code, salt);
  const at = nowIso();
  // One transaction: the tenant, its first member and the admin grant are written only if the name is free.
  const done = await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenants (slug, name, created_at, members_cap) VALUES (?, ?, ?, ?)").bind(team, team, at, cfg.tenantMembersCap || 10),
    db
      .prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tenants WHERE slug = ? AND created_at = ?)")
      .bind(identity, salt, hash, at, team, at),
    db.prepare("INSERT OR IGNORE INTO admin_members (handle) SELECT ? WHERE EXISTS (SELECT 1 FROM members WHERE handle = ? AND code_hash = ?)").bind(identity, identity, hash),
  ]);
  if ((done[0]?.meta.changes ?? 0) !== 1) {
    await recordEvent(db, { kind: "console", name: "join", outcome: "taken" }, { unauthenticated: true });
    return fail(`The team name ${team} is taken. Choose another, or ask that team's admin to invite you.`, 409);
  }
  await recordEvent(db, { kind: "console", name: "join", subject: identity, outcome: "ok" });
  return { ok: true, team, handle, identity, code };
}
