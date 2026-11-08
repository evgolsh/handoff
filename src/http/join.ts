import type { Config } from "../env";
import { createTeam } from "../domain/teams";
import { CONSOLE_HEADERS, document, esc, flowHeader, flowProgress, interactiveHeaders, type Html } from "../console/html";
import { rememberTeam, startSession } from "../console/session";
import { COPY_SCRIPT } from "./clipboard";

/**
 * Sign-up on the hosted service (HANDOFF_MODE=control): a team name and a handle make a tenant and its first
 * admin, whose access code is shown once. The tenant then adds members in its own console at /console.
 */

export function joinPage(cfg: Config, opts: { error?: string; team?: string; handle?: string } = {}): Html {
  return document(
    "Create a team",
    `${flowHeader()}
<div class="flow-wrap">${flowProgress(1)}<div class="flow-grid">
  <section class="flow-intro"><span class="kicker">Handoff, hosted</span><h1>Create a team.</h1><p>A team for your family or a few colleagues. Next, connect your assistant, then invite the others.</p><div class="flow-facts"><span>Free</span><span>Up to ${cfg.tenantMembersCap} people</span></div><p class="flow-note">Handoffs are kept ${Math.round(cfg.defaultExpiryHours / 24)} days · ${Math.round(cfg.maxAttachmentBytes / 1048576)} MiB per file · <a href="/privacy">Privacy</a><br><a href="/#install" target="_blank" rel="noopener">Run your own private server ↗</a></p></section>
  <form method="post" action="/join" class="flow-panel" autocomplete="off">
    ${opts.error ? `<div class="flash" role="alert">${esc(opts.error)}</div>` : ""}
    <div><label class="lbl" for="team">Team or family name</label><input id="team" name="team" class="field" required autofocus maxlength="32" pattern="[a-z0-9][a-z0-9\\-]{1,30}[a-z0-9]" autocapitalize="none" spellcheck="false" placeholder="smiths" value="${esc(opts.team ?? "")}" aria-describedby="team-help"><p class="field-help" id="team-help">3–32 lowercase letters, numbers or hyphens.</p></div>
    <div><label class="lbl" for="handle">Your username</label><input id="handle" name="handle" class="field" required maxlength="63" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,62}" autocapitalize="none" spellcheck="false" placeholder="joe" value="${esc(opts.handle ?? "")}"><p class="field-help">Your name inside the team.</p></div>
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
    `${flowHeader("/", "About Handoff", true)}<div class="flow-wrap">${flowProgress(2)}<div class="flow-grid">
  <section class="flow-intro"><div class="flow-complete">✓ Team ${esc(team)} is ready</div><h1>Save your<br>sign-in details.</h1><p>Save these details before you continue. You'll use them to sign in from each assistant.</p><p class="flow-note">Your access code is shown only once. Keep it in your password manager.</p></section>
  <section class="flow-panel">
    <dl class="credential-meta"><div><dt>Team</dt><dd>${esc(team)}</dd></div><div><dt>Username</dt><dd>${esc(handle)}</dd></div></dl>
    <div><span class="lbl small muted">Your access code</span><div class="secret" aria-label="access code">${esc(code)}</div><button type="button" class="btn" data-copy="${esc(details)}">Copy sign-in details</button></div>
    ${signedIn ? `<div class="flow-note">Signed in as ${esc(handle)} · team admin</div>` : '<div class="flash">Your team was created. Save the code above, then sign in to continue.</div>'}
    <a class="btn primary" href="${signedIn ? "/connect" : `/login?team=${encodeURIComponent(team)}&amp;next=%2Fconnect`}">Continue to setup →</a>
    <p id="copy-status" class="sr-only" role="status"></p>
  </section></div></div>`, { nonce, script: COPY_SCRIPT },
  );
}

export const joinHeaders = (nonce?: string): Record<string, string> => nonce ? interactiveHeaders(nonce) : { ...CONSOLE_HEADERS };

/** Handles the sign-up form. Returns the page to show and its status. */
export async function handleJoin(db: D1Database, cfg: Config, form: Record<string, string>, ip: string | undefined, nonce: string, header?: string): Promise<{ status: number; body: Html; cookies?: string[] }> {
  const made = await createTeam(db, cfg, form.team ?? "", form.handle ?? "", ip);
  if (!made.ok) return { status: made.status, body: joinPage(cfg, { error: made.error, team: made.team, handle: made.handle }) };
  const { team, handle, identity, code } = made;
  // The team is already saved. A session failure must not hide its one-time access code; the page then links
  // to the sign-in for this team.
  let cookie: string | null = null;
  try {
    cookie = await startSession(db, identity, header);
  } catch {
    cookie = null;
  }
  // The new team becomes the active one; the browser's other accounts stay signed in, and the team is remembered.
  return { status: 200, body: joinedPage(team, handle, code, cookie !== null, nonce, cfg.publicUrl), cookies: cookie ? [cookie, rememberTeam(header, team)] : [rememberTeam(header, team)] };
}
