import type { Context, MiddlewareHandler } from "hono";
import { SCOPES, type Config, type Env } from "../env";
import { AuthError } from "../domain/errors";
import { recordEvent } from "../store/events";
import { verifyBearer, type Principal } from "./verify";

export type AppVariables = { principal: Principal; cfg: Config };

export function metadataUrl(cfg: Config): string {
  return `${cfg.publicUrl}/.well-known/oauth-protected-resource`;
}

export function challenge(cfg: Config, err: AuthError): Response {
  const parts = [
    `Bearer realm="handoff"`,
    `error="${err.error}"`,
    `error_description="${err.message.replace(/"/g, "'")}"`,
    `resource_metadata="${metadataUrl(cfg)}"`,
  ];
  return new Response(JSON.stringify({ error: err.error, error_description: err.message }), {
    status: err.error === "insufficient_scope" ? 403 : 401,
    headers: { "content-type": "application/json", "www-authenticate": parts.join(", ") },
  });
}

export function bearerFrom(c: Context): string | null {
  const h = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

/** Requires a valid bearer token; sets `principal`. The 401 carries the resource-metadata challenge. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AppVariables }> = async (c, next) => {
  const cfg = c.get("cfg");
  const token = bearerFrom(c);
  if (!token) return challenge(cfg, new AuthError("invalid_request", "missing bearer token"));
  try {
    c.set("principal", await verifyBearer(cfg, token, c.env.DB));
  } catch (e) {
    if (e instanceof AuthError) {
      // A rejected token is worth showing in the console (expired, revoked, wrong key). A missing one is the
      // normal first request of a sign-in, so it is not recorded.
      const event = recordEvent(
        c.env.DB,
        { kind: "auth", name: e.message.slice(0, 80), subject: e.subject, client_id: e.clientId, outcome: e.error },
        { unauthenticated: true },
      );
      try {
        c.executionCtx.waitUntil(event);
      } catch {
        await event;
      }
      return challenge(cfg, e);
    }
    throw e;
  }
  await next();
};

export function protectedResourceMetadata(cfg: Config): Record<string, unknown> {
  return {
    resource: cfg.mcpResource,
    authorization_servers: [cfg.issuer],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Handoff",
    resource_documentation: `${cfg.publicUrl}/`,
  };
}
