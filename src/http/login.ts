import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import { refusedSubject, signInMember } from "../auth/builtin";
import { recordEvent } from "../store/events";
import { CONSOLE_HEADERS, document, esc, flowHeader, problemPage, type Html } from "../console/html";
import { hasAdmin } from "../console/routes";
import {
  csrfOk,
  endSession,
  hasSessionCookie,
  loginAllowed,
  redirectSetting,
  safeNext,
  sameOrigin,
  sessionCookie,
  sessionFrom,
  startSession,
  switchSession,
} from "../console/session";

/**
 * The one sign-in of the site, at /login. Every member signs in here with their username and access code, from
 * any page that needs it: the page sends them here with ?next= and they come back to it. No team: the access
 * code says which account it is, and the team shows after sign-in. ?add=1 signs in to another account while
 * staying signed in to the others; /switch changes which one is active, and /logout signs out of all of them.
 */

export interface LoginView {
  control: boolean;
  /** No admin yet on a private server: the page links to the first-admin setup. */
  needsSetup: boolean;
  error?: string;
  /** The username typed before an error. */
  handle?: string;
  /** Signing in to another account while signed in. */
  add?: boolean;
  /** Where to go after signing in, already checked by safeNext. */
  next?: string | null;
}

export function loginPage(v: LoginView): Html {
  const title = v.add ? (v.control ? "Sign in to another team." : "Sign in as someone else.") : "Sign in to Handoff.";
  const lead = v.add
    ? "Use that account's username and access code. You stay signed in to the others, and switch between them in the account menu."
    : "Your handoffs and files, in one place. Use the username and access code you use with your assistants.";
  return document(
    "Sign in",
    `${flowHeader("/connect", "Assistant setup")}
<main class="flow-wrap" id="main">
  <div class="flow-grid">
    <section class="flow-intro"><span class="kicker">Handoff</span><h1>${title}</h1><p>${lead}</p></section>
    <div class="flow-stack">
      <form method="post" action="/login" class="flow-panel">
        ${v.error ? `<div class="flash" role="alert">${esc(v.error)}</div>` : ""}
        ${v.next ? `<input type="hidden" name="next" value="${esc(v.next)}">` : ""}${v.add ? '<input type="hidden" name="add" value="1">' : ""}
        <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${v.control ? "anna" : "tom"}" value="${esc(v.handle ?? "")}"${v.handle ? "" : " autofocus"}></div>
        <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required autocomplete="current-password"${v.handle ? " autofocus" : ""}></div>
        <button type="submit" class="btn primary">Sign in</button>
        <p class="flow-note">${v.add ? `${v.control ? `Want a separate team? <a href="/join">Create one</a>. ` : ""}<a href="/assets">Back to Dashboard</a>` : v.control ? `New to Handoff? <a href="/join">Create a team</a>.` : "Your access code comes from the person who runs this Handoff server."}</p>
        ${v.needsSetup ? `<p class="flow-note">Deployed this server? <a href="/console/setup">Complete the initial setup</a>.</p>` : ""}
      </form>
    </div>
  </div>
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
    const header = c.req.header("cookie");
    const add = c.req.query("add") === "1";
    const next = safeNext(c.req.query("next"));
    // Already signed in: go on, unless asked to add another account (then the form).
    const s = await sessionFrom(c.env.DB, header);
    if (s && !add) return redirect(next ?? "/assets");
    // A cookie whose sessions all ended: clear it, so public pages stop showing Dashboard.
    const clear: Record<string, string> = !s && hasSessionCookie(header) ? { "set-cookie": sessionCookie("", 0) } : {};
    return page(loginPage(await view(c, { add, next })), 200, clear);
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
    const handle = str(form.handle).trim().slice(0, 63);
    const add = str(form.add) === "1";
    if (!(await loginAllowed(db, c.req.header("cf-connecting-ip")))) {
      return page(loginPage(await view(c, { error: "Too many attempts. Try again in 10 minutes.", handle, add, next })), 429, { "retry-after": "600" });
    }
    const identity = await signInMember(db, handle, str(form.access_code));
    const cookie = identity ? await startSession(db, identity, header) : null;
    if (!cookie || !identity) {
      await recordEvent(db, { kind: "web", name: "login", subject: refusedSubject(cfg, handle), outcome: "refused" }, { unauthenticated: true });
      return page(loginPage(await view(c, { error: "That username and access code do not match.", handle, add, next })), 401);
    }
    // The browser's other accounts stay signed in; this one becomes the active one.
    await recordEvent(db, { kind: "web", name: "login", subject: identity, outcome: "ok" });
    return redirectSetting(next ?? "/assets", [cookie]);
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
    return redirectSetting("/assets", [cookie]);
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
