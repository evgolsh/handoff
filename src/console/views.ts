import type { Config } from "../env";
import { RELEASES_URL, type UpdateState } from "../update-check";
import { isNewer } from "../version";
import {
  LIVENESS_LEGEND,
  bytes,
  csrfField,
  esc,
  liveness,
  ms,
  num,
  outcome,
  plural,
  shell,
  utc,
  when,
  type Html,
  type Viewer,
} from "./html";
import {
  STRIP_DAYS,
  WINDOW_DAYS,
  clientName,
  detailOf,
  type AssistantsData,
  type ClientInfo,
  type EventRow,
  type MemberRow,
  type ControlCenterData,
  type OpsData,
  type OverviewData,
  type TeamOverviewData,
} from "./stats";

const flash = (text: string | null, ok = true): Html => (text ? `<div class="flash${ok ? " ok" : ""}" role="status">${esc(text)}</div>` : "");

const head = (title: string, sub: string, right: Html = ""): Html =>
  `<div class="head"><h1>${esc(title)}</h1><span class="muted small">${esc(sub)}</span>${right ? `<div class="grow"></div>${right}` : ""}</div>`;

/** What an event was, in a few words: the tool name, or what happened at sign-in. */
function what(e: EventRow): Html {
  switch (e.kind) {
    case "tool":
      return `<span class="mono">${esc(e.name)}</span>`;
    case "initialize":
      return `connected <span class="muted">· ${esc(e.name)}</span>`;
    case "sign_in":
      return "sign-in";
    case "auth":
      return `token refused <span class="muted small">· ${esc(e.name)}</span>`;
    case "token":
      return `token <span class="muted small">· ${esc(e.name)}</span>`;
    case "client_metadata":
      return `client document unusable <span class="muted small">· ${esc(e.name)} · ${esc(e.outcome)}</span>`;
    default:
      return esc(`${e.kind}${e.name ? ` · ${e.name}` : ""}`);
  }
}

const who = (s: string | null): Html => (s ? esc(s) : `<span class="faint">—</span>`);

function clientCell(clients: Map<string, ClientInfo>, id: string | null): Html {
  if (!id) return `<span class="faint">—</span>`;
  const c = clients.get(id);
  return c ? esc(c.name) : `<span class="mono muted">${esc(id)}</span>`;
}

// ---- overview -----------------------------------------------------------------------------------------------

export function teamOverviewPage(v: Viewer, cfg: Config, d: TeamOverviewData): Html {
  return shell(
    "overview",
    v,
    "Your team",
    `${head(v.tenant, "Your team on the Handoff playground")}
<section class="cards" aria-label="Your team">
  <a class="card" href="/console/members"><div class="t">Members</div><div class="big">${num(d.members)}</div><div class="small muted">Manage your teammates</div></a>
  <a class="card" href="/console/assistants"><div class="t">Connected assistants</div><div class="big">${num(d.connected)}</div><div class="small muted">Manage your team's connections</div></a>
  <div class="card"><div class="t">Active handoffs</div><div class="big">${num(d.packetsLive)}</div><div class="small muted">Available to their recipients</div></div>
</section>
<section class="grid3" aria-label="Get started">
  <div class="panel"><div class="t">1. Connect an assistant</div><p>Choose your assistant and sign in with team <strong>${esc(v.tenant)}</strong>, your handle and access code.</p><div><a class="btn primary" href="/connect">Connect an assistant</a></div></div>
  <div class="panel"><div class="t">2. Add teammates</div><p>Add a handle for each teammate, then share their team name, handle and access code in private. You can also try Handoff on your own.</p><div><a class="btn" href="/console/members">Add teammates</a></div></div>
  <div class="panel"><div class="t">3. Try your first handoff</div><p>In one assistant, say <strong>“Hand this off.”</strong> In another, signed in as the same member, say <strong>“Continue my handoff.”</strong></p><div><a class="btn" href="/connect#next-title">First handoff guide</a></div></div>
</section>
<section class="panel"><div class="t">Shared playground</div><div class="small muted">Handoffs expire after ${plural(cfg.defaultExpiryHours, "hour")} by default. Files can be up to ${bytes(cfg.maxAttachmentBytes)} each. Use a <a class="u" href="/deploy" target="_blank" rel="noopener">private install</a> for private files.</div></section>`,
  );
}

export function overviewPage(v: Viewer, cfg: Config, d: OverviewData): Html {
  const now = d.now;
  const version = d.version
    ? `version <span class="mono">${esc(d.version.id.slice(0, 8))}</span>${d.version.timestamp ? ` · deployed ${when(d.version.timestamp, now)}` : ""}`
    : "version not reported";
  const c = d.lastCleanup;
  const cleanupAge = c ? now - Date.parse(c.ts) : Infinity;
  const cleanupDot = !c ? "idle" : c.outcome === "error" ? "bad" : c.outcome !== "ok" || cleanupAge > 2 * 3_600_000 ? "warn" : "ok";
  const cd = c ? detailOf(c) : {};
  const keyLine =
    d.signingKey.from === "none"
      ? "signing key made at the first sign-in"
      : `key <span class="mono">${esc(d.signingKey.kid ?? "?")}</span> · ${d.signingKey.from === "secret" ? "from a secret" : "kept in D1"}`;

  const cards = `<section class="cards" aria-label="Component status">
  <div class="card">
    <div class="t"><span class="dot ok"></span>Worker</div>
    <div class="small muted">${version}</div>
    <div class="small muted mono">${esc(new URL(cfg.publicUrl).host)}</div>
  </div>
  <div class="card">
    <div class="t"><span class="dot ${d.database.ok ? "ok" : "bad"}"></span>Database</div>
    <div class="small muted">D1 ${d.database.ok ? `answered in ${ms(d.database.ms)}` : "did not answer"}</div>
    <div class="small muted">${plural(d.packetsLive, "live packet")}</div>
  </div>
  <div class="card">
    <div class="t"><span class="dot ${d.storage.ok ? "ok" : "bad"}"></span>Storage</div>
    <div class="small muted">R2 ${d.storage.ok ? `answered in ${ms(d.storage.ms)}` : "did not answer"}</div>
    <div class="small muted">${plural(d.storage.files, "file")} · ${bytes(d.storage.bytes)}</div>
  </div>
  <div class="card">
    <div class="t"><span class="dot ${d.members ? "ok" : "warn"}"></span>Sign-in</div>
    <div class="small muted">${plural(d.members, "member")} · ${plural(d.admins, "admin")} · ${plural(d.connected, "assistant")} connected</div>
    <div class="small muted">${keyLine}</div>
  </div>
  <div class="card">
    <div class="t"><span class="dot ${cleanupDot}"></span>Cleanup</div>
    ${
      c
        ? `<div class="small muted">last run ${when(c.ts, now)} · ${esc(c.outcome)}${c.ms !== null ? ` · ${ms(c.ms)}` : ""}</div>
    <div class="small muted">removed ${num(Number(cd.packets_deleted ?? 0))} packets, ${num(Number(cd.attachments_deleted ?? 0))} files</div>`
        : `<div class="small muted">no run recorded yet · runs hourly</div>`
    }
  </div>
</section>`;

  const maxDay = Math.max(1, ...d.days.map((x) => x.sends));
  const sends = d.days.reduce((s, x) => s + x.sends, 0);
  const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const strip = `<div class="panel">
    <div class="t">Handoffs sent</div>
    <div style="display:flex;align-items:baseline;gap:8px"><span class="big">${num(sends)}</span><span class="muted small">in ${STRIP_DAYS} days</span></div>
    <div class="small muted">${plural(d.toolTotals.handoff_read ?? 0, "read")} · ${plural(d.toolTotals.handoff_revoke ?? 0, "revoke")} · ${plural(d.toolTotals.handoff_inbox ?? 0, "inbox check")}</div>
    <div class="days" role="img" aria-label="Handoffs sent per day, last ${STRIP_DAYS} days">${d.days
      .map((x) => `<i class="${x.sends ? "" : "zero"}" style="height:${x.sends ? Math.max(8, Math.round((100 * x.sends) / maxDay)) : 4}%" title="${esc(label(x.date))}: ${x.sends} sent"></i>`)
      .join("")}</div>
    <div class="small muted" style="display:flex;justify-content:space-between"><span>${esc(label(d.days[0]!.date))}</span><span>${esc(label(d.days[d.days.length - 1]!.date))}</span></div>
  </div>`;

  const latency = `<div class="panel">
    <div class="t">Latency by tool</div>
    ${
      d.latency.length
        ? `<table>
      <thead><tr><th>tool</th><th class="r">p50</th><th class="r">p95</th><th class="r">max</th><th class="r">calls</th></tr></thead>
      <tbody>${d.latency
        .map((r) => `<tr><td class="mono">${esc(r.tool)}</td><td class="r">${ms(r.p50)}</td><td class="r">${ms(r.p95)}</td><td class="r">${ms(r.max)}</td><td class="r">${num(r.n)}</td></tr>`)
        .join("")}</tbody>
    </table>`
        : `<div class="small muted">No tool calls in the last ${WINDOW_DAYS} days.</div>`
    }
  </div>`;

  const total = d.calls.ok + d.calls.failed;
  const calls = `<div class="panel">
    <div class="t">Calls</div>
    <div style="display:flex;align-items:baseline;gap:8px"><span class="big">${num(total)}</span><span class="muted small">tool calls in ${WINDOW_DAYS} days</span></div>
    ${
      total
        ? `<div class="split" role="img" aria-label="${d.calls.ok} ok, ${d.calls.failed} failed"><i class="a" style="flex:${d.calls.ok} 0 0"></i><i class="b" style="flex:${d.calls.failed} 0 0"></i></div>
    <div class="small" style="display:flex;flex-direction:column;gap:4px">
      <div><span class="dot ok"></span> ${num(d.calls.ok)} ok</div>
      <div><span class="dot bad"></span> ${num(d.calls.failed)} returned an error${total ? ` (${Math.round((100 * d.calls.failed) / total)}%)` : ""}</div>
    </div>`
        : ""
    }
    <div class="small ${d.rejected.n ? "warn" : "muted"}">Tokens refused: ${num(d.rejected.n)}${d.rejected.last ? ` · last ${when(d.rejected.last, now)}` : ""}</div>
    <div class="small ${d.badSignIns.n ? "warn" : "muted"}">Wrong sign-in codes: ${num(d.badSignIns.n)}${d.badSignIns.last ? ` · last ${when(d.badSignIns.last, now)}` : ""}</div>
  </div>`;

  const maxMember = Math.max(1, ...d.perMember.map((m) => m.calls));
  const perMember = `<div class="panel">
    <div class="t">Calls per member <span class="muted small">· ${WINDOW_DAYS} days</span></div>
    ${
      d.perMember.length
        ? d.perMember
            .map(
              (m) => `<div style="display:flex;flex-direction:column;gap:3px">
        <div class="small" style="display:flex;justify-content:space-between"><a href="/console/assistants#m-${esc(m.handle)}">${esc(m.handle)}</a><span>${num(m.calls)}</span></div>
        <div class="bar"><i style="width:${Math.round((100 * m.calls) / maxMember)}%"></i></div>
      </div>`,
            )
            .join("")
        : `<div class="small warn">No members yet. Add one on <a class="u" href="/console/members">Members</a>.</div>`
    }
  </div>`;

  const recent = `<div class="panel flush scroll">
    <div class="t">Recent activity</div>
    <table>
      <thead><tr><th>time</th><th>what</th><th>member</th><th>assistant</th><th class="r">time taken</th><th>outcome</th></tr></thead>
      <tbody>${
        d.recent.length
          ? d.recent
              .map(
                (e) => `<tr><td class="nowrap">${when(e.ts, now)}</td><td>${what(e)}</td><td>${who(e.subject)}</td><td>${clientCell(d.clients, e.client_id)}</td><td class="r nowrap">${e.ms !== null ? ms(e.ms) : ""}</td><td>${outcome(e.outcome)}</td></tr>`,
              )
              .join("")
          : `<tr><td colspan="6" class="muted">Nothing yet. Activity shows here once an assistant signs in and calls a tool.</td></tr>`
      }</tbody>
    </table>
  </div>`;

  return shell(
    "overview",
    v,
    "Overview",
    `${head("Overview", `last ${WINDOW_DAYS} days · hover a time for UTC`)}
${cards}
<section class="grid3">${strip}${latency}${calls}</section>
<section class="grid2">${perMember}${recent}</section>`,
  );
}

// ---- members ------------------------------------------------------------------------------------------------

export function membersPage(v: Viewer, data: { rows: MemberRow[]; teamPackets: number }, now: number, note: { text: string; ok: boolean } | null): Html {
  const rows = data.rows
    .map((m) => {
      const self = m.handle === v.handle;
      return `<tr>
        <td><span class="dot ${liveness(m.last_seen, now)}" title="${liveness(m.last_seen, now)}"></span></td>
        <td><strong>${esc(m.handle)}</strong>${m.admin ? ` <span class="chip">admin</span>` : ""}${self ? ` <span class="chip">you</span>` : ""}</td>
        <td class="nowrap">${when(m.created_at, now)}</td>
        <td class="nowrap">${when(m.last_seen, now)}</td>
        <td class="nowrap">${when(m.last_sign_in, now)}</td>
        <td class="r"><a href="/console/assistants#m-${esc(m.handle)}">${num(m.assistants)}</a></td>
        <td class="r">${num(m.calls)}</td>
        <td class="r">${num(m.sent)}</td>
        <td class="r">${num(m.received)}</td>
        <td class="r nowrap">
          <a class="btn sm" href="/console/members/${esc(m.handle)}/reset">Reset code…</a>
          ${self ? "" : `<a class="btn sm danger" href="/console/members/${esc(m.handle)}/remove">Remove…</a>`}
        </td>
      </tr>`;
    })
    .join("");
  return shell(
    "members",
    v,
    "Members",
    `${head("Members", "who can sign in, and who a packet can be addressed to", LIVENESS_LEGEND)}
${note ? flash(note.text, note.ok) : ""}
<section class="panel flush scroll">
  <table>
    <thead><tr><th></th><th>member</th><th>added</th><th>last seen</th><th>last sign-in</th><th class="r">assistants</th><th class="r">calls ${WINDOW_DAYS}d</th><th class="r">sent</th><th class="r">to them</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="10" class="muted">No members yet.</td></tr>`}</tbody>
  </table>
  <div class="note small muted"><strong>assistants</strong>: assistants signed in now. <strong>sent</strong> and <strong>to them</strong>: live packets (not expired or revoked); sent includes notes to self. Packets to the whole team: ${num(data.teamPackets)} live, readable by every member.</div>
</section>
<section class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
  <form method="post" action="/console/members" class="panel" autocomplete="off">
    <div class="t">Add a member</div>
    <div class="small muted">The access code is shown once, on the next page. Share the sign-in details in private; they sign in to each assistant with ${v.tenant ? "the team name, " : ""}their handle and that code.</div>
    ${csrfField(v)}
    <div class="row">
      <div style="flex:1 1 200px"><label class="lbl" for="handle">handle</label><input id="handle" name="handle" class="field" required maxlength="63" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,62}" autocapitalize="none" spellcheck="false" placeholder="tom"></div>
      <button type="submit" class="btn primary">Add member</button>
    </div>
    <div class="small muted">Letters, digits, <span class="mono">. _ -</span>, up to 63 characters, stored in lower case. <span class="mono">team</span> and <span class="mono">all</span> are reserved: they address every member.</div>
  </form>
  <div class="panel">
    <div class="t">Admins</div>
    ${v.tenant ? `<div class="small">The person who created this team is its admin. Adding a member lets them use Handoff with their assistants; it does not grant console access.</div>` : `
    <div class="small">Admins can open this console. The operator grants it in a terminal, so the console cannot make new admins:</div>
<pre class="code">npm run admin -- &lt;handle&gt;
npm run admin -- &lt;handle&gt; --revoke</pre>`}
    <div class="small muted">Reset code gives a new code and signs out every assistant of that member at once. Remove also revokes the packets they sent or received.</div>
  </div>
</section>`,
  );
}

/** The new access code, shown once. */
export function codePage(v: Viewer, handle: string, code: string, kind: "added" | "reset", publicUrl: string): Html {
  const self = handle === v.handle;
  return shell(
    "members",
    v,
    "Access code",
    `${head(kind === "added" ? `Added ${handle}` : `New code for ${handle}`, "shown once · Handoff keeps only a hash")}
<section class="panel" style="max-width:680px">
  <dl class="kv"><dt>Server</dt><dd class="mono">${esc(publicUrl)}/mcp</dd>${v.tenant ? `<dt>Team</dt><dd class="mono">${esc(v.tenant)}</dd>` : ""}<dt>Handle</dt><dd class="mono">${esc(handle)}</dd></dl>
  <div class="small muted">access code for <strong>${esc(handle)}</strong></div>
  <div class="secret" aria-label="access code">${esc(code)}</div>
  <div class="small">Save these sign-in details now. The code will not be shown again.${self ? "" : ` Share the server address, ${v.tenant ? "team name, " : ""}handle and code with ${esc(handle)} in private.`} In each assistant, sign in with ${v.tenant ? `team <span class="mono">${esc(v.tenant)}</span>, ` : ""}handle <span class="mono">${esc(handle)}</span> and this code. <a class="u" href="${esc(publicUrl)}/connect">Assistant setup instructions</a>.</div>
  ${
    kind === "reset"
      ? `<div class="small warn">Every assistant of ${esc(handle)} was signed out. Each one asks to sign in again at its next call.${self ? " Your console session ended too: sign in again with the new code." : ""}</div>`
      : ""
  }
  <div><a class="btn" href="/console/members">Done</a></div>
</section>`,
  );
}

export function confirmPage(
  v: Viewer,
  page: "members" | "assistants",
  o: { title: string; text: Html; action: string; fields?: Record<string, string>; button: string; danger?: boolean; back: string },
): Html {
  const hidden = Object.entries(o.fields ?? {})
    .map(([k, val]) => `<input type="hidden" name="${esc(k)}" value="${esc(val)}">`)
    .join("");
  return shell(
    page,
    v,
    o.title,
    `${head(o.title, "asks first")}
<section class="panel" style="max-width:680px">
  <div class="small">${o.text}</div>
  <form method="post" action="${esc(o.action)}" class="row">${csrfField(v)}${hidden}
    <button type="submit" class="btn ${o.danger ? "danger" : "primary"}">${esc(o.button)}</button>
    <a class="btn" href="${esc(o.back)}">Cancel</a>
  </form>
</section>`,
  );
}

// ---- assistants ---------------------------------------------------------------------------------------------

export function assistantsPage(v: Viewer, d: AssistantsData, now: number, note: string | null): Html {
  const byMember = new Map<string, AssistantsData["rows"]>();
  for (const r of d.rows) {
    let list = byMember.get(r.subject);
    if (!list) byMember.set(r.subject, (list = []));
    list.push(r);
  }
  const memberNames = [...new Set([...d.members, ...byMember.keys()])].sort();
  const body = memberNames
    .map((m) => {
      const list = byMember.get(m) ?? [];
      const removed = !d.members.includes(m);
      const group = `<tr class="group" id="m-${esc(m)}"><td colspan="9">${esc(m)}${removed ? ` <span class="chip warn">not a member</span>` : ""}</td></tr>`;
      if (!list.length) return `${group}<tr><td></td><td colspan="8" class="muted small">No assistant has signed in as ${esc(m)} yet.</td></tr>`;
      return (
        group +
        list
          .map((r) => {
            const live = liveness(r.last_seen, now);
            const name = r.client
              ? `<strong>${esc(r.client.name)}</strong>`
              : `<span class="mono">${esc(r.client_id)}</span> <span class="chip" title="no registration with this server">unregistered</span>`;
            const status = r.connected
              ? `<span class="chip ok" title="${r.refresh_until ? `can refresh until ${esc(utc(r.refresh_until))}` : "access token may still work"}">connected</span>`
              : `<span class="chip">signed out</span>`;
            const action = r.connected
              ? `<a class="btn sm danger" href="/console/assistants/disconnect?member=${encodeURIComponent(r.subject)}&amp;client=${encodeURIComponent(r.client_id)}">Disconnect…</a>`
              : "";
            return `<tr>
          <td><span class="dot ${live}" title="${live}"></span></td>
          <td>${name}</td>
          <td class="mono">${r.announced ? `${esc(r.announced.name)} ${esc(r.announced.version ?? "")}` : `<span class="faint">—</span>`}</td>
          <td class="mono">${r.client?.host ? esc(r.client.host) : `<span class="faint">—</span>`}</td>
          <td class="nowrap">${when(r.first_seen, now)}</td>
          <td class="nowrap">${when(r.last_seen, now)}</td>
          <td class="r">${num(r.calls)}${r.failed ? ` <span class="danger small">(${num(r.failed)} failed)</span>` : ""}</td>
          <td>${status}</td>
          <td class="r">${action}</td>
        </tr>`;
          })
          .join("")
      );
    })
    .join("");

  const rejected = d.rejected.length
    ? `<table><thead><tr><th>reason</th><th class="r">count</th><th>last</th></tr></thead><tbody>${d.rejected
        .map((r) => `<tr><td class="mono">${esc(r.reason)}</td><td class="r">${num(r.n)}</td><td class="nowrap">${when(r.last, now)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<div class="small muted">None in ${WINDOW_DAYS} days.</div>`;
  const bad = d.badSignIns.length
    ? `<table><thead><tr><th>handle tried</th><th class="r">count</th><th>last</th></tr></thead><tbody>${d.badSignIns
        .map((r) => `<tr><td>${who(r.subject)}</td><td class="r">${num(r.n)}</td><td class="nowrap">${when(r.last, now)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<div class="small muted">None in ${WINDOW_DAYS} days.</div>`;
  const unused = d.unused.length
    ? `<table><thead><tr><th>name it gave</th><th>returns to</th><th>registered</th></tr></thead><tbody>${d.unused
        .slice(0, 50)
        .map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${esc(c.host ?? "—")}</td><td class="nowrap">${when(c.created_at, now)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<div class="small muted">None.</div>`;

  return shell(
    "assistants",
    v,
    "Assistants",
    `${head("Assistants", `each assistant signed in as a member · calls over ${WINDOW_DAYS} days`, LIVENESS_LEGEND)}
${flash(note)}
<section class="panel flush scroll">
  <table>
    <thead><tr><th></th><th>assistant</th><th>announced as</th><th>returns to</th><th>first seen</th><th>last seen</th><th class="r">calls ${WINDOW_DAYS}d</th><th>status</th><th></th></tr></thead>
    <tbody>${body || `<tr><td colspan="9" class="muted">No members yet.</td></tr>`}</tbody>
  </table>
  <div class="note small muted"><strong>assistant</strong> is the name the app gave when it registered with this server. <strong>announced as</strong> is the name and version it sent when it connected (MCP initialize). <strong>returns to</strong> is where sign-in sends the browser back: <span class="mono">localhost</span> means an app on that computer. <strong>Disconnect</strong> signs that assistant out at once: its refresh token stops working and its current access token is refused. Signing in again works.</div>
</section>
<section class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
  <div class="panel scroll"><div class="t">Tokens refused <span class="muted small">· ${WINDOW_DAYS} days</span></div>${rejected}<div class="small muted">Expired tokens are normal: the assistant refreshes and retries. Many of anything else is worth a look.</div></div>
  <div class="panel scroll"><div class="t">Wrong sign-in codes <span class="muted small">· ${WINDOW_DAYS} days</span></div>${bad}</div>
</section>
${v.tenant ? "" : `<section class="panel scroll"><div class="t">Registrations never used</div>${unused}<div class="small muted">An assistant registers before its first sign-in. Registrations that never led to a sign-in are removed by cleanup after 7 days.</div></section>`}`,
  );
}

// ---- ops ----------------------------------------------------------------------------------------------------

function cleanupSummary(e: EventRow): string {
  const d = detailOf(e);
  if (e.outcome === "error") return String(d.message ?? d.error ?? "failed");
  const parts: string[] = [];
  const add = (key: string, label: string) => {
    const n = Number(d[key] ?? 0);
    if (n) parts.push(`${num(n)} ${label}`);
  };
  add("packets_deleted", "packets");
  add("attachments_deleted", "files");
  add("events", "events");
  add("oauth_codes", "sign-in codes");
  add("refresh_tokens", "refresh tokens");
  add("unused_clients", "unused registrations");
  add("revocations", "revocations");
  add("console_sessions", "console sessions");
  return parts.length ? `removed ${parts.join(", ")}` : "nothing to remove";
}

const AUDIT: Record<string, string> = {
  login: "signed in",
  logout: "signed out",
  member_add: "added member",
  member_reset: "reset the code of",
  member_remove: "removed member",
  disconnect: "disconnected an assistant of",
  cleanup: "ran cleanup",
};

/** This version and what the daily update check learned (src/update-check.ts). */
function updateRow(u: UpdateState, now: number): Html {
  const version = `v<span class="mono">${esc(u.version)}</span>`;
  if (!u.enabled) return `${version} · <span class="muted">update check off</span>`;
  if (u.latest && isNewer(u.latest, u.version)) {
    return `${version} · <span class="chip warn">${esc(u.latest)} available</span> <a href="${RELEASES_URL}" rel="noopener">releases</a>`;
  }
  const checked = u.checkedAt ? `checked ${when(u.checkedAt, now)}` : "not checked yet (daily, from the hourly cron)";
  return `${version} · ${u.latest ? "up to date" : "no answer yet"} · <span class="muted">${checked}</span>`;
}

export function opsPage(v: Viewer, cfg: Config, d: OpsData, note: string | null): Html {
  const now = d.now;
  const c = d.counts;
  const kv = (rows: Array<[string, Html]>) => `<dl class="kv">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join("")}</dl>`;
  const days = (h: number) => (h % 24 === 0 ? plural(h / 24, "day") : plural(h, "hour"));

  const deployment = `<div class="panel">
    <div class="t">Deployment</div>
    ${kv([
      ["version", d.version ? `<span class="mono">${esc(d.version.id)}</span>${d.version.tag ? ` <span class="chip">${esc(d.version.tag)}</span>` : ""}` : `<span class="faint">not reported (no version_metadata binding)</span>`],
      ["deployed", d.version?.timestamp ? `${when(d.version.timestamp, now)} <span class="muted">· ${esc(utc(d.version.timestamp))}</span>` : `<span class="faint">—</span>`],
      ["handoff", updateRow(d.update, now)],
      ["address", `<span class="mono">${esc(cfg.mcpResource)}</span>`],
      ["sign-in", `built in · issuer <span class="mono">${esc(cfg.issuer)}</span>`],
      [
        "signing key",
        d.signingKey.from === "none"
          ? "made at the first sign-in"
          : `<span class="mono">${esc(d.signingKey.kid ?? "?")}</span> · ${d.signingKey.from === "secret" ? "OAUTH_SIGNING_JWK secret" : `kept in D1 since ${esc(utc(d.signingKey.created_at))}`}`,
      ],
      ["file limit", `${bytes(cfg.maxAttachmentBytes)} each · ${cfg.maxAttachmentsPerPacket} per packet`],
      ["packets expire", `after ${days(cfg.defaultExpiryHours)} by default (at most ${days(cfg.maxExpiryHours)})`],
      ["imports", cfg.importHostAllowlist.length ? `<span class="mono">${esc(cfg.importHostAllowlist.join(", "))}</span>` : `<span class="muted">off</span>`],
    ])}
  </div>`;

  const database = `<div class="panel">
    <div class="t">Database</div>
    ${kv([
      ["packets", `${num(c.packets_live ?? 0)} live · ${num(c.packets ?? 0)} kept`],
      ["tickets", `${num(c.tickets_live ?? 0)} open upload or download links`],
      ["members", `${num(c.members ?? 0)} · ${plural(c.admins ?? 0, "admin")} · ${plural(c.console_sessions ?? 0, "console session")}`],
      ["assistants", `${plural(c.refresh_live ?? 0, "refresh token")} live · ${plural(c.clients ?? 0, "registration")} · ${plural(c.revocations ?? 0, "recent revocation")}`],
      ["events", `${num(c.events ?? 0)}${d.oldestEvent ? ` · since ${when(d.oldestEvent, now)}` : ""} · kept 30 days`],
      [
        "migrations",
        d.migrations
          ? d.migrations.length
            ? d.migrations.map((m) => `<span class="chip" title="${esc(m.applied_at)}">${esc(m.name.replace(/\.sql$/, ""))}</span>`).join(" ")
            : `<span class="warn">none applied</span>`
          : `<span class="faint">no d1_migrations table</span>`,
      ],
    ])}
  </div>`;

  const files = d.files.length
    ? `<table><thead><tr><th>state</th><th class="r">files</th><th class="r">size</th></tr></thead><tbody>${d.files
        .map((f) => `<tr><td class="mono">${esc(f.state)}</td><td class="r">${num(f.n)}</td><td class="r">${bytes(f.b)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<div class="small muted">No files.</div>`;

  const cleanups = `<div class="panel">
    <div class="head" style="gap:8px"><div class="t">Cleanup</div><div class="grow"></div>
      <form method="post" action="/console/ops/cleanup" class="inline">${csrfField(v)}<button type="submit" class="btn sm">Run cleanup now</button></form></div>
    <div class="small muted">Runs hourly at minute 17. Removes expired and revoked packets after a 7-day grace, files never sent, events older than 30 days, and used-up sign-in records. Each run is bounded; <span class="mono">backlog</span> means the next run continues.</div>
    ${
      d.cleanups.length
        ? `<table><thead><tr><th>when</th><th>by</th><th>outcome</th><th class="r">took</th><th>result</th></tr></thead><tbody>${d.cleanups
            .map(
              (e) =>
                `<tr><td class="nowrap">${when(e.ts, now)}</td><td>${e.name === "console" ? esc(e.subject ?? "console") : `<span class="muted">schedule</span>`}</td><td>${e.outcome === "backlog" ? `<span class="warn">backlog</span>` : outcome(e.outcome)}</td><td class="r nowrap">${ms(e.ms)}</td><td class="small">${esc(cleanupSummary(e))}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : `<div class="small muted">No run recorded yet.</div>`
    }
  </div>`;

  const problems = `<section class="panel flush scroll">
    <div class="t">Problems <span class="muted small">· tool errors, refused tokens, wrong codes, failed cleanups</span></div>
    <table><thead><tr><th>time</th><th>what</th><th>member</th><th>assistant</th><th>outcome</th></tr></thead><tbody>${
      d.problems.length
        ? d.problems
            .map((e) => `<tr><td class="nowrap">${when(e.ts, now)}</td><td>${what(e)}</td><td>${who(e.subject)}</td><td>${clientCell(d.clients, e.client_id)}</td><td>${outcome(e.outcome)}</td></tr>`)
            .join("")
        : `<tr><td colspan="5" class="muted">None recorded.</td></tr>`
    }</tbody></table>
  </section>`;

  const audit = `<section class="panel flush scroll">
    <div class="t">Console activity</div>
    <table><thead><tr><th>time</th><th>admin</th><th>action</th><th>outcome</th></tr></thead><tbody>${
      d.audit.length
        ? d.audit
            .map((e) => {
              const member = detailOf(e).member;
              const target = typeof member === "string" ? ` <strong>${esc(member)}</strong>` : "";
              const client = e.client_id ? ` <span class="muted">· ${esc(clientName(d.clients, e.client_id))}</span>` : "";
              return `<tr><td class="nowrap">${when(e.ts, now)}</td><td>${who(e.subject)}</td><td>${esc(AUDIT[e.name ?? ""] ?? e.name ?? "")}${target}${client}</td><td>${outcome(e.outcome)}</td></tr>`;
            })
            .join("")
        : `<tr><td colspan="4" class="muted">None yet.</td></tr>`
    }</tbody></table>
  </section>`;

  return shell(
    "ops",
    v,
    "Ops",
    `${head("Ops", "deployment, database, cleanup · hover a time for UTC")}
${flash(note)}
<section class="grid2" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">${deployment}${database}</section>
<section class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">${cleanups}<div class="panel scroll"><div class="t">Files in storage</div>${files}<div class="small muted">ready = uploaded and checked; staging = upload not finished (removed after 24 h); failed = refused.</div></div></section>
${problems}
${audit}`,
  );
}

/** The control center's operator page: every tenant, the users KPI, instances in the wild, Deploy clicks. */
export function tenantsPage(v: Viewer, d: ControlCenterData): Html {
  const now = d.now;
  const tile = (label: string, value: string, sub = "") => `<div class="panel"><div class="small muted">${esc(label)}</div><div style="font-size:26px;font-weight:600;letter-spacing:-.02em">${value}</div>${sub ? `<div class="small muted">${sub}</div>` : ""}</div>`;
  const tiles = `<section class="grid3">
    ${tile("users, 28 days", num(d.users.d28), `${num(d.users.d7)} in 7 days · a user read a handoff`)}
    ${tile("teams", num(d.totals.tenants), `${plural(d.totals.members, "member")} in all`)}
    ${tile("private instances alive", num(d.instances.d28), `${num(d.instances.d7)} checked in within 7 days`)}
    ${tile("Deploy clicks, 30 days", num(d.deployClicks30d), `${plural(d.activity.round_trips_7d, "person")} completed a round trip this week`)}
  </section>`;
  const maxDay = Math.max(1, ...d.days.map((x) => Math.max(x.sends, x.reads)));
  const strip = `<div class="panel">
    <div class="t">Sends and reads, ${STRIP_DAYS} days</div>
    <div style="display:flex;gap:4px;align-items:flex-end;height:80px">${d.days
      .map((x) => `<div title="${x.date}: ${x.sends} sent, ${x.reads} read" style="flex:1;display:flex;gap:1px;align-items:flex-end;height:100%"><div style="flex:1;background:var(--muted);height:${Math.round((x.sends / maxDay) * 100)}%"></div><div style="flex:1;background:var(--accent);height:${Math.round((x.reads / maxDay) * 100)}%"></div></div>`)
      .join("")}</div>
    <div class="small muted">grey: sent · orange: read · ${num(d.activity.sends_7d)} sent and ${num(d.activity.reads_7d)} read in 7 days</div>
  </div>`;
  const tenants = `<section class="panel flush scroll">
    <table>
      <thead><tr><th>team</th><th>created</th><th class="r">members</th><th class="r">live packets</th><th class="r">reads 7d</th><th>last seen</th></tr></thead>
      <tbody>${
        d.tenants.length
          ? d.tenants
              .map((t) => `<tr><td><strong>${esc(t.slug)}</strong>${t.name !== t.slug ? ` <span class="muted">${esc(t.name)}</span>` : ""}</td><td class="nowrap">${when(t.created_at, now)}</td><td class="r">${num(t.members)}</td><td class="r">${num(t.packets_live)}</td><td class="r">${num(t.reads_7d)}</td><td class="nowrap">${when(t.last_seen, now)}</td></tr>`)
              .join("")
          : `<tr><td colspan="6" class="muted">No teams yet. They sign up at <a href="/join">/join</a>.</td></tr>`
      }</tbody>
    </table>
  </section>`;
  const list = (rows: Array<{ k: string; n: number }>, empty: string) =>
    rows.length ? rows.map((r) => `<div class="small" style="display:flex;justify-content:space-between"><span class="mono">${esc(r.k)}</span><span>${num(r.n)}</span></div>`).join("") : `<div class="small muted">${empty}</div>`;
  const side = `<section class="grid2">
    <div class="panel"><div class="t">Private instances by version, 28 days</div>${list(d.instances.byVersion.map((r) => ({ k: r.version, n: r.n })), "No update check received yet.")}
      <div class="t" style="margin-top:12px">By members</div>${list(d.instances.byMembers.map((r) => ({ k: r.members, n: r.n })), "—")}</div>
    <div class="panel"><div class="t">Assistants seen, 28 days</div>${list(d.assistants.map((r) => ({ k: r.name, n: r.n })), "No assistant has connected yet.")}<div class="small muted" style="margin-top:8px">distinct identities per assistant name announced at connect</div></div>
  </section>`;
  return shell("tenants", v, "Tenants", `${head("Control center", "every team on this deployment, the users KPI, private instances that check in, Deploy clicks")}
${tiles}
${strip}
${tenants}
${side}`);
}
