import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import { identityFrom, normalizeHandle, verifyMemberCode } from "../auth/builtin";
import { tenantOf } from "../domain/tenant";
import { recordEvent } from "../store/events";
import { CONSOLE_HEADERS, document, esc, flowHeader, problemPage, type Html } from "../console/html";
import { hasAdmin } from "../console/routes";
import {
  csrfOk,
  endSession,
  hasSessionCookie,
  loginAllowed,
  redirectSetting,
  rememberTeam,
  rememberedTeams,
  safeNext,
  sameOrigin,
  sessionCookie,
  sessionFrom,
  startSession,
  switchSession,
} from "../console/session";

/**
 * The one sign-in of the site, at /login. Every member signs in here with their username and access code (and
 * on the hosted service their team, which this browser remembers), from any page that needs it: the page sends
 * them here with ?next= and they come back to it. ?add=1 signs in to another team while staying signed in to the
 * others; /switch changes which one is active, and /logout signs out of all of them.
 */

const LOGIN_CSS = `
.signin{max-width:440px;margin:4vh auto 64px;padding:0 16px}
.signin .eyebrow{margin:0;font-size:13px;color:var(--muted)}
.signin h1{margin:2px 0 0;font-size:28px;font-weight:500;letter-spacing:-.03em;line-height:1.2}
.signin .lead{margin:6px 0 0;color:var(--muted);font-size:14px}
`;

export interface LoginView {
  control: boolean;
  /** No admin yet on a private server: the page links to the first-admin setup. */
  needsSetup: boolean;
  error?: string;
  team?: string;
  /** Teams this browser signed in to before: offered as suggestions for the team field. */
  teams?: string[];
  /** Signing in to another team while signed in. */
  add?: boolean;
  /** Where to go after signing in, already checked by safeNext. */
  next?: string | null;
}

export function loginPage(v: LoginView): Html {
  return document(
    "Sign in",
    `<style>${LOGIN_CSS}</style>${flowHeader("/connect", "Assistant setup")}
<main class="signin" id="main">
  <form method="post" action="/login" class="flow-panel">
    <div><p class="eyebrow">Handoff</p><h1>${v.add ? (v.control ? "Sign in to another team" : "Sign in as someone else") : "Sign in"}</h1><p class="lead">${v.add ? "You stay signed in to the others. Switch between them in the menu." : "Your handoffs and files, in one place."}</p></div>
    ${v.error ? `<div class="flash" role="alert">${esc(v.error)}</div>` : ""}
    ${v.next ? `<input type="hidden" name="next" value="${esc(v.next)}">` : ""}${v.add ? '<input type="hidden" name="add" value="1">' : ""}
    ${v.control ? `<div><label class="lbl" for="team">Team name</label><input id="team" name="team" class="field"${v.teams?.length ? ' list="known-teams"' : ""} autocomplete="organization" autocapitalize="none" spellcheck="false" placeholder="smiths" value="${esc(v.team ?? "")}"${v.team ? "" : " autofocus"}>${v.teams?.length ? `<datalist id="known-teams">${v.teams.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>` : ""}</div>` : ""}
    <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${v.control ? "anna" : "tom"}"${v.control && !v.team ? "" : " autofocus"}></div>
    <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required autocomplete="current-password"></div>
    <button type="submit" class="btn primary">Sign in</button>
    <p class="flow-note">Use the username and access code you use with your assistants.${v.control ? ` No team yet? <a href="/join">Create one</a>.` : ""}</p>
    ${v.add ? `<p class="flow-note"><a href="/assets">← Back to Assets</a></p>` : ""}
    ${v.needsSetup ? `<p class="flow-note">Deployed this server? <a href="/console/setup">Complete the initial setup</a>.</p>` : ""}
  </form>
</main>`,
    undefined,
    "Handoff",
  );
}

const HOME = { site: "Handoff", href: "/", label: "Back to Handoff" };
const page = (body: Html, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { ...CONSOLE_HEADERS, ...extra } });
const redirect = (to: string): Response => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function loginRoutes(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const tooLarge = () => page(problemPage("Too large", "That form was larger than this page accepts.", HOME), 413);
  app.use("/login", bodyLimit({ maxSize: 4096, onError: tooLarge }));
  app.use("/logout", bodyLimit({ maxSize: 4096, onError: tooLarge }));
  app.use("/switch", bodyLimit({ maxSize: 4096, onError: tooLarge }));

  const view = async (c: { env: Env; get: (k: "cfg") => Variables["cfg"] }, v: Omit<LoginView, "control" | "needsSetup">): Promise<LoginView> => ({
    control: c.get("cfg").mode === "control",
    needsSetup: c.get("cfg").mode !== "control" && !(await hasAdmin(c.env.DB)),
    ...v,
  });

  app.get("/login", async (c) => {
    const control = c.get("cfg").mode === "control";
    const header = c.req.header("cookie");
    const named = control ? normalizeHandle(c.req.query("team") ?? "") : "";
    const add = c.req.query("add") === "1";
    const next = safeNext(c.req.query("next"));
    // Already signed in: go on, unless the link names another team or asks to add one (then the form).
    const s = await sessionFrom(c.env.DB, header);
    if (s && !add && (!named || tenantOf(s.handle) === named)) return redirect(next ?? "/assets");
    const teams = control ? rememberedTeams(header) : [];
    const team = named || (add ? "" : (teams[0] ?? ""));
    // A cookie whose sessions all ended: clear it, so public pages stop showing Assets.
    const clear: Record<string, string> = !s && hasSessionCookie(header) ? { "set-cookie": sessionCookie("", 0) } : {};
    return page(loginPage(await view(c, { team, teams, add, next })), 200, clear);
  });

  app.post("/login", async (c) => {
    const db = c.env.DB;
    const cfg = c.get("cfg");
    if (!sameOrigin(c.req.header("origin"), cfg.publicUrl)) {
      return page(problemPage("Sign-in refused", "The sign-in form must be sent from this site's own page.", HOME), 403);
    }
    const form = await c.req.parseBody();
    const header = c.req.header("cookie");
    const next = safeNext(str(form.next));
    const team = str(form.team);
    const add = str(form.add) === "1";
    const teams = cfg.mode === "control" ? rememberedTeams(header) : [];
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip")))) {
      return page(loginPage(await view(c, { error: "Too many attempts. Try again in 10 minutes.", team, teams, add, next })), 429, { "retry-after": "600" });
    }
    const identity = identityFrom(cfg, team, str(form.handle));
    const code = str(form.access_code);
    const valid = identity !== null && code.length > 0 && code.length <= 256 && (await verifyMemberCode(db, identity, code)) === identity;
    const cookie = valid && identity ? await startSession(db, identity, header) : null;
    if (!cookie || !identity) {
      await recordEvent(db, { kind: "web", name: "login", subject: identity, outcome: "refused" }, { unauthenticated: true });
      const error = cfg.mode === "control" ? "That team, username and access code do not match." : "That username and access code do not match.";
      return page(loginPage(await view(c, { error, team, teams, add, next })), 401);
    }
    // The browser's other accounts stay signed in; this one becomes the active one.
    await recordEvent(db, { kind: "web", name: "login", subject: identity, outcome: "ok" });
    const tenant = tenantOf(identity);
    return redirectSetting(next ?? "/assets", tenant ? [cookie, rememberTeam(header, tenant)] : [cookie]);
  });

  // The account menu: make another of this browser's accounts the active one.
  app.post("/switch", async (c) => {
    const db = c.env.DB;
    const header = c.req.header("cookie");
    if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
      return page(problemPage("Refused", "Switch accounts from this site's own pages.", HOME), 403);
    }
    const s = await sessionFrom(db, header);
    if (!s) return redirect("/login");
    const form = await c.req.parseBody();
    if (!csrfOk(s, form.csrf)) return page(problemPage("This form has expired", "Go back, reload the page, and try again.", HOME), 403);
    const cookie = await switchSession(db, header, str(form.to));
    if (!cookie) return redirect("/assets");
    const tenant = tenantOf(str(form.to));
    return redirectSetting("/assets", tenant ? [cookie, rememberTeam(header, tenant)] : [cookie]);
  });

  app.post("/logout", async (c) => {
    const db = c.env.DB;
    if (!sameOrigin(c.req.header("origin"), c.get("cfg").publicUrl)) {
      return page(problemPage("Refused", "Sign out from this site's own pages.", HOME), 403);
    }
    const s = await sessionFrom(db, c.req.header("cookie"));
    if (s) {
      if (!csrfOk(s, (await c.req.parseBody()).csrf)) return page(problemPage("This form has expired", "Go back, reload the page, and try again.", HOME), 403);
      await recordEvent(db, { kind: "web", name: "logout", subject: s.handle, outcome: "ok" });
    }
    return redirectSetting("/", [await endSession(db, c.req.header("cookie"))]);
  });

  return app;
}
