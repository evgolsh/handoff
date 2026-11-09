import { SignJWT, exportJWK, generateKeyPair, importJWK, type JWK } from "jose";
import { SCOPES, type Config } from "../env";
import { base64url, newTicketToken, nowIso, plusMs, sha256Hex } from "../domain/ids";
import { document, flowHeader } from "../console/html";
import { markClientUsed, recordEvent } from "../store/events";
import { isAllowedRedirectUri, registeredClient, type KnownClient } from "./clients";
import { handleOf, isValidTenant, tenantOf } from "../domain/tenant";

export { isAllowedRedirectUri, registeredClient };

/** The sign-in page has no script and loads nothing from another origin. */
export function authorizeHeaders(): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    // Not no-referrer: with that policy the browser sends "Origin: null" on the form POST, and signing this browser in
    // too needs the page's own origin. same-origin sends nothing to the assistant's site.
    "referrer-policy": "same-origin",
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
 * Whom a refused sign-in names in the activity log. On a private server the username is the account; on the hosted
 * service a username alone does not say which team's member it is, so the refusal names nobody.
 */
export function refusedSubject(cfg: Config, rawUsername: string | undefined): string | null {
  const h = normalizeHandle(rawUsername ?? "");
  return cfg.mode !== "control" && isValidHandle(h) ? h : null;
}

/** A new access code: "hf-" and 96 random bits, short enough to type on a phone. */
export function newAccessCode(): string {
  return `hf-${base64url(crypto.getRandomValues(new Uint8Array(12)))}`;
}

/** The first 16 bits of the code's SHA-256: enough to narrow a sign-in to a few members, too little to name a code. */
export const codeLookup = async (code: string): Promise<string> => (await sha256Hex(code)).slice(0, 4);

/** What the members table keeps for an access code: a salt, the salted PBKDF2 hash, and the lookup that finds it. */
export async function codeRecord(code: string): Promise<{ salt: string; hash: string; lookup: string }> {
  const salt = await sha256Hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashAccessCode(code, salt), lookup: await codeLookup(code) };
}

export async function upsertMember(db: D1Database, rawHandle: string, accessCode: string): Promise<string> {
  const handle = normalizeHandle(rawHandle);
  if (!isValidIdentity(handle)) throw new Error("handle must be 1..63 lowercase alphanumeric, dot, underscore or hyphen characters (optionally tenant/handle)");
  if (!accessCode || accessCode.length < 6) throw new Error("access code must be at least 6 characters");
  const { salt, hash, lookup } = await codeRecord(accessCode);
  await db
    .prepare(
      `INSERT INTO members (handle, code_salt, code_hash, code_lookup, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET code_salt = excluded.code_salt, code_hash = excluded.code_hash, code_lookup = excluded.code_lookup`,
    )
    .bind(handle, salt, hash, lookup, nowIso())
    .run();
  return handle;
}

/**
 * Sign-in with a username and access code, on any page and in any assistant: no team. The code's lookup and the
 * username narrow the members to a few, and the salted hash decides which one it is. A code set before lookups
 * existed is found by its username, and gets its lookup here. Returns the member's identity, or null.
 */
export async function signInMember(db: D1Database, rawUsername: string, code: string): Promise<string | null> {
  const username = normalizeHandle(rawUsername);
  if (!isValidHandle(username) || !code || code.length > 256) return null;
  const lookup = await codeLookup(code);
  const { results } = await db
    .prepare(
      `SELECT handle, code_salt, code_hash, code_lookup FROM members
       WHERE (code_lookup = ? OR code_lookup IS NULL) AND substr(handle, instr(handle, '/') + 1) = ?
       ORDER BY created_at LIMIT 20`,
    )
    .bind(lookup, username)
    .all<{ handle: string; code_salt: string; code_hash: string; code_lookup: string | null }>();
  for (const row of results) {
    if (!constantTimeEqual(await hashAccessCode(code, row.code_salt), row.code_hash)) continue;
    if (row.code_lookup === null) await db.prepare("UPDATE members SET code_lookup = ? WHERE handle = ? AND code_hash = ?").bind(lookup, row.handle, row.code_hash).run();
    return row.handle;
  }
  return null;
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
/** What the "Create a team" form on the sign-in page sent back: an error and the values to keep. */
export interface CreateTeamForm {
  error?: string;
  team?: string;
  handle?: string;
}

const AUTHORIZE_KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"] as const;
const hiddenParams = (params: AuthorizeParams): string => AUTHORIZE_KEYS.map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}">`).join("");

/** The sign-in an assistant opens: the site's own header and two columns, as on /login and /join. */
function authorizeDocument(intro: string, stack: string): string {
  return document(
    "Sign in",
    `${flowHeader("/connect", "Assistant setup", true)}
<main class="flow-wrap" id="main">
  <div class="flow-grid">
    <section class="flow-intro">${intro}</section>
    <div class="flow-stack">${stack}</div>
  </div>
</main>`,
    undefined,
    "Handoff",
  );
}

/**
 * Username and access code: no team, because the code says which account it is. On the hosted service a new
 * person creates their account here (the team name is optional) and continues, without a separate sign-up page.
 */
export function builtinAuthorizePage(cfg: Config, params: AuthorizeParams, client: KnownClient | null, errorMsg?: string, create: CreateTeamForm = {}, handle = ""): string {
  const hasOAuth = Boolean(params.client_id || params.redirect_uri);
  let returnsTo = "";
  try {
    const r = new URL(params.redirect_uri);
    // A desktop app's own scheme says more than its host: cursor://anysphere.cursor-mcp.
    returnsTo = r.protocol === "https:" || r.protocol === "http:" ? r.host : `${r.protocol}//${r.host}`;
  } catch {
    returnsTo = "";
  }
  const control = cfg.mode === "control";
  const kicker = `<span class="kicker">Assistant sign-in</span>`;
  if (!hasOAuth || !client) {
    return authorizeDocument(
      `${kicker}<h1>Start from your assistant.</h1><p>${!hasOAuth ? "Your assistant opens this page when you add Handoff to it." : "This sign-in link did not come from an assistant registered with this server."}</p>`,
      `<div class="flow-panel">${hasOAuth ? `<div class="flash" role="alert">Start the connection again from your assistant.</div>` : ""}<p>Choose your assistant on the setup page, add Handoff, then sign in here when it asks.</p><a class="btn primary" href="/connect">Assistant setup</a></div>`,
    );
  }
  const name = esc(client.name);
  const intro = `${kicker}<h1>Sign in to connect ${name}.</h1><p><strong>${name}</strong>${client.publisher ? ` <span title="who publishes this assistant's sign-in details">(${esc(client.publisher)})</span>` : ""} asks to use Handoff as you. After you sign in it returns to <code>${esc(returnsTo)}</code>.</p><p class="flow-note">Use the same username and access code in each of your assistants.</p>`;
  const signIn = `<form method="post" action="/authorize" class="flow-panel">
      ${hiddenParams(params)}
      ${errorMsg ? `<div class="flash" role="alert">${esc(errorMsg)}</div>` : ""}
      <div><label class="lbl" for="handle">Username</label><input id="handle" name="handle" class="field" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="63" value="${esc(handle)}"${create.error || handle ? "" : " autofocus"}></div>
      <div><label class="lbl" for="access_code">Access code</label><input id="access_code" name="access_code" class="field" type="password" autocomplete="current-password" required${handle && !create.error ? " autofocus" : ""}></div>
      <button type="submit" class="btn primary">Sign in and allow</button>
      <p class="flow-note">${control ? `Your access code comes from creating a team or from the invitation you got. New to Handoff? <a href="#new-team">Create a team</a>.` : "Your access code comes from the person who runs this Handoff server."}</p>
    </form>`;
  // The hosted service: a new person creates their team here and continues with the same request.
  const newTeam = control
    ? `<section class="flow-panel" id="new-team" aria-labelledby="new-team-title">
      <div><h2 id="new-team-title">New to Handoff?</h2><p class="flow-note">Pick a username and get an access code. You become your team's admin and can invite others later.</p></div>
      ${create.error ? `<div class="flash" role="alert">${esc(create.error)}</div>` : ""}
      <form method="post" action="/authorize" class="flow-stack">
        ${hiddenParams(params)}
        <input type="hidden" name="action" value="create_team">
        <div><label class="lbl" for="new-team-handle">Your username</label><input id="new-team-handle" name="handle" class="field" type="text" autocapitalize="none" spellcheck="false" required maxlength="63" placeholder="joe" value="${esc(create.handle ?? "")}"${create.error ? " autofocus" : ""}></div>
        <div><label class="lbl" for="new-team-name">Team or family name <span class="muted">(optional)</span></label><input id="new-team-name" name="team" class="field" type="text" autocapitalize="none" spellcheck="false" maxlength="32" placeholder="smiths" value="${esc(create.team ?? "")}"><p class="field-help">Leave it empty to use your username.</p></div>
        <button type="submit" class="btn">Create team and continue</button>
      </form>
      <p class="flow-note">Free. <a href="/privacy" target="_blank" rel="noopener">Privacy</a></p>
    </section>`
    : "";
  return authorizeDocument(intro, signIn + newTeam);
}

/**
 * After "Create a team" on the sign-in page: the new access code, shown once, and a button that signs in with it
 * and returns to the assistant (the same POST as the sign-in form).
 */
export function teamCreatedAuthorizePage(cfg: Config, params: AuthorizeParams, client: KnownClient, team: string, handle: string, code: string): string {
  return authorizeDocument(
    `<div class="flow-complete">✓ Team ${esc(team)} is ready</div><h1>Save your<br>sign-in details.</h1><p>Your username and access code sign you in on any computer and in any assistant. The code is shown only once: save it in your password manager or notes.</p>`,
    `<section class="flow-panel">
      <dl class="credential-meta"><div><dt>Username</dt><dd>${esc(handle)}</dd></div><div><dt>Team</dt><dd>${esc(team)}</dd></div></dl>
      <div><span class="lbl small muted">Your access code</span><div class="secret" aria-label="access code">${esc(code)}</div></div>
      <form method="post" action="/authorize">
        ${hiddenParams(params)}
        <input type="hidden" name="handle" value="${esc(handle)}">
        <input type="hidden" name="access_code" value="${esc(code)}">
        <button type="submit" class="btn primary">I saved it. Continue to ${esc(client.name)}</button>
      </form>
      <p class="flow-note">Next, invite the others: ask your assistant “invite anna to Handoff”.</p>
    </section>`,
  );
}

/** The sign-in form's answer: a redirect to the assistant with a code, or the page again. The identity on success. */
export async function handleAuthorizeSubmission(db: D1Database, cfg: Config, form: Record<string, string>): Promise<{ response: Response; identity: string | null }> {
  const params = parseAuthorizeParams(form);
  const client = await registeredClient(db, params.client_id, params.redirect_uri);
  const page = (body: string, status: number) => ({ response: new Response(body, { status, headers: authorizeHeaders() }), identity: null });
  const bad = (msg: string, status = 400) => page(builtinAuthorizePage(cfg, params, client, msg, {}, (form.handle ?? "").slice(0, 63)), status);

  if (params.response_type !== "code") return bad("Unsupported response_type (expected code).");
  if (params.code_challenge_method !== "S256" || !params.code_challenge) {
    return bad("PKCE S256 code_challenge is required.");
  }
  if (!client) return page(builtinAuthorizePage(cfg, params, null), 400);

  const handle = await signInMember(db, form.handle ?? "", form.access_code ?? "");
  if (!handle) {
    await recordEvent(db, { kind: "sign_in", subject: refusedSubject(cfg, form.handle), client_id: params.client_id, outcome: "bad_code" }, { unauthenticated: true });
    return bad("That username and access code do not match.", 401);
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
  return { response: Response.redirect(target.toString(), 302), identity: handle };
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
