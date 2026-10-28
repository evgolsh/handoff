import { SignJWT, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import { SCOPES, type Config } from "../env";
import { base64url, newTicketToken, nowIso, plusMs, sha256Hex } from "../domain/ids";
import { BASE_CSS, BRAND_ICON, FAVICON_LINK, FONT_PRELOAD } from "../http/style";
import { markClientUsed, recordEvent } from "../store/events";
import { isAllowedRedirectUri, registeredClient, type KnownClient } from "./clients";
import { handleOf, isValidTenant, qualify, tenantOf } from "../domain/tenant";

export { isAllowedRedirectUri, registeredClient };

/** The sign-in page has no script and loads nothing from another origin. */
export function authorizeHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    // No form-action: Chrome applies it to the redirect after the form posts, which goes to the client.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const PBKDF2_ITERATIONS = 100_000;

export async function hashAccessCode(code: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(saltHex), iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** "team" and "all" address every member in handoff_send, so no member may have them as a handle. */
export const RESERVED_HANDLES = new Set(["team", "all"]);

export function isValidHandle(handle: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(handle) && !RESERVED_HANDLES.has(handle);
}

/** A stored identity: a bare handle, or `tenant/handle` with a valid tenant slug (src/domain/tenant.ts). */
export function isValidIdentity(identity: string): boolean {
  const tenant = tenantOf(identity);
  return (tenant === "" || isValidTenant(tenant)) && isValidHandle(handleOf(identity));
}

/**
 * The identity a sign-in form names. On the control center a team gives `team/handle`; an empty team is the
 * bare handle, which only the deployment's operator has (sign-up always makes a team, so nobody else can get
 * one). On a private install the handle alone. Null when a given part is not valid.
 */
export function identityFrom(cfg: Config, team: string | undefined, handle: string | undefined): string | null {
  const h = normalizeHandle(handle ?? "");
  if (!isValidHandle(h)) return null;
  const t = normalizeHandle(team ?? "");
  if (cfg.mode !== "control" || !t) return h;
  return isValidTenant(t) ? qualify(t, h) : null;
}

/** A new access code: "hf-" and 96 random bits, short enough to type on a phone. */
export function newAccessCode(): string {
  return `hf-${base64url(crypto.getRandomValues(new Uint8Array(12)))}`;
}

export async function upsertMember(db: D1Database, rawHandle: string, accessCode: string): Promise<string> {
  const handle = normalizeHandle(rawHandle);
  if (!isValidIdentity(handle)) throw new Error("handle must be 1..63 lowercase alphanumeric, dot, underscore or hyphen characters (optionally tenant/handle)");
  if (!accessCode || accessCode.length < 6) throw new Error("access code must be at least 6 characters");
  const salt = await sha256Hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashAccessCode(accessCode, salt);
  await db
    .prepare(
      `INSERT INTO members (handle, code_salt, code_hash, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET code_salt = excluded.code_salt, code_hash = excluded.code_hash`,
    )
    .bind(handle, salt, hash, nowIso())
    .run();
  return handle;
}

export async function verifyMemberCode(db: D1Database, rawHandle: string, code: string): Promise<string | null> {
  const handle = normalizeHandle(rawHandle);
  if (!isValidIdentity(handle) || !code) return null;
  const row = await db
    .prepare("SELECT handle, code_salt, code_hash FROM members WHERE handle = ?")
    .bind(handle)
    .first<{ handle: string; code_salt: string; code_hash: string }>();
  // Only listed members sign in. (A shared team code that let any unlisted handle sign in was removed: whoever
  // held it could take a teammate's handle before that teammate was added, and read what was sent to them.)
  if (!row) return null;
  const candidate = await hashAccessCode(code, row.code_salt);
  return constantTimeEqual(candidate, row.code_hash) ? row.handle : null;
}

interface SigningKeyMaterial {
  kid: string;
  privateKey: CryptoKey | Uint8Array;
  publicJwk: JWK;
}

let cachedSigningKey: { cacheKey: string; material: SigningKeyMaterial } | null = null;

export async function getOrCreateSigningKey(db: D1Database, cfg: Config): Promise<SigningKeyMaterial> {
  const cacheKey = cfg.oauthSigningJwk ?? cfg.publicUrl;
  if (cachedSigningKey && cachedSigningKey.cacheKey === cacheKey) return cachedSigningKey.material;

  if (cfg.oauthSigningJwk) {
    const priv = JSON.parse(cfg.oauthSigningJwk) as JWK;
    const kid = priv.kid ?? "handoff-builtin-1";
    const privateKey = await importJWK({ ...priv, alg: "ES256" }, "ES256");
    const { d: _d, ...pub } = priv;
    const publicJwk: JWK = { ...pub, kid, alg: "ES256", use: "sig" };
    const material = { kid, privateKey, publicJwk };
    cachedSigningKey = { cacheKey, material };
    return material;
  }

  let row = await db
    .prepare("SELECT kid, private_jwk, public_jwk FROM oauth_keys ORDER BY created_at ASC, kid ASC LIMIT 1")
    .first<{ kid: string; private_jwk: string; public_jwk: string }>();

  if (!row) {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const kid = `handoff-${(await sha256Hex(crypto.getRandomValues(new Uint8Array(8)))).slice(0, 12)}`;
    const privJwk: JWK = { ...(await exportJWK(privateKey)), kid, alg: "ES256", use: "sig" };
    const pubJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
    await db
      .prepare("INSERT OR IGNORE INTO oauth_keys (kid, private_jwk, public_jwk, created_at) VALUES (?, ?, ?, ?)")
      .bind(kid, JSON.stringify(privJwk), JSON.stringify(pubJwk), nowIso())
      .run();
    // Two isolates may both create a key; every isolate then uses the same first one.
    row = await db
      .prepare("SELECT kid, private_jwk, public_jwk FROM oauth_keys ORDER BY created_at ASC, kid ASC LIMIT 1")
      .first<{ kid: string; private_jwk: string; public_jwk: string }>();
  }

  if (!row) throw new Error("failed to initialize OAuth signing key");
  const privJwk = JSON.parse(row.private_jwk) as JWK;
  const publicJwk = JSON.parse(row.public_jwk) as JWK;
  const privateKey = await importJWK(privJwk, "ES256");
  const material = { kid: row.kid, privateKey, publicJwk };
  cachedSigningKey = { cacheKey, material };
  return material;
}

export async function builtinJwks(db: D1Database, cfg: Config): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await getOrCreateSigningKey(db, cfg);
  return { keys: [publicJwk] };
}

export function authorizationServerMetadata(cfg: Config): Record<string, unknown> {
  const base = cfg.publicUrl;
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
    // An https client_id names the client's own metadata document (src/auth/clients.ts).
    client_id_metadata_document_supported: true,
    scopes_supported: SCOPES,
  };
}

export async function registerOAuthClient(
  db: D1Database,
  body: Record<string, unknown> | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!body || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0 || body.redirect_uris.length > 10) {
    return { status: 400, body: { error: "invalid_redirect_uri", error_description: "redirect_uris must be a non-empty array" } };
  }
  const uris: string[] = [];
  for (const item of body.redirect_uris) {
    if (typeof item !== "string" || !isAllowedRedirectUri(item)) {
      return {
        status: 400,
        body: { error: "invalid_redirect_uri", error_description: "redirect_uris must use https, http on localhost, or an app's own scheme (not javascript:, data:, file: and the like)" },
      };
    }
    uris.push(item);
  }
  const clientId = `client_${newTicketToken().slice(0, 24)}`;
  const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : "MCP Client";
  const now = nowIso();
  await db
    .prepare("INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, JSON.stringify(uris), clientName, now)
    .run();
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
  };
}

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
}

export function parseAuthorizeParams(input: URLSearchParams | Record<string, string>): AuthorizeParams {
  const get = (k: string) => (input instanceof URLSearchParams ? (input.get(k) ?? "") : (input[k] ?? "")).trim();
  return {
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    response_type: get("response_type") || "code",
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method") || "S256",
    state: get("state"),
    scope: get("scope") || "handoff offline_access",
  };
}

/**
 * The sign-in and consent page. `client` is the known client whose redirect URI matches, or null: then there is
 * no form, because a code for an unknown client would go wherever the link says.
 */
export function builtinAuthorizePage(cfg: Config, params: AuthorizeParams, client: KnownClient | null, errorMsg?: string): string {
  const hasOAuth = Boolean(params.client_id || params.redirect_uri);
  let returnsTo = "";
  try {
    const r = new URL(params.redirect_uri);
    // A desktop app's own scheme says more than its host: cursor://anysphere.cursor-mcp.
    returnsTo = r.protocol === "https:" || r.protocol === "http:" ? r.host : `${r.protocol}//${r.host}`;
  } catch {
    returnsTo = "";
  }
  const hidden = (["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}">`)
    .join("\n      ");
  const body = !hasOAuth
    ? `<p class="meta">Start the connection from your assistant (Claude Code, Codex, Hermes, Claude or ChatGPT). The <a href="/connect">Connect page</a> has the steps.</p>`
    : !client
      ? `<p class="err" role="alert">This sign-in link did not come from an assistant registered with this server. Start the connection again from your assistant.</p>`
      : `<p class="meta"><strong>${esc(client.name)}</strong>${client.publisher ? ` <span title="who publishes this assistant's sign-in details">(${esc(client.publisher)})</span>` : ""} asks to use Handoff as you. After you sign in it returns to <code>${esc(returnsTo)}</code>.</p>
    <form method="post" action="/authorize">
      ${hidden}
      ${
        cfg.mode === "control"
          ? `<div class="field">
        <label for="team">Team</label>
        <input id="team" name="team" type="text" autocomplete="organization" autocapitalize="none" spellcheck="false" autofocus placeholder="the team name from your sign-up">
      </div>`
          : ""
      }
      <div class="field">
        <label for="handle">Handle</label>
        <input id="handle" name="handle" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required${cfg.mode === "control" ? "" : " autofocus"}>
      </div>
      <div class="field">
        <label for="access_code">Access code</label>
        <input id="access_code" name="access_code" type="password" autocomplete="current-password" required>
      </div>
      <button type="submit" class="btn">Sign in and allow</button>
    </form>
    <p class="meta foot">${cfg.mode === "control" ? `Your team, handle and access code come from your team's sign-up or its admin. No team yet? <a href="/join">Create one</a>.` : "Your access code comes from the person who runs this Handoff server."} Use the same handle in each of your assistants.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in to Handoff</title>
${FAVICON_LINK}
${FONT_PRELOAD}
<style>
  ${BASE_CSS}
  main { width: min(420px, calc(100vw - 32px)); margin: 10vh auto 48px; }
  .brand { font-size: 18px; margin-bottom: 6px; }
  .tagline { margin: 0 0 24px; color: var(--muted); font-size: 14px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 20px; }
  .field { margin-bottom: 16px; }
  label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--ink); }
  input[type=text], input[type=password] {
    width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line);
    border-radius: 6px; background: var(--ground); color: var(--ink); font: 14px/1.4 var(--mono);
  }
  input:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
  .btn { width: 100%; min-height: 40px; padding: 10px 16px; border: 1px solid var(--ink); border-radius: 6px;
         background: var(--ink); color: var(--ground); font: 500 14px/1 var(--sans); cursor: pointer; }
  .btn:hover { background: var(--accent); border-color: var(--accent); }
  .meta { margin: 0 0 16px; font-size: 13px; color: var(--muted); line-height: 1.45; }
  .meta strong { color: var(--ink); }
  .foot { margin: 16px 0 0; }
  .err { margin: 0 0 14px; padding: 10px 12px; border-radius: 6px; border: 1px solid var(--danger);
         color: var(--danger); font-size: 13px; }
</style>
</head>
<body>
<main>
  <div class="brand">${BRAND_ICON}<span>Handoff</span></div>
  <p class="tagline">Tell something to a teammate’s agent.</p>
  <div class="panel">
    ${errorMsg ? `<p class="err" role="alert">${esc(errorMsg)}</p>` : ""}
    ${body}
  </div>
</main>
</body>
</html>`;
}

export async function handleAuthorizeSubmission(db: D1Database, cfg: Config, form: Record<string, string>): Promise<Response> {
  const params = parseAuthorizeParams(form);
  const client = await registeredClient(db, params.client_id, params.redirect_uri);
  const bad = (msg: string, status = 400) =>
    new Response(builtinAuthorizePage(cfg, params, client, msg), { status, headers: authorizeHeaders() });

  if (params.response_type !== "code") return bad("Unsupported response_type (expected code).");
  if (params.code_challenge_method !== "S256" || !params.code_challenge) {
    return bad("PKCE S256 code_challenge is required.");
  }
  if (!client) return new Response(builtinAuthorizePage(cfg, params, null), { status: 400, headers: authorizeHeaders() });

  const identity = identityFrom(cfg, form.team, form.handle);
  const handle = identity ? await verifyMemberCode(db, identity, form.access_code ?? "") : null;
  if (!handle) {
    await recordEvent(db, { kind: "sign_in", subject: identity, client_id: params.client_id, outcome: "bad_code" }, { unauthenticated: true });
    return bad(cfg.mode === "control" ? "That team, handle and access code do not match." : "That handle and access code do not match.", 401);
  }
  await recordEvent(db, { kind: "sign_in", subject: handle, client_id: params.client_id, outcome: "ok" });

  const rawCode = `hc_${newTicketToken()}`;
  const codeHash = await sha256Hex(rawCode);
  const expiresAt = plusMs(10 * 60_000);
  await db
    .prepare(
      `INSERT INTO oauth_codes (code_hash, client_id, subject, redirect_uri, code_challenge, scope, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(codeHash, params.client_id, handle, params.redirect_uri, params.code_challenge, params.scope, expiresAt)
    .run();

  const target = new URL(params.redirect_uri);
  target.searchParams.set("code", rawCode);
  if (params.state) target.searchParams.set("state", params.state);
  target.searchParams.set("iss", cfg.issuer);
  return Response.redirect(target.toString(), 302);
}

async function isMember(db: D1Database, handle: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 AS ok FROM members WHERE handle = ?").bind(handle).first()) !== null;
}

async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function handleTokenExchange(
  db: D1Database,
  cfg: Config,
  form: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const grantType = (form.grant_type ?? "").trim();
  const { kid, privateKey } = await getOrCreateSigningKey(db, cfg);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresIn = 8 * 3600;

  const issueTokens = async (subject: string, clientId: string, scope: string) => {
    await recordEvent(db, { kind: "token", name: grantType, subject, client_id: clientId, outcome: "ok" });
    await markClientUsed(db, clientId);
    const accessToken = await new SignJWT({ client_id: clientId, scope })
      .setProtectedHeader({ alg: "ES256", kid, typ: "at+jwt" })
      .setIssuer(cfg.issuer)
      .setAudience(cfg.mcpResource)
      .setSubject(subject)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + expiresIn)
      .sign(privateKey);

    const rawRefresh = `hr_${newTicketToken()}`;
    const refreshHash = await sha256Hex(rawRefresh);
    await db
      .prepare(
        `INSERT INTO oauth_refresh_tokens (token_hash, client_id, subject, scope, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .bind(refreshHash, clientId, subject, scope, plusMs(30 * 86_400_000))
      .run();

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      refresh_token: rawRefresh,
      scope,
    };
  };

  if (grantType === "authorization_code") {
    const code = (form.code ?? "").trim();
    const verifier = (form.code_verifier ?? "").trim();
    const clientId = (form.client_id ?? "").trim();
    const redirectUri = (form.redirect_uri ?? "").trim();
    if (!code || !verifier) {
      return { status: 400, body: { error: "invalid_request", error_description: "code and code_verifier are required" } };
    }
    const codeHash = await sha256Hex(code);
    const row = await db
      .prepare("SELECT * FROM oauth_codes WHERE code_hash = ?")
      .bind(codeHash)
      .first<{
        code_hash: string;
        client_id: string;
        subject: string;
        redirect_uri: string;
        code_challenge: string;
        scope: string;
        expires_at: string;
        used_at: string | null;
      }>();
    if (!row || row.used_at || row.expires_at <= nowIso()) {
      return { status: 400, body: { error: "invalid_grant", error_description: "authorization code is invalid, expired, or already used" } };
    }
    const used = await db
      .prepare("UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL")
      .bind(nowIso(), codeHash)
      .run();
    if ((used.meta.changes ?? 0) !== 1) {
      return { status: 400, body: { error: "invalid_grant", error_description: "authorization code already used" } };
    }
    if (clientId && clientId !== row.client_id) {
      return { status: 400, body: { error: "invalid_grant", error_description: "client_id mismatch" } };
    }
    if (redirectUri && redirectUri !== row.redirect_uri) {
      return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri mismatch" } };
    }
    const computedChallenge = await pkceChallengeS256(verifier);
    if (!constantTimeEqual(computedChallenge, row.code_challenge)) {
      return { status: 400, body: { error: "invalid_grant", error_description: "PKCE code_verifier check failed" } };
    }
    if (!(await isMember(db, row.subject))) return { status: 400, body: { error: "invalid_grant", error_description: "this member was removed" } };
    return { status: 200, body: await issueTokens(row.subject, row.client_id, row.scope) };
  }

  if (grantType === "refresh_token") {
    const rawRefresh = (form.refresh_token ?? "").trim();
    const clientId = (form.client_id ?? "").trim();
    if (!rawRefresh) {
      return { status: 400, body: { error: "invalid_request", error_description: "refresh_token is required" } };
    }
    const refreshHash = await sha256Hex(rawRefresh);
    const row = await db
      .prepare("SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?")
      .bind(refreshHash)
      .first<{
        token_hash: string;
        client_id: string;
        subject: string;
        scope: string;
        expires_at: string;
        revoked_at: string | null;
      }>();
    if (!row || row.revoked_at || row.expires_at <= nowIso()) {
      return { status: 400, body: { error: "invalid_grant", error_description: "refresh_token is invalid or expired" } };
    }
    if (clientId && clientId !== row.client_id) {
      return { status: 400, body: { error: "invalid_grant", error_description: "client_id mismatch" } };
    }
    const revoked = await db
      .prepare("UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(nowIso(), refreshHash)
      .run();
    if ((revoked.meta.changes ?? 0) !== 1) {
      return { status: 400, body: { error: "invalid_grant", error_description: "refresh_token already rotated" } };
    }
    if (!(await isMember(db, row.subject))) return { status: 400, body: { error: "invalid_grant", error_description: "this member was removed" } };
    return { status: 200, body: await issueTokens(row.subject, row.client_id, row.scope) };
  }

  return { status: 400, body: { error: "unsupported_grant_type", error_description: "supported grant_types: authorization_code, refresh_token" } };
}
