import type { Config } from "../env";
import { hashAccessCode, isValidHandle, newAccessCode, normalizeHandle } from "../auth/builtin";
import { nowIso, sha256Hex } from "../domain/ids";
import { isValidTenant, qualify } from "../domain/tenant";
import { CONSOLE_HEADERS, document, esc, flowHeader, flowProgress, interactiveHeaders, type Html } from "../console/html";
import { loginAllowed, startSession } from "../console/session";
import { recordEvent } from "../store/events";
import { COPY_SCRIPT } from "./clipboard";

/**
 * Sign-up on the control center (HANDOFF_MODE=control): a team name and a handle make a tenant and its first
 * admin, whose access code is shown once. The tenant then adds members in its own console at /console.
 */

const JOIN_ATTEMPTS_PURPOSE = "join";

export function joinPage(cfg: Config, opts: { error?: string; team?: string; handle?: string } = {}): Html {
  return document(
    "Create a team",
    `${flowHeader()}
<div class="flow-wrap">${flowProgress(1)}<div class="flow-grid">
  <section class="flow-intro"><span class="kicker">The shared playground</span><h1>Create a team.</h1><p>Create a team for yourself or a few people. Then connect the assistants you use.</p><div class="flow-facts"><span>Free to try</span><span>Up to ${cfg.tenantMembersCap} people</span></div><p class="flow-note">${cfg.defaultExpiryHours}-hour expiry · ${Math.round(cfg.maxAttachmentBytes / 1048576)} MiB per file.<br><a href="/deploy" target="_blank" rel="noopener">Self-host for private work ↗</a></p></section>
  <form method="post" action="/join" class="flow-panel" autocomplete="off">
    ${opts.error ? `<div class="flash" role="alert">${esc(opts.error)}</div>` : ""}
    <div><label class="lbl" for="team">Team name</label><input id="team" name="team" class="field" required autofocus maxlength="32" pattern="[a-z0-9][a-z0-9\\-]{1,30}[a-z0-9]" autocapitalize="none" spellcheck="false" placeholder="acme" value="${esc(opts.team ?? "")}" aria-describedby="team-help"><p class="field-help" id="team-help">3–32 lowercase letters, numbers or hyphens.</p></div>
    <div><label class="lbl" for="handle">Your username</label><input id="handle" name="handle" class="field" required maxlength="63" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,62}" autocapitalize="none" spellcheck="false" placeholder="tim" value="${esc(opts.handle ?? "")}"><p class="field-help">Your name inside the team.</p></div>
    <button type="submit" class="btn primary">Create team →</button>
    <div class="flow-note">You'll be this team's admin. Creating a team switches this browser to the new team.</div>
    <div class="flow-switch"><span>Already part of a team?</span><a class="u" href="/connect">Set up an assistant →</a></div>
  </form>
</div></div>`,
  );
}

export function joinedPage(team: string, handle: string, code: string, signedIn: boolean, nonce: string, publicUrl: string): Html {
  const details = `Handoff\nServer: ${publicUrl}/mcp\nTeam: ${team}\nUsername: ${handle}\nAccess code: ${code}\nSetup: ${publicUrl}/connect`;
  return document(
    "Team created",
    `${flowHeader("/", "About Handoff")}<div class="flow-wrap">${flowProgress(2)}<div class="flow-grid">
  <section class="flow-intro"><div class="flow-complete">✓ Team ${esc(team)} is ready</div><h1>Save your<br>sign-in details.</h1><p>Save these details before you continue. You'll use them to sign in from each assistant.</p><p class="flow-note">Your access code is shown only once. Keep it in your password manager.</p></section>
  <section class="flow-panel">
    <dl class="credential-meta"><div><dt>Team</dt><dd>${esc(team)}</dd></div><div><dt>Username</dt><dd>${esc(handle)}</dd></div></dl>
    <div><span class="lbl small muted">Your access code</span><div class="secret" aria-label="access code">${esc(code)}</div><button type="button" class="btn" data-copy="${esc(details)}">Copy sign-in details</button></div>
    ${signedIn ? `<div class="flow-note">Signed in as ${esc(handle)} · team admin</div>` : '<div class="flash">Your team was created. Save the code above, then sign in to continue.</div>'}
    <a class="btn primary" href="/console/login?team=${encodeURIComponent(team)}&amp;next=connect">Continue to setup →</a>
    <p id="copy-status" class="sr-only" role="status"></p>
  </section></div></div>`, { nonce, script: COPY_SCRIPT },
  );
}

export const joinHeaders = (nonce?: string): Record<string, string> => nonce ? interactiveHeaders(nonce) : { ...CONSOLE_HEADERS };

/** Handles the sign-up form. Returns the page to show and its status. */
export async function handleJoin(db: D1Database, cfg: Config, form: Record<string, string>, ip: string | undefined, nonce: string): Promise<{ status: number; body: Html; cookie?: string }> {
  const team = normalizeHandle(form.team ?? "");
  const handle = normalizeHandle(form.handle ?? "");
  const again = (error: string, status: number) => ({ status, body: joinPage(cfg, { error, team, handle }) });
  if (!(await loginAllowed(db, ip, JOIN_ATTEMPTS_PURPOSE))) return again("Too many attempts from this address. Try again in 10 minutes.", 429);
  if (!isValidTenant(team)) return again("Team name: 3 to 32 lower-case letters, digits or hyphens, starting and ending with a letter or digit. Some names are reserved.", 400);
  if (!isValidHandle(handle)) return again("Username: 1 to 63 letters, digits, dots, underscores or hyphens, starting with a letter or digit. team and all are reserved.", 400);

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
  return { status: 200, body: joinedPage(team, handle, code, cookie !== null, nonce, cfg.publicUrl), ...(cookie ? { cookie } : {}) };
}
