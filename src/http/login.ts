import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import { identityFrom, normalizeHandle, verifyMemberCode } from "../auth/builtin";
import { tenantOf } from "../domain/tenant";
import { recordEvent } from "../store/events";
import { CONSOLE_HEADERS, document, esc, flowHeader, problemPage, type Html } from "../console/html";
import { hasAdmin } from "../console/routes";
import { csrfOk, endSession, loginAllowed, redirectSetting, safeNext, sameOrigin, sessionFrom, startSession } from "../console/session";

/**
 * The one sign-in of the site, at /login. Every member signs in here with their username and access code (and
 * on the hosted service their team), from any page that needs it: the page sends them here with ?next= and
 * they come back to it. One session for everything; the console also checks the admin grant. /logout ends it.
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
  /** Where to go after signing in, already checked by safeNext. */
  next?: string | null;
}

export function loginPage(v: LoginView): Html {
  return document(
    "Sign in",
    `<style>${LOGIN_CSS}</style>${flowHeader("/connect", "Assistant setup")}
<main class="signin" id="main">
  <form method="post" action="/login" class="flow-panel">
    <div><p class="eyebrow">Handoff</p><h1>Sign in</h1><p class="lead">Your handoffs and files, in one place.</p></div>
    ${v.error ? `<div class="flash" role="alert">${esc(v.error)}</div>` : ""}
    ${v.next ? `<input type="hidden" name="next" value="${esc(v.next)}">` : ""}
    ${v.control ? `<div><label class="lbl" for="team">Team name</label><input id="team" name="team" class="field" autocomplete="organization" autocapitalize="none" spellcheck="false" placeholder="smiths" value="${esc(v.team ?? "")}"${v.team ? "" : " autofocus"}></div>` : ""}
    <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${v.control ? "anna" : "tom"}"${v.control && !v.team ? "" : " autofocus"}></div>
    <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required autocomplete="current-password"></div>
    <button type="submit" class="btn primary">Sign in</button>
    <p class="flow-note">Use the username and access code you use with your assistants.${v.control ? ` No team yet? <a href="/join">Create one</a>.` : ""}</p>
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

  const view = async (c: { env: Env; get: (k: "cfg") => Variables["cfg"] }, v: Omit<LoginView, "control" | "needsSetup">): Promise<LoginView> => ({
    control: c.get("cfg").mode === "control",
    needsSetup: c.get("cfg").mode !== "control" && !(await hasAdmin(c.env.DB)),
    ...v,
  });

  app.get("/login", async (c) => {
    const control = c.get("cfg").mode === "control";
    const team = control ? normalizeHandle(c.req.query("team") ?? "") : "";
    const next = safeNext(c.req.query("next"));
    // Already signed in: go on, unless the link names another team (then the form lets you switch).
    const s = await sessionFrom(c.env.DB, c.req.header("cookie"));
    if (s && (!team || tenantOf(s.handle) === team)) return redirect(next ?? "/assets");
    return page(loginPage(await view(c, { team, next })));
  });

  app.post("/login", async (c) => {
    const db = c.env.DB;
    const cfg = c.get("cfg");
    if (!sameOrigin(c.req.header("origin"), cfg.publicUrl)) {
      return page(problemPage("Sign-in refused", "The sign-in form must be sent from this site's own page.", HOME), 403);
    }
    const form = await c.req.parseBody();
    const next = safeNext(str(form.next));
    const team = str(form.team);
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip")))) {
      return page(loginPage(await view(c, { error: "Too many attempts. Try again in 10 minutes.", team, next })), 429, { "retry-after": "600" });
    }
    const identity = identityFrom(cfg, team, str(form.handle));
    const code = str(form.access_code);
    const valid = identity !== null && code.length > 0 && code.length <= 256 && (await verifyMemberCode(db, identity, code)) === identity;
    const cookie = valid && identity ? await startSession(db, identity) : null;
    if (!cookie) {
      await recordEvent(db, { kind: "web", name: "login", subject: identity, outcome: "refused" }, { unauthenticated: true });
      const error = cfg.mode === "control" ? "That team, username and access code do not match." : "That username and access code do not match.";
      return page(loginPage(await view(c, { error, team, next })), 401);
    }
    // Signing in as someone else replaces this browser's session.
    await endSession(db, c.req.header("cookie"));
    await recordEvent(db, { kind: "web", name: "login", subject: identity, outcome: "ok" });
    return redirectSetting(next ?? "/assets", [cookie]);
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
