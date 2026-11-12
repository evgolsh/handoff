import { Hono } from "hono";
import type { Env } from "../env";
import type { AppVariables } from "../auth/middleware";
import { CONSOLE_HEADERS, document, esc, flowHeader, interactiveHeaders, type Html } from "../console/html";
import { base64url } from "../domain/ids";
import { redeemInvitation, viewInvitation, type InviteView } from "../domain/invites";
import { COPY_SCRIPT } from "./clipboard";
import { claudeInstallLink } from "./meta";
import { REG_TICKS } from "./style";

const INVITE_CSS = `.invite-steps{margin:0;padding-left:20px;display:grid;gap:14px}.invite-steps li{line-height:1.5}.invite-steps p{margin:5px 0 0;font-size:12.5px;color:var(--muted)}
.invite-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.invite-actions .btn{width:auto}.invite-say{font-size:14.5px;font-weight:600;border-left:2px solid var(--accent);padding-left:10px;margin:6px 0 0}`;

function closed(v: InviteView | null): Html {
  const text = !v
    ? "This invitation link is not valid. Check that the whole link was copied."
    : v.state === "used"
      ? `This invitation was already used. Ask ${esc(v.invited_by)} for a new one: “invite ${esc(v.username)} to Threadpacket”.`
      : `This invitation expired. Ask ${esc(v.invited_by)} for a new one: “invite ${esc(v.username)} to Threadpacket”.`;
  return document(
    "Invitation",
    `${flowHeader("/", "About Threadpacket")}<main class="flow-wrap flow-single" id="main"><div class="dot-stage">${REG_TICKS}<div class="flow-card"><div class="stamp-bar"><span>Invitation // Threadpacket</span></div><section class="flow-panel"><h1>Invitation unavailable</h1><p class="flow-note">${text}</p></section></div></div></main>`,
    undefined,
    "Threadpacket",
  );
}

function welcome(v: InviteView, token: string): Html {
  const team = v.team ? ` on team <strong>${esc(v.team)}</strong>` : "";
  return document(
    "You're invited",
    `${flowHeader("/", "About Threadpacket")}
<main class="flow-wrap flow-single" id="main">
  <div class="dot-stage">
    ${REG_TICKS}
    <div class="flow-card">
      <div class="stamp-bar"><span>Invitation // ${esc(v.team || "Threadpacket")}</span><span>@${esc(v.username)}</span></div>
      <form method="post" action="/invite/${esc(token)}" class="flow-panel">
        <div><h1>${esc(v.invited_by)} invited you.</h1><p class="flow-sub">Your username is <strong>${esc(v.username)}</strong>${team}. Reveal your one-time access code to connect your AI assistant.</p></div>
        <button type="submit" class="btn primary">Get my access code →</button>
        <p class="flow-note">Single-use link · expires ${esc(v.expires_at.slice(0, 10))} · <a href="/privacy">Privacy</a></p>
      </form>
    </div>
  </div>
</main>`,
    undefined,
    "Threadpacket",
  );
}

function credentials(v: InviteView, code: string, publicUrl: string, nonce: string): Html {
  const mcp = `${publicUrl}/mcp`;
  const host = new URL(publicUrl).host;
  const details = `Threadpacket\nServer: ${mcp}\nUsername: ${v.username}\nAccess code: ${code}`;
  return document(
    "Your access code",
    `${flowHeader("/", "About Threadpacket", true)}<div class="flow-wrap"><div class="flow-grid">
  <section class="flow-intro"><div class="flow-complete">✓ Joined${v.team ? ` ${esc(v.team)}` : ""}</div><h1>Save your access code.</h1><p>Shown once. Save it before connecting your assistant.</p>
    <dl class="credential-meta">${v.team ? `<div><dt>Team</dt><dd>${esc(v.team)}</dd></div>` : ""}<div><dt>Username</dt><dd>${esc(v.username)}</dd></div></dl>
    <div><span class="lbl small muted">Access code</span><div class="secret" aria-label="access code">${esc(code)}</div><button type="button" class="btn" data-copy="${esc(details)}">Copy sign-in details</button><p id="copy-status" class="sr-only" role="status"></p></div>
  </section>
  <section class="flow-panel"><ol class="invite-steps">
    <li><strong>Connect your assistant</strong>
      <div class="invite-actions"><a class="btn primary" href="${esc(claudeInstallLink(mcp))}" target="_blank" rel="noopener">Add to Claude ↗</a><a class="btn" href="/connect" target="_blank" rel="noopener">ChatGPT &amp; others ↗</a></div>
      <p>In Claude, add <code>${esc(host)}</code> to allowed domains under Settings &gt; Capabilities so file attachments work.</p></li>
    <li><strong>Sign in</strong> with username <strong>${esc(v.username)}</strong> and your access code.</li>
    <li><strong>Ask your assistant:</strong><p class="invite-say">“Continue the packet from ${esc(v.invited_by)}.”</p></li>
  </ol>
  <p class="flow-note">Open packets or upload phone scans in <a href="/packets" target="_blank" rel="noopener">Packets ↗</a>.</p></section>
</div></div>`,
    { nonce, script: COPY_SCRIPT, style: INVITE_CSS },
    "Threadpacket",
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
