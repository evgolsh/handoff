import type { Config } from "../env";
import { codeRecord, isValidHandle, newAccessCode, normalizeHandle } from "../auth/builtin";
import { recordEvent } from "../store/events";
import { HandoffError } from "./errors";
import { newTicketToken, nowIso, plusMs, sha256Hex } from "./ids";
import { handleOf, qualify, tenantOf } from "./tenant";

/**
 * Invitation links. A team admin (or their assistant, through threadpacket_invite) names a username; the member is
 * created with an access code nobody knows, and a link is returned. The invitee opens the link and presses a
 * button (a POST, so link previews in messengers do not use it up): that sets a new access code and shows it
 * once, with the steps to connect their assistant. Asking again for the same username replaces the open link.
 */

export const INVITE_TTL_MS = 7 * 86_400_000;

export interface Invitation {
  username: string;
  /** The team name on the hosted service; "" on a private install. */
  team: string;
  invite_url: string;
  expires_at: string;
  /** False when the username already existed: opening the link gives them a new access code. */
  new_member: boolean;
}

async function randomCodeHash(): Promise<{ salt: string; hash: string; lookup: string; code: string }> {
  const code = newAccessCode();
  return { ...(await codeRecord(code)), code };
}

export async function createInvitation(db: D1Database, cfg: Config, inviter: string, rawHandle: string): Promise<Invitation> {
  const admin = await db.prepare("SELECT 1 AS ok FROM admin_members WHERE handle = ?").bind(inviter).first();
  if (!admin) throw new HandoffError("invalid_input", "only a team admin can invite people. Ask your team's admin, who can invite you a teammate or make you an admin in the console.");
  const handle = normalizeHandle(rawHandle);
  if (!isValidHandle(handle)) {
    throw new HandoffError("invalid_input", "username: 1 to 63 lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit; team and all are reserved");
  }
  const tenant = tenantOf(inviter);
  const identity = qualify(tenant, handle);
  if (identity === inviter) throw new HandoffError("invalid_input", "that is the inviter's own username");

  const exists = !!(await db.prepare("SELECT 1 AS ok FROM members WHERE handle = ?").bind(identity).first());
  if (!exists) {
    const cap = cfg.tenantMembersCap;
    if (tenant && cap > 0) {
      const n = await db.prepare("SELECT COUNT(*) AS n FROM members WHERE handle >= ? AND handle < ?").bind(`${tenant}/`, `${tenant}0`).first<{ n: number }>();
      if ((n?.n ?? 0) >= cap) throw new HandoffError("quota_exceeded", `this team has ${cap} people, the most the hosted service allows. A private Threadpacket server has no limit.`);
    }
    const { salt, hash, lookup } = await randomCodeHash();
    await db.prepare("INSERT INTO members (handle, code_salt, code_hash, code_lookup, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(handle) DO NOTHING").bind(identity, salt, hash, lookup, nowIso()).run();
  }

  const token = newTicketToken();
  const expires_at = plusMs(INVITE_TTL_MS);
  await db.batch([
    db.prepare("DELETE FROM invites WHERE handle = ? AND used_at IS NULL").bind(identity),
    db.prepare("INSERT INTO invites (token_hash, handle, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(await sha256Hex(token), identity, inviter, nowIso(), expires_at),
  ]);
  await recordEvent(db, { kind: "console", name: "invite", subject: inviter, outcome: exists ? "reinvite" : "ok" });
  return { username: handle, team: tenant, invite_url: `${cfg.publicUrl}/invite/${token}`, expires_at, new_member: !exists };
}

export interface InviteView {
  username: string;
  team: string;
  invited_by: string;
  expires_at: string;
  state: "open" | "used" | "expired";
}

export async function viewInvitation(db: D1Database, token: string): Promise<InviteView | null> {
  if (!token || token.length > 200) return null;
  const row = await db
    .prepare("SELECT handle, invited_by, expires_at, used_at FROM invites WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ handle: string; invited_by: string; expires_at: string; used_at: string | null }>();
  if (!row) return null;
  const state = row.used_at ? "used" : row.expires_at <= nowIso() ? "expired" : "open";
  return { username: handleOf(row.handle), team: tenantOf(row.handle), invited_by: handleOf(row.invited_by), expires_at: row.expires_at, state };
}

/** Uses the link once: sets and returns the member's new access code. Null if it was used, expired or unknown. */
export async function redeemInvitation(db: D1Database, token: string): Promise<{ view: InviteView; code: string } | null> {
  const view = await viewInvitation(db, token);
  if (!view || view.state !== "open") return null;
  const hashed = await sha256Hex(token);
  const claimed = await db.prepare("UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(nowIso(), hashed, nowIso()).run();
  if (claimed.meta.changes !== 1) return null;
  const identity = qualify(view.team, view.username);
  const { salt, hash, lookup, code } = await randomCodeHash();
  await db.prepare("UPDATE members SET code_salt = ?, code_hash = ?, code_lookup = ? WHERE handle = ?").bind(salt, hash, lookup, identity).run();
  await recordEvent(db, { kind: "console", name: "invite_open", subject: identity, outcome: "ok" });
  return { view: { ...view, state: "used" }, code };
}
