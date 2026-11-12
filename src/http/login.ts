import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Variables } from "../app";
import type { Env } from "../env";
import { refusedSubject, signInMember } from "../auth/builtin";
import { recordEvent } from "../store/events";
import { CONSOLE_HEADERS, document, esc, flowHeader, problemPage, type Html } from "../console/html";
import { hasAdmin } from "../console/routes";
import { REG_TICKS } from "./style";
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

export interface LoginView {
  control: boolean;
  needsSetup: boolean;
  error?: string;
  handle?: string;
  add?: boolean;
  next?: string | null;
}

export function loginPage(v: LoginView): Html {
  const title = v.add ? (v.control ? "Sign in to another team." : "Sign in as someone else.") : "Sign in to Threadpacket.";
  const sub = v.add
    ? "Your other signed-in accounts stay available in the sidebar."
    : "Use the same username and access code as in your AI assistant.";
  return document(
    "Sign in",
    `${flowHeader("/connect", "Assistant setup")}
<main class="flow-wrap flow-single" id="main">
  <div class="dot-stage">
    ${REG_TICKS}
    <div class="flow-card">
      <div class="stamp-bar"><span>Sign in // Threadpacket</span><span>Session</span></div>
      <form method="post" action="/login" class="flow-panel">
        <div><h1>${title}</h1><p class="flow-sub">${sub}</p></div>
        ${v.error ? `<div class="flash" role="alert">${esc(v.error)}</div>` : ""}
        ${v.next ? `<input type="hidden" name="next" value="${esc(v.next)}">` : ""}${v.add ? '<input type="hidden" name="add" value="1">' : ""}
        <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${v.control ? "anna" : "tom"}" value="${esc(v.handle ?? "")}"${v.handle ? "" : " autofocus"}></div>
        <div><label class="lbl" for="code">Access code</label><input id="code" name="access_code" type="password" class="field" required autocomplete="current-password"${v.handle ? " autofocus" : ""}></div>
        <button type="submit" class="btn primary">Sign in</button>
        <p class="flow-note">${v.add ? `${v.control ? `Want a separate team? <a href="/join">Create one</a>. ` : ""}<a href="/packets">Back to Dashboard</a>` : v.control ? `New to Threadpacket? <a href="/join">Create a team</a>.` : "Ask your server admin for your username and access code."}</p>
        ${v.needsSetup ? `<p class="flow-note">Deployed this server? <a href="/console/setup">Complete initial setup</a>.</p>` : ""}
      </form>
    </div>
  </div>
</main>`,
    undefined,
    "Threadpacket",
  );
}

const HOME = { site: "Threadpacket", href: "/", label: "Back to Threadpacket" };
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
    const s = await sessionFrom(c.env.DB, header);
    if (s && !add) return redirect(next ?? "/packets");
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
    await recordEvent(db, { kind: "web", name: "login", subject: identity, outcome: "ok" });
    return redirectSetting(next ?? "/packets", [cookie]);
  });

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
    if (!cookie) return redirect("/packets");
    return redirectSetting("/packets", [cookie]);
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
