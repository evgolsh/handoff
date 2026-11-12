import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { configFrom, type Env } from "./env";
import type { AppVariables } from "./auth/middleware";
import { protectedResourceMetadata, requireAuth } from "./auth/middleware";
import {
  authorizationServerMetadata,
  authorizeHeaders,
  builtinAuthorizePage,
  builtinJwks,
  handleAuthorizeSubmission,
  handleTokenExchange,
  parseAuthorizeParams,
  registerOAuthClient,
  registeredClient,
  teamCreatedAuthorizePage,
} from "./auth/builtin";
import { createTeam } from "./domain/teams";
import { HandoffError, redactSecrets } from "./domain/errors";
import { HandoffService } from "./domain/service";
import { D1Repository } from "./store/d1";
import { blobStore } from "./store/blobs";
import { uploadRoutes } from "./http/routes";
import { asksForTools, buildMcpServer } from "./mcp/server";
import { connectHeaders, connectPage } from "./http/connect";
import { useCasesHeaders, useCasesPage } from "./http/use-cases";
import { consoleRoutes, hasAdmin } from "./console/routes";
import { packetsRoutes } from "./http/packets";
import { loginRoutes } from "./http/login";
import { handleOf, tenantOf } from "./domain/tenant";
import { hasSessionCookie, isAdmin, sameOrigin, sessionFrom, startSession } from "./console/session";
import { agentRoutes, notFoundMarkdown } from "./http/agents";
import { inviteRoutes } from "./http/invite";
import { mcpCallsIn, recordMcpCalls } from "./store/telemetry";
import { base64url } from "./domain/ids";
import { recordEvent } from "./store/events";
import { receiveUpdateCheck } from "./update-check";
import { DEPLOY_PATH, DEPLOY_URL } from "./http/header";
import { handleJoin, joinHeaders, joinPage } from "./http/join";
import { publicStats } from "./console/stats";
import { CONSOLE_HEADERS, document as consoleDocument, esc, interactiveHeaders } from "./console/html";

export type Variables = AppVariables & { service: HandoffService };

export { redactSecrets };

export function serviceFrom(env: Env, requestOrigin = ""): HandoffService {
  return new HandoffService(new D1Repository(env.DB), blobStore(env), configFrom(env, requestOrigin));
}

async function readFormOrJson(req: Request): Promise<Record<string, string>> {
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const out: Record<string, string> = {};
  if (ct.includes("application/json")) {
    const json = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (json && typeof json === "object") {
      for (const [k, v] of Object.entries(json)) if (typeof v === "string") out[k] = v;
    }
    return out;
  }
  const text = new TextDecoder().decode(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  for (const [k, v] of new URLSearchParams(text).entries()) out[k] = v;
  return out;
}

export function createApp(): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.use("*", async (c, next) => {
    let origin = "";
    try {
      origin = new URL(c.req.url).origin;
    } catch {
      origin = "";
    }
    const service = serviceFrom(c.env, origin);
    c.set("service", service);
    c.set("cfg", service.cfg);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HandoffError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    // Log the route template, never the URL: download and upload tickets are bearer secrets in the path and query.
    console.error(
      JSON.stringify({
        level: "error",
        method: c.req.method,
        route: c.req.routePath,
        ray: c.req.header("cf-ray") ?? null,
        name: err.name,
        message: redactSecrets(err.message),
      }),
    );
    return c.json({ error: "internal", message: "internal error" }, 500);
  });

  const newNonce = () => base64url(crypto.getRandomValues(new Uint8Array(16)));

  // llms.txt, the MCP server card, discovery catalogs, Markdown versions of the public pages (src/http/agents.ts).
  app.route("/", agentRoutes());

  // Public home and Connect pages. A deployed instance is "active" once it has an admin (so members can sign in).
  const isActive = (c: { env: Env }) => hasAdmin(c.env.DB).then((yes) => yes, () => false);
  type PageContext = { get: (k: "cfg") => Variables["cfg"]; env: Env; req: { header: (n: string) => string | undefined } };
  const home = async (c: PageContext) => {
    const active = await isActive(c);
    return new Response(useCasesPage(c.get("cfg"), { active, signedIn: hasSessionCookie(c.req.header("cookie")) }), { headers: useCasesHeaders() });
  };
  // Signed in, Assistant setup is a page of the app, with its left menu; otherwise the public guide.
  const connect = async (c: PageContext) => {
    const nonce = newNonce();
    const cfg = c.get("cfg");
    const s = await sessionFrom(c.env.DB, c.req.header("cookie"));
    if (s) {
      const viewer = { handle: handleOf(s.handle), identity: s.handle, tenant: tenantOf(s.handle), control: cfg.mode === "control", admin: await isAdmin(c.env.DB, s.handle), csrf: s.csrf, others: s.others };
      // The app's headers: its menu posts the sign-out form, which the public page's policy would block.
      return new Response(connectPage(cfg, nonce, { viewer }), { headers: interactiveHeaders(nonce) });
    }
    return new Response(connectPage(cfg, nonce, { needsSetup: !(await isActive(c)) }), { headers: connectHeaders(nonce) });
  };
  // A private install serves its console and Connect page; the homepage lives on the control center.
  const control = (c: { get: (k: "cfg") => Variables["cfg"] }) => c.get("cfg").mode === "control";
  const homeOrConnect = (c: Parameters<typeof home>[0] & { redirect: (to: string, status: 303) => Response }) => (control(c) ? home(c) : c.redirect("/connect", 303));
  app.get("/", (c) => homeOrConnect(c));
  app.get("/use-cases", (c) => homeOrConnect(c));
  app.get("/connect", (c) => connect(c));
  app.get("/healthz", (c) => c.json({ ok: true }));

  // Sign-up and public counters, on the control center only.
  app.get("/join", (c) => (control(c) ? new Response(joinPage(c.get("cfg")), { headers: joinHeaders() }) : c.notFound()));
  app.post("/join", async (c) => {
    if (!control(c)) return c.notFound();
    const origin = c.req.header("origin");
    if (!origin || origin !== new URL(c.get("cfg").publicUrl).origin) {
      return new Response(joinPage(c.get("cfg"), { error: "The form must be sent from this site's own page." }), { status: 403, headers: joinHeaders() });
    }
    const body = await readFormOrJson(c.req.raw);
    const nonce = newNonce();
    const r = await handleJoin(c.env.DB, c.get("cfg"), body, c.req.header("cf-connecting-ip"), nonce, c.req.header("cookie"));
    const res = new Response(r.body, { status: r.status, headers: joinHeaders(nonce) });
    for (const cookie of r.cookies ?? []) res.headers.append("set-cookie", cookie);
    return res;
  });
  app.get("/stats.json", async (c) => (control(c) ? c.json(await publicStats(c.env.DB), 200, { "cache-control": "public, max-age=300" }) : c.notFound()));
  app.get("/stats", async (c) => {
    if (!control(c)) return c.notFound();
    const s = await publicStats(c.env.DB);
    const rows = Object.entries(s)
      .filter(([k]) => k !== "as_of")
      .map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(String(v))}</dd>`)
      .join("");
    const page = consoleDocument("Stats", `<div class="login"><div class="panel"><div class="t">Threadpacket in numbers</div><div class="small muted">Counts only, no names. As of ${esc(String(s.as_of))}. JSON at <a class="u" href="/stats.json">/stats.json</a>.</div><dl class="kv">${rows}</dl></div></div>`);
    return new Response(page, { headers: { ...CONSOLE_HEADERS, "cache-control": "public, max-age=300" } });
  });
  // The pages' Deploy button: counts the click (nothing about who), then sends the browser to Cloudflare.
  app.get(DEPLOY_PATH, async (c) => {
    await recordEvent(c.env.DB, { kind: "visit", name: "deploy", outcome: "ok" }, { unauthenticated: true });
    return c.redirect(DEPLOY_URL, 302);
  });
  // The update check's receiving end (src/update-check.ts): 404 unless UPDATE_CHECK_RECEIVER=1.
  app.get("/v1/update-check", (c) => receiveUpdateCheck(c.env, new URL(c.req.url)));
  app.route("/", consoleRoutes());
  app.route("/", loginRoutes());
  app.route("/", packetsRoutes());
  app.route("/", inviteRoutes());

  // This Worker is its own OAuth 2.1 authorization server (src/auth/builtin.ts): RFC 8414 metadata, RFC 7591
  // registration, the sign-in and consent page, and the PKCE token exchange. Members sign in with a handle and code.
  app.get("/authorize", async (c) => {
    const params = parseAuthorizeParams(new URL(c.req.url).searchParams);
    const client = await registeredClient(c.env.DB, params.client_id, params.redirect_uri);
    return new Response(builtinAuthorizePage(c.get("cfg"), params, client), { headers: authorizeHeaders() });
  });
  app.post("/authorize", async (c) => {
    const cfg = c.get("cfg");
    const form = await readFormOrJson(c.req.raw);
    const header = c.req.header("cookie");
    // The hosted service: "Create a team" on the sign-in page. The new access code is shown once, then the
    // person continues with the same OAuth request.
    if (form.action === "create_team" && cfg.mode === "control") {
      const params = parseAuthorizeParams(form);
      const client = await registeredClient(c.env.DB, params.client_id, params.redirect_uri);
      if (!client || params.response_type !== "code" || params.code_challenge_method !== "S256" || !params.code_challenge) {
        return (await handleAuthorizeSubmission(c.env.DB, cfg, form)).response;
      }
      const made = await createTeam(c.env.DB, cfg, form.team ?? "", form.handle ?? "", c.req.header("cf-connecting-ip"));
      const page = made.ok
        ? teamCreatedAuthorizePage(cfg, params, client, made.team, made.handle, made.code)
        : builtinAuthorizePage(cfg, params, client, undefined, { error: made.error, team: made.team, handle: made.handle });
      return new Response(page, { status: made.ok ? 200 : made.status, headers: authorizeHeaders() });
    }
    const { response: res, identity } = await handleAuthorizeSubmission(c.env.DB, cfg, form);
    // Signed in for an assistant: this browser is signed in too, as on any service. Only for a form sent from this
    // site's own sign-in page, so another site cannot sign a browser in to its account.
    if (!identity || !sameOrigin(c.req.header("origin"), cfg.publicUrl)) return res;
    const cookie = await startSession(c.env.DB, identity, header);
    if (!cookie) return res;
    const headers = new Headers({ location: res.headers.get("location")!, "cache-control": "no-store" });
    headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  });
  app.get("/.well-known/oauth-authorization-server", (c) => c.json(authorizationServerMetadata(c.get("cfg"))));
  app.get("/.well-known/openid-configuration", (c) => c.json(authorizationServerMetadata(c.get("cfg"))));
  app.get("/.well-known/jwks.json", async (c) => c.json(await builtinJwks(c.env.DB, c.get("cfg"))));
  app.post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const res = await registerOAuthClient(c.env.DB, body);
    return c.json(res.body, res.status as 201);
  });
  app.post("/oauth/token", async (c) => {
    const form = await readFormOrJson(c.req.raw);
    const res = await handleTokenExchange(c.env.DB, c.get("cfg"), form);
    return c.json(res.body, res.status as 200, { "cache-control": "no-store" });
  });

  const metadata = (c: { get: (k: "cfg") => Variables["cfg"]; json: (o: unknown) => Response }) => c.json(protectedResourceMetadata(c.get("cfg")));
  app.get("/.well-known/oauth-protected-resource", (c) => metadata(c));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => metadata(c));

  // No server-initiated messages: the Worker handles one request at a time and keeps no session. A GET would
  // open the standalone event stream and close it at once, and the client would reconnect every second, for
  // ever (seen as about 80,000 requests a day per connected Claude Code). 405 tells it not to (MCP, Streamable
  // HTTP transport: "the server MAY respond with 405 if it does not offer an SSE stream at this endpoint").
  app.get("/mcp", (c) => c.json({ error: "method_not_allowed", message: "this server sends no server-initiated messages; send MCP requests with POST" }, 405, { allow: "POST, DELETE" }));

  app.all("/mcp", requireAuth, async (c) => {
    const principal = c.get("principal");
    const started = Date.now();
    // Which tools were called (names only), so the console can show activity. Read from a copy of the body.
    const calls = c.req.method === "POST" ? await mcpCallsIn(c.req.raw.clone()) : [];
    // A tool list names the caller's teammates in threadpacket_send; other requests skip that read.
    const teammates = c.req.method === "POST" && (await asksForTools(c.req.raw.clone())) ? await c.get("service").teammates(principal) : undefined;
    const server = buildMcpServer(c.get("service"), principal, c.env.DB, { teammates });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      const res = await transport.handleRequest(c.req.raw, {
        authInfo: { token: principal.token, clientId: principal.clientId, scopes: principal.scopes, expiresAt: principal.expiresAt, extra: { subject: principal.subject } },
      });
      if (calls.length) {
        const recorded = recordMcpCalls(c.env.DB, principal, calls, res.clone(), Date.now() - started);
        try {
          c.executionCtx.waitUntil(recorded);
        } catch {
          await recorded; // No execution context (a test calling the app directly).
        }
      }
      return res;
    } finally {
      c.executionCtx.waitUntil(server.close().catch(() => undefined));
    }
  });

  app.route("/", uploadRoutes());

  // Static files (fonts). In production the platform serves them before the Worker; this
  // fallback covers runtimes that route everything to the Worker first.
  app.notFound(async (c) => {
    if (c.env.ASSETS && c.req.method === "GET") {
      const res = await c.env.ASSETS.fetch(c.req.raw);
      if (res.status !== 404) return res;
    }
    if ((c.req.header("accept") ?? "").includes("text/markdown")) return notFoundMarkdown(c.get("cfg"));
    return c.json({ error: "not_found", message: "no such route" }, 404);
  });
  return app;
}
