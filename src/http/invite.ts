import { Hono } from "hono";
import type { Env } from "../env";
import type { AppVariables } from "../auth/middleware";
import { CONSOLE_HEADERS, document, esc, flowHeader, interactiveHeaders, type Html } from "../console/html";
import { base64url } from "../domain/ids";
import { redeemInvitation, viewInvitation, type InviteView } from "../domain/invites";
import { COPY_SCRIPT } from "./clipboard";
import { claudeInstallLink } from "./meta";

/**
 * The page an invitee opens (/invite/<token>, from handoff_invite). The first view only says who invited them:
 * messengers fetch links to draw a preview, so the access code is set and shown only after the button (a POST).
 */

const INVITE_CSS = `.invite-steps{margin:0;padding-left:20px;display:grid;gap:18px}.invite-steps li{line-height:1.55}.invite-steps p{margin:6px 0 0;font-size:13px;color:var(--muted)}
.invite-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.invite-say{font-size:15px;border-left:2px solid var(--accent);padding-left:12px;margin:8px 0 0}`;

function closed(v: InviteView | null): Html {
  const text = !v
    ? "This invitation link is not valid. Check that the whole link was copied."
    : v.state === "used"
      ? `This invitation was already used. If that was not you, or you lost the access code, ask ${esc(v.invited_by)} for a new one: in their assistant, “invite ${esc(v.username)} to Handoff”.`
      : `This invitation expired. Ask ${esc(v.invited_by)} for a new one: in their assistant, “invite ${esc(v.username)} to Handoff”.`;
  return document("Invitation", `${flowHeader("/", "About Handoff")}<div class="flow-wrap"><div class="flow-grid"><section class="flow-intro"><span class="kicker">Handoff</span><h1>Invitation</h1><p>${text}</p></section></div></div>`, undefined, "Handoff");
}

function welcome(v: InviteView, token: string): Html {
  const team = v.team ? ` in the team <strong>${esc(v.team)}</strong>` : "";
  return document(
    "You're invited",
    `${flowHeader("/", "About Handoff")}<div class="flow-wrap"><div class="flow-grid">
  <section class="flow-intro"><span class="kicker">Handoff</span><h1>${esc(v.invited_by)} invited you.</h1><p>${esc(v.invited_by)}’s AI assistant can send you notes and files, and you pick them up in your own assistant: Claude, ChatGPT or another one. Your username is <strong>${esc(v.username)}</strong>${team}.</p><p class="flow-note">Free. Handoff has no AI inside. <a href="/privacy">Privacy</a></p></section>
  <form method="post" action="/invite/${esc(token)}" class="flow-panel">
    <p>Next you get your access code, shown once, and the steps to connect your assistant. It takes about two minutes.</p>
    <button type="submit" class="btn primary">Get my access code →</button>
    <p class="flow-note">This link works once and expires ${esc(v.expires_at.slice(0, 10))}.</p>
  </form></div></div>`,
    undefined,
    "Handoff",
  );
}

function credentials(v: InviteView, code: string, publicUrl: string, nonce: string): Html {
  const mcp = `${publicUrl}/mcp`;
  const host = new URL(publicUrl).host;
  const details = `Handoff\nServer: ${mcp}${v.team ? `\nTeam: ${v.team}` : ""}\nUsername: ${v.username}\nAccess code: ${code}`;
  return document(
    "Your access code",
    `${flowHeader("/", "About Handoff")}<div class="flow-wrap"><div class="flow-grid">
  <section class="flow-intro"><div class="flow-complete">✓ You’re in${v.team ? ` the team ${esc(v.team)}` : ""}</div><h1>Save your access code.</h1><p>It is shown only once. Keep it in your password manager or notes: you need it once per assistant.</p>
    <dl class="credential-meta">${v.team ? `<div><dt>Team</dt><dd>${esc(v.team)}</dd></div>` : ""}<div><dt>Username</dt><dd>${esc(v.username)}</dd></div></dl>
    <div><span class="lbl small muted">Access code</span><div class="secret" aria-label="access code">${esc(code)}</div><button type="button" class="btn" data-copy="${esc(details)}">Copy sign-in details</button><p id="copy-status" class="sr-only" role="status"></p></div>
  </section>
  <section class="flow-panel"><ol class="invite-steps">
    <li><strong>Add Handoff to your assistant.</strong>
      <div class="invite-actions"><a class="btn primary" href="${esc(claudeInstallLink(mcp))}" target="_blank" rel="noopener">Add to Claude ↗</a><a class="btn" href="/connect" target="_blank" rel="noopener">ChatGPT and others ↗</a></div>
      <p>In Claude: select <strong>Add</strong>, then <strong>Connect</strong>. To send or open files in Claude, add <code>${esc(host)}</code> to the allowed domains in Settings &gt; Capabilities.</p></li>
    <li><strong>Sign in</strong> on the Handoff page that opens${v.team ? ` with the team <strong>${esc(v.team)}</strong>,` : " with"} username <strong>${esc(v.username)}</strong> and the access code. Then approve access.</li>
    <li><strong>Ask your assistant:</strong><p class="invite-say">“Continue the handoff from ${esc(v.invited_by)}.”</p></li>
  </ol>
  <p class="flow-note">A file on your phone to send? Upload it in <a href="/account">My account</a>.</p></section>
</div></div>`,
    { nonce, script: COPY_SCRIPT, style: INVITE_CSS },
    "Handoff",
  );
}

const noIndex = { "x-robots-tag": "noindex" };

export function inviteRoutes(): Hono<{ Bindings: Env; Variables: AppVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.get("/invite/:token", async (c) => {
    const token = c.req.param("token");
    const v = await viewInvitation(c.env.DB, token);
    const body = v && v.state === "open" ? welcome(v, token) : closed(v);
    return new Response(body, { status: v ? 200 : 404, headers: { ...CONSOLE_HEADERS, ...noIndex } });
  });
  app.post("/invite/:token", async (c) => {
    const token = c.req.param("token");
    const r = await redeemInvitation(c.env.DB, token);
    if (!r) {
      const v = await viewInvitation(c.env.DB, token);
      return new Response(closed(v), { status: v ? 410 : 404, headers: { ...CONSOLE_HEADERS, ...noIndex } });
    }
    const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
    return new Response(credentials(r.view, r.code, c.get("cfg").publicUrl, nonce), { headers: { ...interactiveHeaders(nonce), ...noIndex } });
  });
  return app;
}
