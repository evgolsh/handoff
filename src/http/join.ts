import type { Config } from "../env";
import { hashAccessCode, isValidHandle, newAccessCode, normalizeHandle } from "../auth/builtin";
import { nowIso, sha256Hex } from "../domain/ids";
import { isValidTenant, qualify } from "../domain/tenant";
import { CONSOLE_HEADERS, document, esc, type Html } from "../console/html";
import { loginAllowed, startSession } from "../console/session";
import { recordEvent } from "../store/events";
import { BRAND_ICON } from "./style";

/**
 * Sign-up on the control center (HANDOFF_MODE=control): a team name and a handle make a tenant and its first
 * admin, whose access code is shown once. The tenant then adds members in its own console at /console.
 */

const JOIN_ATTEMPTS_PURPOSE = "join";

export function joinPage(cfg: Config, opts: { error?: string; team?: string; handle?: string } = {}): Html {
  return document(
    "Create a team",
    `<div class="login">
  <div class="brand" style="font-size:18px">${BRAND_ICON}<span>Handoff</span></div>
  <form method="post" action="/join" class="panel" autocomplete="off">
    <div class="t">Create a team</div>
    <div class="small muted">This is the shared Handoff playground. A team is a private space for a few people and their assistants: packets live ${Math.round(cfg.defaultExpiryHours / 24) >= 1 ? `${Math.round(cfg.defaultExpiryHours / 24)} day` : `${cfg.defaultExpiryHours} hours`} by default, files up to ${Math.round(cfg.maxAttachmentBytes / 1048576)} MiB, at most ${cfg.tenantMembersCap} members. For private files or a larger team, <a class="u" href="/deploy" target="_blank" rel="noopener">run your own</a>.</div>
    ${opts.error ? `<div class="flash" role="alert">${esc(opts.error)}</div>` : ""}
    <div><label class="lbl" for="team">team name</label><input id="team" name="team" class="field" required autofocus maxlength="32" pattern="[a-z0-9][a-z0-9\\-]{1,30}[a-z0-9]" autocapitalize="none" spellcheck="false" placeholder="acme" value="${esc(opts.team ?? "")}"></div>
    <div class="small muted">3 to 32 lower-case letters, digits or hyphens. Your teammates type it when they sign in.</div>
    <div><label class="lbl" for="handle">your handle</label><input id="handle" name="handle" class="field" required maxlength="63" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,62}" autocapitalize="none" spellcheck="false" placeholder="tim" value="${esc(opts.handle ?? "")}"></div>
    <div><button type="submit" class="btn primary">Create the team</button></div>
    <div class="small muted">You become the team's admin and get an access code on the next page, shown once. Creating a team switches this browser to its console.</div>
  </form>
  <div class="small muted">Already have a team? Sign in to its <a class="u" href="/console/login">console</a>, or <a class="u" href="/connect">connect an assistant</a>.</div>
</div>`,
  );
}

export function joinedPage(team: string, handle: string, code: string, signedIn: boolean): Html {
  return document(
    "Team created",
    `<div class="login">
  <div class="brand" style="font-size:18px">${BRAND_ICON}<span>Handoff</span></div>
  <div class="panel">
    <div class="t">Team ${esc(team)} is ready</div>
    <div class="small">Your sign-in, for every assistant and for the console. The code is shown once; keep it somewhere safe.</div>
    <dl class="kv"><dt>team</dt><dd class="mono">${esc(team)}</dd><dt>handle</dt><dd class="mono">${esc(handle)}</dd><dt>access code</dt><dd class="mono">${esc(code)}</dd></dl>
    <div class="small">${signedIn ? `You are signed in as ${esc(handle)}, admin of ${esc(team)}.` : "Your team was created. Save the code above, then sign in to open its console."}</div>
    <div><a class="btn primary" href="/console/login?team=${encodeURIComponent(team)}">Open your team console</a></div>
    <div class="small">Or <a class="u" href="/connect">connect an assistant</a> with your team, handle and code.</div>
  </div>
</div>`,
  );
}

export const joinHeaders = (): Record<string, string> => ({ ...CONSOLE_HEADERS });

/** Handles the sign-up form. Returns the page to show and its status. */
export async function handleJoin(db: D1Database, cfg: Config, form: Record<string, string>, ip: string | undefined): Promise<{ status: number; body: Html; cookie?: string }> {
  const team = normalizeHandle(form.team ?? "");
  const handle = normalizeHandle(form.handle ?? "");
  const again = (error: string, status: number) => ({ status, body: joinPage(cfg, { error, team, handle }) });
  if (!(await loginAllowed(db, ip, JOIN_ATTEMPTS_PURPOSE))) return again("Too many attempts from this address. Try again in 10 minutes.", 429);
  if (!isValidTenant(team)) return again("Team name: 3 to 32 lower-case letters, digits or hyphens, starting and ending with a letter or digit. Some names are reserved.", 400);
  if (!isValidHandle(handle)) return again("Handle: 1 to 63 letters, digits, dots, underscores or hyphens, starting with a letter or digit. team and all are reserved.", 400);

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
    return again(`The team name ${team} is taken. Choose another, or ask that team's admin to add you.`, 409);
  }
  await recordEvent(db, { kind: "console", name: "join", subject: identity, outcome: "ok" });
  // The team is already saved. A session failure must not hide its one-time access code.
  let cookie: string | null = null;
  try {
    cookie = await startSession(db, identity);
  } catch {
    // The team-specific login link also works when the browser still has an older session.
  }
  return { status: 200, body: joinedPage(team, handle, code, cookie !== null), ...(cookie ? { cookie } : {}) };
}
