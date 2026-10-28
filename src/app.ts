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
} from "./auth/builtin";
import { HandoffError, redactSecrets } from "./domain/errors";
import { HandoffService } from "./domain/service";
import { D1Repository } from "./store/d1";
import { R2BlobStore } from "./store/blobs";
import { uploadRoutes } from "./http/routes";
import { buildMcpServer } from "./mcp/server";
import { connectHeaders, connectPage } from "./http/connect";
import { useCasesHeaders, useCasesPage } from "./http/use-cases";
import { consoleRoutes, hasAdmin } from "./console/routes";
import { mcpCallsIn, recordMcpCalls } from "./store/telemetry";
import { base64url } from "./domain/ids";
import { recordEvent } from "./store/events";
import { receiveUpdateCheck } from "./update-check";
import { DEPLOY_PATH, DEPLOY_URL } from "./http/header";
import { handleJoin, joinHeaders, joinPage } from "./http/join";
import { publicStats } from "./console/stats";
import { CONSOLE_HEADERS, document as consoleDocument, esc } from "./console/html";

export type Variables = AppVariables & { service: HandoffService };

export { redactSecrets };

export function serviceFrom(env: Env, requestOrigin = ""): HandoffService {
  return new HandoffService(new D1Repository(env.DB), new R2BlobStore(env.BLOBS), configFrom(env, requestOrigin));
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

  // Public home and Connect pages. A deployed instance is "active" once it has an admin (so members can sign in).
  const isActive = (c: { env: Env }) => hasAdmin(c.env.DB).then((yes) => yes, () => false);
  const home = async (c: { get: (k: "cfg") => Variables["cfg"]; env: Env }) => {
    const active = await isActive(c);
    return new Response(useCasesPage(c.get("cfg"), { active }), { headers: useCasesHeaders() });
  };
  const connect = async (c: { get: (k: "cfg") => Variables["cfg"]; env: Env }) => {
    const nonce = newNonce();
    const active = await isActive(c);
    return new Response(connectPage(c.get("cfg"), nonce, { needsSetup: !active }), { headers: connectHeaders(nonce) });
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
    const r = await handleJoin(c.env.DB, c.get("cfg"), body, c.req.header("cf-connecting-ip"));
    return new Response(r.body, { status: r.status, headers: { ...joinHeaders(), ...(r.cookie ? { "set-cookie": r.cookie } : {}) } });
  });
  app.get("/stats.json", async (c) => (control(c) ? c.json(await publicStats(c.env.DB), 200, { "cache-control": "public, max-age=300" }) : c.notFound()));
  app.get("/stats", async (c) => {
    if (!control(c)) return c.notFound();
    const s = await publicStats(c.env.DB);
    const rows = Object.entries(s)
      .filter(([k]) => k !== "as_of")
      .map(([k, v]) => `<dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(String(v))}</dd>`)
      .join("");
    const page = consoleDocument("Stats", `<div class="login"><div class="panel"><div class="t">Handoff in numbers</div><div class="small muted">Counts only, no names. As of ${esc(String(s.as_of))}. Also at <a class="u" href="/stats.json">/stats.json</a>.</div><dl class="kv">${rows}</dl></div></div>`);
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

  // This Worker is its own OAuth 2.1 authorization server (src/auth/builtin.ts): RFC 8414 metadata, RFC 7591
  // registration, the sign-in and consent page, and the PKCE token exchange. Members sign in with a handle and code.
  app.get("/authorize", async (c) => {
    const params = parseAuthorizeParams(new URL(c.req.url).searchParams);
    const client = await registeredClient(c.env.DB, params.client_id, params.redirect_uri);
    return new Response(builtinAuthorizePage(c.get("cfg"), params, client), { headers: authorizeHeaders() });
  });
  app.post("/authorize", async (c) => handleAuthorizeSubmission(c.env.DB, c.get("cfg"), await readFormOrJson(c.req.raw)));
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

  app.all("/mcp", requireAuth, async (c) => {
    const principal = c.get("principal");
    const started = Date.now();
    // Which tools were called (names only), so the console can show activity. Read from a copy of the body.
    const calls = c.req.method === "POST" ? await mcpCallsIn(c.req.raw.clone()) : [];
    const server = buildMcpServer(c.get("service"), principal);
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
    return c.json({ error: "not_found", message: "no such route" }, 404);
  });
  return app;
}
