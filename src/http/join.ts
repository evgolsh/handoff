import type { Config } from "../env";
import { createTeam } from "../domain/teams";
import { CONSOLE_HEADERS, NOT_A_SIGN_IN, document, esc, flowHeader, interactiveHeaders, type Html } from "../console/html";
import { startSession } from "../console/session";
import { COPY_SCRIPT } from "./clipboard";
import { REG_TICKS } from "./style";

export function joinPage(cfg: Config, opts: { error?: string; team?: string; handle?: string } = {}): Html {
  return document(
    "Create a team",
    `${flowHeader()}
<main class="flow-wrap flow-single" id="main">
  <div class="dot-stage">
    ${REG_TICKS}
    <div class="flow-card">
      <div class="stamp-bar"><span>New team // Threadpacket, hosted</span><span>No email required</span></div>
      <form method="post" action="/join" class="flow-panel" autocomplete="off">
        <div><h1>Create a team.</h1><p class="flow-sub">No email or phone number. Pick a username to get your access code.</p></div>
        ${opts.error ? `<div class="flash" role="alert">${esc(opts.error)}</div>` : ""}
        <div><label class="lbl" for="handle">Your name</label><input id="handle" name="handle" class="field" required autofocus maxlength="63" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,62}" autocapitalize="none" spellcheck="false" placeholder="joe" value="${esc(opts.handle ?? "")}" ${NOT_A_SIGN_IN}></div>
        <div><label class="lbl" for="team">Team or family name <span class="muted">(optional)</span></label><input id="team" name="team" class="field" maxlength="32" pattern="[a-z0-9][a-z0-9\\-]{1,30}[a-z0-9]" autocapitalize="none" spellcheck="false" placeholder="smiths" value="${esc(opts.team ?? "")}" aria-describedby="team-help"><p class="field-help" id="team-help">Leave blank to use your username.</p></div>
        <button type="submit" class="btn primary">Create team →</button>
        <div class="flow-switch"><span>Already have an access code?</span><a class="u" href="/login">Sign in →</a></div>
      </form>
    </div>
  </div>
</main>`,
    undefined,
    "Threadpacket",
  );
}

export function joinedPage(team: string, handle: string, code: string, signedIn: boolean, nonce: string, publicUrl: string): Html {
  const details = `Threadpacket\nServer: ${publicUrl}/mcp\nUsername: ${handle}\nAccess code: ${code}\nSetup: ${publicUrl}/connect`;
  return document(
    "Team created",
    `${flowHeader("/", "About Threadpacket", true)}
<main class="flow-wrap flow-single" id="main">
  <div class="dot-stage">
    ${REG_TICKS}
    <div class="flow-card">
      <div class="stamp-bar"><span>Access code // shown once</span><span>✓ Team ${esc(team)} is ready</span></div>
      <section class="flow-panel">
        <div><h1>Save your access code.</h1><p class="flow-sub">Store it in your password manager before continuing.</p></div>
        <dl class="credential-meta"><div><dt>Team</dt><dd>${esc(team)}</dd></div><div><dt>Username</dt><dd>${esc(handle)}</dd></div></dl>
        <div><span class="lbl small muted">Your access code</span><div class="secret" aria-label="access code">${esc(code)}</div><button type="button" class="btn" data-copy="${esc(details)}">Copy sign-in details</button></div>
        ${signedIn ? `<div class="flow-note">Signed in as ${esc(handle)} · team admin</div>` : '<div class="flash">Save the code above, then sign in to continue.</div>'}
        <a class="btn primary" href="${signedIn ? "/connect" : "/login?next=%2Fconnect"}">Continue to setup →</a>
        <p id="copy-status" class="sr-only" role="status"></p>
      </section>
    </div>
  </div>
</main>`,
    { nonce, script: COPY_SCRIPT },
    "Threadpacket",
  );
}

export const joinHeaders = (nonce?: string): Record<string, string> => (nonce ? interactiveHeaders(nonce) : { ...CONSOLE_HEADERS });

export async function handleJoin(
  db: D1Database,
  cfg: Config,
  form: Record<string, string>,
  ip: string | undefined,
  nonce: string,
  header?: string,
): Promise<{ status: number; body: Html; cookies?: string[] }> {
  const made = await createTeam(db, cfg, form.team ?? "", form.handle ?? "", ip);
  if (!made.ok) return { status: made.status, body: joinPage(cfg, { error: made.error, team: made.team, handle: made.handle }) };
  const { team, handle, identity, code } = made;
  let cookie: string | null = null;
  try {
    cookie = await startSession(db, identity, header);
  } catch {
    cookie = null;
  }
  return { status: 200, body: joinedPage(team, handle, code, cookie !== null, nonce, cfg.publicUrl), cookies: cookie ? [cookie] : [] };
}
