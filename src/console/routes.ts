import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import { constantTimeEqual, hashAccessCode, identityFrom, isValidHandle, isValidIdentity, newAccessCode, normalizeHandle, verifyMemberCode } from "../auth/builtin";
import { handleOf, qualify, tenantOf } from "../domain/tenant";
import { runCleanup } from "../cleanup";
import { nowIso, sha256Hex } from "../domain/ids";
import { recordEvent, revokeAccess } from "../store/events";
import { CONSOLE_HEADERS, SETUP_CODE_MIN, esc, loginPage, problemPage, setupDonePage, setupPage, type Html, type Viewer } from "./html";
import { cookieToken, csrfOk, endSession, loginAllowed, sameOrigin, sessionCookie, sessionFrom, startSession, type Session } from "./session";
import { assistants, controlCenter, members, ops, overview, teamOverview } from "./stats";
import { assistantsPage, codePage, confirmPage, membersPage, opsPage, overviewPage, teamOverviewPage, tenantsPage } from "./views";

type ConsoleVariables = Variables & { session: Session; form: Record<string, string> };

const html = (body: Html, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { ...CONSOLE_HEADERS, ...extra } });
const redirect = (to: string, extra: Record<string, string> = {}): Response =>
  new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...extra } });
const notFound = () => html(problemPage("Not found", "No such member or page."), 404);

function formOf(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Whether any member is an admin. Until one is, /console/setup is open (with the setup code). */
export async function hasAdmin(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT 1 AS ok FROM admin_members LIMIT 1").first()) !== null;
}

const setupCodeOf = (env: Env): string | null => {
  const v = env.HANDOFF_SETUP_CODE?.trim() ?? "";
  return v.length >= SETUP_CODE_MIN ? v : null;
};

async function memberExists(db: D1Database, identity: string): Promise<boolean> {
  return isValidIdentity(identity) && (await db.prepare("SELECT 1 AS ok FROM members WHERE handle = ?").bind(identity).first()) !== null;
}

/**
 * The operators' console at /console: Overview, Members, Assistants, Ops. Admins sign in with their member
 * handle and access code. Every change is a form POST from this origin carrying the session's CSRF value, and
 * the ones that end access ask first on a page of their own.
 */
export function consoleRoutes(): Hono<{ Bindings: Env; Variables: ConsoleVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: ConsoleVariables }>();

  // The first console lived at /admin.
  app.get("/admin", () => redirect("/console"));
  app.get("/console", () => redirect("/console/overview"));
  app.use("/console/*", bodyLimit({ maxSize: 4096, onError: () => html(problemPage("Too large", "That form was larger than the console accepts."), 413) }));

  app.get("/console/login", async (c) => {
    const control = c.get("cfg").mode === "control";
    const team = control ? normalizeHandle(c.req.query("team") ?? "") : "";
    const session = await sessionFrom(c.env.DB, cookieToken(c.req.header("cookie")));
    if (session && (!team || tenantOf(session.handle) === team)) return redirect("/console/overview");
    return html(loginPage(undefined, { needsSetup: !(await hasAdmin(c.env.DB)), control, team }));
  });

  // First admin, for a server deployed without a terminal (the Deploy to Cloudflare button). Open only while no
  // member is an admin, and only with the HANDOFF_SETUP_CODE secret the deployer chose.
  const tooShort = (env: Env) => {
    const n = env.HANDOFF_SETUP_CODE?.trim().length ?? 0;
    return n > 0 && n < SETUP_CODE_MIN;
  };
  app.get("/console/setup", async (c) => {
    if (await hasAdmin(c.env.DB)) return redirect("/console/login");
    return html(setupPage(setupCodeOf(c.env) !== null, undefined, { tooShort: tooShort(c.env) }));
  });

  app.post("/console/setup", async (c) => {
    const db = c.env.DB;
    if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
      return html(problemPage("Setup refused", "The setup form must be sent from this server's own page."), 403);
    }
    if (await hasAdmin(db)) return redirect("/console/login");
    const secret = setupCodeOf(c.env);
    if (!secret) return html(setupPage(false, undefined, { tooShort: tooShort(c.env) }), 403);
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip")))) {
      return html(setupPage(true, "Too many attempts. Try again in 10 minutes."), 429, { "retry-after": "600" });
    }
    const form = formOf(await c.req.parseBody());
    const given = form.setup_code ?? "";
    // Compare digests, so the comparison takes the same time whatever the lengths.
    if (given.length > 256 || !constantTimeEqual(await sha256Hex(given), await sha256Hex(secret))) {
      await recordEvent(db, { kind: "console", name: "setup", outcome: "refused" }, { unauthenticated: true });
      return html(setupPage(true, "That is not this server's setup code."), 401);
    }
    const handle = normalizeHandle(form.handle ?? "");
    if (!isValidHandle(handle)) {
      return html(setupPage(true, "Use 1 to 63 letters, digits, dots, underscores or hyphens, starting with a letter or digit. The handles team and all are reserved."), 400);
    }
    const code = newAccessCode();
    const salt = await sha256Hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashAccessCode(code, salt);
    // One transaction: the member and the admin grant are both written only if there is still no admin, so two
    // setup forms sent at once make one admin.
    const done = await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at)
           SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM admin_members)`,
        )
        .bind(handle, salt, hash, nowIso()),
      db
        .prepare(
          `INSERT INTO admin_members (handle) SELECT ?
           WHERE NOT EXISTS (SELECT 1 FROM admin_members) AND EXISTS (SELECT 1 FROM members WHERE handle = ? AND code_hash = ?)`,
        )
        .bind(handle, handle, hash),
    ]);
    if ((done[1]?.meta.changes ?? 0) !== 1) {
      if (await hasAdmin(db)) return redirect("/console/login");
      return html(setupPage(true, `${handle} is already a member. Choose another handle, or make ${handle} an admin with npm run admin -- ${handle}.`), 409);
    }
    await recordEvent(db, { kind: "console", name: "setup", subject: handle, outcome: "ok" });
    const cookie = await startSession(db, handle);
    return html(setupDonePage(handle, code), 200, cookie ? { "set-cookie": cookie } : {});
  });

  app.post("/console/login", async (c) => {
    const db = c.env.DB;
    if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
      return html(problemPage("Sign-in refused", "The sign-in form must be sent from this console's own page."), 403);
    }
    const control = c.get("cfg").mode === "control";
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip")))) {
      return html(loginPage("Too many attempts. Try again in 10 minutes.", { control }), 429, { "retry-after": "600" });
    }
    const form = formOf(await c.req.parseBody());
    const handle = identityFrom(c.get("cfg"), form.team, form.handle);
    const code = form.access_code ?? "";
    const valid = handle !== null && code.length > 0 && code.length <= 256 && (await verifyMemberCode(db, handle, code)) === handle;
    const cookie = valid && handle ? await startSession(db, handle) : null;
    if (!cookie) {
      await recordEvent(db, { kind: "console", name: "login", subject: handle, outcome: "refused" }, { unauthenticated: true });
      return html(loginPage(control ? "That team, handle and code do not match an admin of that team." : "That handle and code do not match an admin of this console.", { control, team: form.team }), 401);
    }
    await recordEvent(db, { kind: "console", name: "login", subject: handle, outcome: "ok" });
    return redirect("/console/overview", { "set-cookie": cookie });
  });

  // Everything below needs a session; a POST also needs this origin and the session's CSRF value.
  app.use("/console/*", async (c, next) => {
    const session = await sessionFrom(c.env.DB, cookieToken(c.req.header("cookie")));
    if (!session) return redirect("/console/login");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
        return html(problemPage("Refused", "Changes must be sent from this console's own pages."), 403);
      }
      const form = formOf(await c.req.parseBody());
      if (!csrfOk(session, form.csrf)) return html(problemPage("This form has expired", "Go back, reload the page, and try again."), 403);
      c.set("form", form);
    }
    c.set("session", session);
    await next();
  });

  // The session holds the stored identity; pages show the handle and scope everything to the tenant.
  const viewer = (s: Session, control: boolean): Viewer => ({ handle: handleOf(s.handle), identity: s.handle, tenant: tenantOf(s.handle), control, csrf: s.csrf });
  const tenantOfSession = (s: Session) => tenantOf(s.handle);
  const audit = (db: D1Database, s: Session, name: string, extra: { client_id?: string; member?: string } = {}) =>
    recordEvent(db, { kind: "console", name, subject: s.handle, client_id: extra.client_id ?? null, outcome: "ok", detail: extra.member ? { member: extra.member } : null });

  app.post("/console/logout", async (c) => {
    const s = c.get("session");
    await endSession(c.env.DB, s);
    await audit(c.env.DB, s, "logout");
    return redirect("/console/login", { "set-cookie": sessionCookie("", 0) });
  });

  const vw = (c: { get: (k: "session") => Session } & { get(k: "cfg"): Variables["cfg"] }) => viewer(c.get("session"), c.get("cfg").mode === "control");

  app.get("/console/overview", async (c) => {
    const v = vw(c);
    return v.tenant
      ? html(teamOverviewPage(v, c.get("cfg"), await teamOverview(c.env.DB, v.tenant)))
      : html(overviewPage(v, c.get("cfg"), await overview(c.env, c.get("cfg"))));
  });

  // The control center's operator: every tenant, and the project's tracking.
  app.get("/console/tenants", async (c) => {
    const v = vw(c);
    if (!v.control || v.tenant !== "") return redirect("/console/overview");
    return html(tenantsPage(v, await controlCenter(c.env.DB)));
  });

  // ---- members ----

  app.get("/console/members", async (c) => {
    const did = c.req.query("did");
    const who = normalizeHandle(c.req.query("member") ?? "");
    const note =
      did === "removed" && isValidHandle(who)
        ? { text: `Removed ${who}. Their assistants were signed out and the packets they sent or received were revoked.`, ok: true }
        : null;
    return html(membersPage(vw(c), await members(c.env.DB, tenantOfSession(c.get("session"))), Date.now(), note));
  });

  app.post("/console/members", async (c) => {
    const db = c.env.DB;
    const s = c.get("session");
    const tenant = tenantOfSession(s);
    const handle = normalizeHandle(c.get("form").handle ?? "");
    const refuse = async (text: string, status: number) => html(membersPage(vw(c), await members(db, tenant), Date.now(), { text, ok: false }), status);
    if (!isValidHandle(handle)) {
      return refuse("Use 1 to 63 letters, digits, dots, underscores or hyphens, starting with a letter or digit. The handles team and all are reserved.", 400);
    }
    const cap = c.get("cfg").tenantMembersCap;
    if (tenant && cap > 0) {
      const n = await db.prepare("SELECT COUNT(*) AS n FROM members WHERE handle >= ? AND handle < ?").bind(`${tenant}/`, `${tenant}0`).first<{ n: number }>();
      if ((n?.n ?? 0) >= cap) return refuse(`This team has ${cap} members, the most the shared control center allows. Run your own private Handoff for a larger team.`, 409);
    }
    const identity = qualify(tenant, handle);
    const code = newAccessCode();
    const salt = await sha256Hex(crypto.getRandomValues(new Uint8Array(16)));
    const added = await db
      .prepare("INSERT INTO members (handle, code_salt, code_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(handle) DO NOTHING")
      .bind(identity, salt, await hashAccessCode(code, salt), nowIso())
      .run();
    if (added.meta.changes !== 1) return refuse(`${handle} is already a member. Use Reset code to give them a new code.`, 409);
    await audit(db, s, "member_add", { member: handle });
    return html(codePage(vw(c), handle, code, "added", c.get("cfg").publicUrl));
  });

  app.get("/console/members/:handle/reset", async (c) => {
    const handle = c.req.param("handle");
    const identity = qualify(tenantOfSession(c.get("session")), handle);
    if (!(await memberExists(c.env.DB, identity))) return notFound();
    const self = identity === c.get("session").handle;
    return html(
      confirmPage(vw(c), "members", {
        title: `Reset the code of ${handle}?`,
        text: `${esc(handle)} gets a new access code, shown once on the next page. The old code stops working, and every assistant signed in as ${esc(handle)} is signed out at once.${self ? " This ends your console session too." : ""}`,
        action: `/console/members/${handle}/reset`,
        button: "Reset code",
        danger: true,
        back: "/console/members",
      }),
    );
  });

  app.post("/console/members/:handle/reset", async (c) => {
    const db = c.env.DB;
    const s = c.get("session");
    const handle = c.req.param("handle");
    const identity = qualify(tenantOfSession(s), handle);
    if (!(await memberExists(db, identity))) return notFound();
    const code = newAccessCode();
    const salt = await sha256Hex(crypto.getRandomValues(new Uint8Array(16)));
    await db.prepare("UPDATE members SET code_salt = ?, code_hash = ? WHERE handle = ?").bind(salt, await hashAccessCode(code, salt), identity).run();
    await revokeAccess(db, identity, "*");
    await audit(db, s, "member_reset", { member: handle });
    return html(codePage(vw(c), handle, code, "reset", c.get("cfg").publicUrl));
  });

  app.get("/console/members/:handle/remove", async (c) => {
    const handle = c.req.param("handle");
    const identity = qualify(tenantOfSession(c.get("session")), handle);
    if (!(await memberExists(c.env.DB, identity))) return notFound();
    if (identity === c.get("session").handle) return html(problemPage("Not allowed", "You cannot remove yourself. Another admin can."), 400);
    return html(
      confirmPage(vw(c), "members", {
        title: `Remove ${handle}?`,
        text: `${esc(handle)} can no longer sign in, and every assistant signed in as ${esc(handle)} is signed out at once. The packets ${esc(handle)} sent, and the packets sent to ${esc(handle)}, are revoked, so a member added later with the same handle cannot read them. Packets to the whole team stay.`,
        action: `/console/members/${handle}/remove`,
        button: `Remove ${handle}`,
        danger: true,
        back: "/console/members",
      }),
    );
  });

  app.post("/console/members/:handle/remove", async (c) => {
    const db = c.env.DB;
    const s = c.get("session");
    const handle = c.req.param("handle");
    const identity = qualify(tenantOfSession(s), handle);
    if (!(await memberExists(db, identity))) return notFound();
    if (identity === s.handle) return html(problemPage("Not allowed", "You cannot remove yourself. Another admin can."), 400);
    const at = nowIso();
    await db.batch([
      db.prepare("UPDATE packets SET revoked_at = ? WHERE (owner = ? OR recipient = ?) AND revoked_at IS NULL").bind(at, identity, identity),
      db.prepare("DELETE FROM admin_sessions WHERE handle = ?").bind(identity),
      db.prepare("DELETE FROM admin_members WHERE handle = ?").bind(identity),
      db.prepare("DELETE FROM members WHERE handle = ?").bind(identity),
    ]);
    await revokeAccess(db, identity, "*");
    await audit(db, s, "member_remove", { member: handle });
    return redirect(`/console/members?did=removed&member=${encodeURIComponent(handle)}`);
  });

  // ---- assistants ----

  app.get("/console/assistants", async (c) => {
    const note = c.req.query("did") === "disconnected" ? "Disconnected. That assistant asks to sign in again at its next call." : null;
    return html(assistantsPage(vw(c), await assistants(c.env.DB, tenantOfSession(c.get("session"))), Date.now(), note));
  });

  // `member` in the page is the handle; the stored identity carries the session's tenant.
  const pairFrom = (s: Session, member: string | undefined, client: string | undefined) => {
    const m = normalizeHandle(member ?? "");
    const cl = client ?? "";
    return isValidHandle(m) && cl.length > 0 && cl.length <= 128 ? { member: m, identity: qualify(tenantOfSession(s), m), client: cl } : null;
  };

  app.get("/console/assistants/disconnect", async (c) => {
    const p = pairFrom(c.get("session"), c.req.query("member"), c.req.query("client"));
    if (!p) return notFound();
    const row = await c.env.DB.prepare("SELECT client_name FROM oauth_clients WHERE client_id = ?").bind(p.client).first<{ client_name: string | null }>();
    const name = row?.client_name ?? p.client;
    return html(
      confirmPage(vw(c), "assistants", {
        title: `Disconnect ${name}?`,
        text: `<strong>${esc(name)}</strong>, signed in as <strong>${esc(p.member)}</strong>, is signed out at once: its refresh token stops working and its current access token is refused. ${esc(p.member)} can sign it in again with their code. Their other assistants stay connected.`,
        action: "/console/assistants/disconnect",
        fields: { member: p.member, client: p.client },
        button: "Disconnect",
        danger: true,
        back: "/console/assistants",
      }),
    );
  });

  app.post("/console/assistants/disconnect", async (c) => {
    const form = c.get("form");
    const p = pairFrom(c.get("session"), form.member, form.client);
    if (!p) return notFound();
    await revokeAccess(c.env.DB, p.identity, p.client);
    await audit(c.env.DB, c.get("session"), "disconnect", { member: p.member, client_id: p.client });
    return redirect("/console/assistants?did=disconnected");
  });

  // ---- ops ----

  // Ops belongs to the deployment's operator (tenant ""); a tenant admin is sent to their overview.
  app.use("/console/ops", async (c, next) => (tenantOfSession(c.get("session")) ? redirect("/console/overview") : next()));
  app.use("/console/ops/*", async (c, next) => (tenantOfSession(c.get("session")) ? redirect("/console/overview") : next()));
  app.get("/console/ops", async (c) => {
    const did = c.req.query("did");
    const note = did === "cleanup" ? "Cleanup ran. Its result is the first row under Cleanup." : did === "cleanup_failed" ? "Cleanup failed. The error is the first row under Cleanup." : null;
    return html(opsPage(vw(c), c.get("cfg"), await ops(c.env, c.get("cfg")), note));
  });

  app.post("/console/ops/cleanup", async (c) => {
    const s = c.get("session");
    try {
      await runCleanup(c.env, "console", s.handle);
    } catch {
      return redirect("/console/ops?did=cleanup_failed");
    }
    await audit(c.env.DB, s, "cleanup");
    return redirect("/console/ops?did=cleanup");
  });

  return app;
}
