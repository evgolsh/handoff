import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "../env";
import { AuthError } from "../domain/errors";
import { revokedSince } from "../store/events";
import { builtinJwks } from "./builtin";

export interface Principal {
  /** Stable owner identity: the token's `sub`, a member handle. Never taken from request input. */
  subject: string;
  scopes: string[];
  clientId: string;
  token: string;
  expiresAt?: number;
  issuedAt?: number;
}

function scopesOf(payload: JWTPayload): string[] {
  return typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
}

/**
 * Accepts an access token that this Worker issued (src/auth/builtin.ts): signed by its key, issuer PUBLIC_URL,
 * audience PUBLIC_URL/mcp, with an expiry, a subject and the client it was issued to.
 */
export async function verifyBearer(cfg: Config, token: string, db: D1Database): Promise<Principal> {
  const devSubject = cfg.devTokens.get(token);
  if (devSubject !== undefined) {
    return { subject: devSubject, scopes: ["handoff"], clientId: "dev", token };
  }
  let payload: JWTPayload;
  try {
    const keys = createLocalJWKSet(await builtinJwks(db, cfg));
    ({ payload } = await jwtVerify(token, keys, {
      issuer: cfg.issuer,
      audience: cfg.mcpResource,
      clockTolerance: 60,
      // An access token without an expiry would be valid forever.
      requiredClaims: ["exp", "sub"],
    }));
  } catch (e) {
    throw new AuthError("invalid_token", `token rejected: ${(e as Error).name}`);
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new AuthError("invalid_token", "token has no subject");
  // RFC 9068: an access token names the client it was issued to. Ours always do.
  if (typeof payload.client_id !== "string" || !payload.client_id) throw new AuthError("invalid_token", "not an OAuth access token: no client_id");
  // Removed member, reset code, or disconnected assistant: tokens issued before that are refused.
  const revoked = await revokedSince(db, payload.sub, payload.client_id);
  if (revoked !== null && (typeof payload.iat !== "number" || payload.iat * 1000 <= revoked)) {
    throw new AuthError("invalid_token", "access was revoked; sign in again", { subject: payload.sub, clientId: payload.client_id });
  }
  return { subject: payload.sub, scopes: scopesOf(payload), clientId: payload.client_id, token, expiresAt: payload.exp, issuedAt: payload.iat };
}
