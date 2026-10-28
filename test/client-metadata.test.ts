import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF, env } from "cloudflare:test";
import { decodeJwt } from "jose";
import { upsertMember } from "../src/auth/builtin";
import { isMetadataClientId, redirectMatches } from "../src/auth/clients";
import { base64url } from "../src/domain/ids";
import { ORIGIN } from "./helpers";

// Claude Code's own document, as published at its client_id (fetched 2026-10-26).
const claudeCodeDoc = (clientId: string) => ({
  client_id: clientId,
  client_name: "Claude Code",
  client_uri: "https://claude.ai",
  redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
});

// ChatGPT's document, as published at https://chatgpt.com/oauth/client.json (fetched 2026-10-28).
const chatgptDoc = (clientId: string) => ({
  client_id: clientId,
  client_uri: "https://chatgpt.com/",
  redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
  token_endpoint_auth_method: "private_key_jwt",
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  client_name: "ChatGPT",
  logo_uri: "https://persistent.oaistatic.com/sonic/misc/openai-logo.png",
  token_endpoint_auth_signing_alg: "RS256",
  jwks_uri: "https://chatgpt.com/oauth/jwks.json",
});

// The Worker fetches documents with the global fetch; tests and the Worker share one isolate.
const docs = new Map<string, () => Response>();
const hits = new Map<string, number>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  docs.clear();
  hits.clear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    hits.set(url, (hits.get(url) ?? 0) + 1);
    expect(init?.redirect).toBe("manual");
    const make = docs.get(url);
    if (!make) throw new TypeError(`network disabled in tests: ${url}`);
    return make();
  });
});
afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
  vi.unstubAllGlobals();
});

const uid = () => crypto.randomUUID().slice(0, 8);
const newClientId = () => `https://assistant-${uid()}.example.com/oauth/client-metadata`;
const serve = (clientId: string, doc: unknown, init: ResponseInit = { status: 200, headers: { "content-type": "application/json" } }) =>
  docs.set(clientId, () => new Response(typeof doc === "string" ? doc : JSON.stringify(doc), init));

const verifier = "verifier_secret_string_for_pkce_s256_metadata_test_0123456789";
const challenge = async () => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

async function authorizePage(clientId: string, redirectUri: string): Promise<string> {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: await challenge(),
    code_challenge_method: "S256",
    state: "st",
    scope: "handoff offline_access",
  });
  const res = await SELF.fetch(`${ORIGIN}/authorize?${q}`);
  expect(res.status).toBe(200);
  return res.text();
}

const refused = "did not come from an assistant registered with this server";

describe("client metadata documents (an https client_id, as Claude Code uses)", () => {
  it("advertises support in the authorization server metadata", async () => {
    const asm = (await (await SELF.fetch(`${ORIGIN}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(asm.client_id_metadata_document_supported).toBe(true);
  });

  it("signs Claude Code in: reads its document, accepts any loopback port, issues tokens to the URL client_id", async () => {
    const clientId = newClientId();
    serve(clientId, claudeCodeDoc(clientId));
    const handle = `cc-${uid()}`;
    await upsertMember(env.DB, handle, "cc-passcode-2026");
    const redirectUri = "http://localhost:49930/callback";

    const html = await authorizePage(clientId, redirectUri);
    expect(html).toContain("<strong>Claude Code</strong>");
    expect(html).toContain(`(${new URL(clientId).host})`);
    expect(html).toContain("<code>localhost:49930</code>");
    expect(html).toContain('<form method="post" action="/authorize">');

    const signIn = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: await challenge(),
        code_challenge_method: "S256",
        state: "st",
        scope: "handoff offline_access",
        handle,
        access_code: "cc-passcode-2026",
      }),
    });
    expect(signIn.status).toBe(302);
    const loc = new URL(signIn.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe(redirectUri);
    const code = loc.searchParams.get("code")!;

    const tokenRes = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri }),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string };
    expect(decodeJwt(tokens.access_token)).toMatchObject({ sub: handle, client_id: clientId });

    // The document is kept for a day: the sign-in page, the form post and a new sign-in fetched it once.
    await authorizePage(clientId, "http://127.0.0.1:51000/callback");
    expect(hits.get(clientId)).toBe(1);
    const row = await env.DB.prepare("SELECT client_name, redirect_uris, fetched_at FROM oauth_clients WHERE client_id = ?")
      .bind(clientId)
      .first<{ client_name: string; redirect_uris: string; fetched_at: string }>();
    expect(row?.client_name).toBe("Claude Code");
    expect(JSON.parse(row!.redirect_uris)).toEqual(["http://localhost/callback", "http://127.0.0.1/callback"]);
  });

  it("signs ChatGPT in: it prefers private_key_jwt, and PKCE is what grants the token", async () => {
    const clientId = newClientId();
    serve(clientId, chatgptDoc(clientId));
    const handle = `gpt-${uid()}`;
    await upsertMember(env.DB, handle, "gpt-passcode-2026");
    const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";

    const html = await authorizePage(clientId, redirectUri);
    expect(html).toContain("<strong>ChatGPT</strong>");
    expect(html).toContain("<code>chatgpt.com</code>");
    expect(html).toContain('<form method="post" action="/authorize">');

    const signIn = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: await challenge(),
        code_challenge_method: "S256",
        state: "st",
        scope: "handoff offline_access",
        handle,
        access_code: "gpt-passcode-2026",
      }),
    });
    expect(signIn.status).toBe(302);
    const code = new URL(signIn.headers.get("location")!).searchParams.get("code")!;

    // A client assertion, if ChatGPT sends one, is not what grants the token: PKCE is.
    const assertion = { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: "eyJhbGciOiJSUzI1NiJ9.e30.sig" };
    const wrong = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: "not-the-verifier-0123456789-0123456789-0123", client_id: clientId, redirect_uri: redirectUri, ...assertion }),
    });
    expect(wrong.status).toBe(400);

    const signIn2 = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", code_challenge: await challenge(), code_challenge_method: "S256", state: "st", scope: "handoff offline_access", handle, access_code: "gpt-passcode-2026" }),
    });
    const code2 = new URL(signIn2.headers.get("location")!).searchParams.get("code")!;
    const tokenRes = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code2, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri, ...assertion }),
    });
    expect(tokenRes.status).toBe(200);
    expect(decodeJwt(((await tokenRes.json()) as { access_token: string }).access_token)).toMatchObject({ sub: handle, client_id: clientId });
  });

  it("does not refuse a client for the way it prefers to authenticate: no client is listed in advance", async () => {
    for (const extra of [{ token_endpoint_auth_method: "client_secret_basic" }, { token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["private_key_jwt"] }]) {
      const clientId = newClientId();
      serve(clientId, { ...claudeCodeDoc(clientId), ...extra });
      const html = await authorizePage(clientId, "http://localhost:49930/callback");
      expect(html, JSON.stringify(extra)).toContain('<form method="post" action="/authorize">');
    }
  });

  it("refuses redirect addresses the document does not list", async () => {
    const clientId = newClientId();
    serve(clientId, claudeCodeDoc(clientId));
    for (const uri of [
      "https://evil.example.net/callback", // not in the document
      "http://localhost:49930/other", // another path
      "http://[::1]:49930/callback", // another loopback host than the ones listed
      "http://localhost:49930/callback?x=1", // a query the document does not have
      "http://evil.example.net/callback", // not loopback, not https
    ]) {
      const html = await authorizePage(clientId, uri);
      expect(html, uri).toContain(refused);
      expect(html, uri).not.toContain("<form");
    }
  });

  it("refuses documents it cannot use, and records why", async () => {
    const cases: Array<[string, (id: string) => void]> = [
      ["client_id_mismatch", (id) => serve(id, claudeCodeDoc("https://other.example.com/doc"))],
      ["bad_redirect_uris", (id) => serve(id, { ...claudeCodeDoc(id), redirect_uris: ["http://evil.example.net/cb"] })],
      ["bad_redirect_uris", (id) => serve(id, { ...claudeCodeDoc(id), redirect_uris: [] })],
      ["not_json", (id) => serve(id, "<html>hello</html>")],
      ["too_large", (id) => serve(id, { ...claudeCodeDoc(id), padding: "x".repeat(6000) })],
      ["http_404", (id) => serve(id, "missing", { status: 404 })],
      ["http_302", (id) => serve(id, null, { status: 302, headers: { location: "https://elsewhere.example.com/doc" } })],
      ["unreachable", () => undefined],
    ];
    for (const [problem, setup] of cases) {
      const clientId = newClientId();
      setup(clientId);
      const html = await authorizePage(clientId, "http://localhost:49930/callback");
      expect(html, problem).toContain(refused);
      const ev = await env.DB.prepare("SELECT outcome, name FROM events WHERE kind = 'client_metadata' AND client_id = ? ORDER BY id DESC")
        .bind(clientId)
        .first<{ outcome: string; name: string }>();
      expect(ev, problem).toMatchObject({ outcome: problem, name: new URL(clientId).host });
      expect(await env.DB.prepare("SELECT 1 FROM oauth_clients WHERE client_id = ?").bind(clientId).first(), problem).toBeNull();
    }
  });

  it("does not fetch client_ids that are not a plain https document URL", async () => {
    for (const id of [
      "http://assistant.example.com/doc",
      "https://203.0.113.9/doc",
      "https://[2001:db8::1]/doc",
      "https://assistant.example.com:8443/doc",
      "https://assistant.example.com/",
      "https://user:pw@assistant.example.com/doc",
      "https://assistant.example.com/doc#frag",
      "https://assistant.example.com/a/../doc",
      "https://intranet/doc",
    ]) {
      expect(isMetadataClientId(id), id).toBe(false);
      expect(await authorizePage(id, "http://localhost:49930/callback"), id).toContain(refused);
    }
    expect(hits.size).toBe(0);
    expect(isMetadataClientId("https://claude.ai/oauth/claude-code-client-metadata")).toBe(true);
  });

  it("reads the document again after a day, and refuses if it cannot", async () => {
    const clientId = newClientId();
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await env.DB.prepare("INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at, fetched_at) VALUES (?, ?, 'Old name', ?, ?)")
      .bind(clientId, JSON.stringify(["http://localhost/callback"]), old, old)
      .run();

    // The client withdrew localhost: the old copy is not used.
    serve(clientId, { ...claudeCodeDoc(clientId), redirect_uris: ["http://127.0.0.1/callback"] });
    expect(await authorizePage(clientId, "http://localhost:49930/callback")).toContain(refused);
    expect(await authorizePage(clientId, "http://127.0.0.1:49930/callback")).toContain("<strong>Claude Code</strong>");
    expect(hits.get(clientId)).toBe(1);

    // Stale again, and the document is gone: refused, even though a copy is kept.
    await env.DB.prepare("UPDATE oauth_clients SET fetched_at = ? WHERE client_id = ?").bind(old, clientId).run();
    docs.delete(clientId);
    expect(await authorizePage(clientId, "http://127.0.0.1:49930/callback")).toContain(refused);
  });
});

describe("redirect matching", () => {
  it("matches a loopback address on any port, and nothing else loosely", () => {
    expect(redirectMatches("http://127.0.0.1:8765/callback", "http://127.0.0.1:9999/callback")).toBe(true);
    expect(redirectMatches("http://localhost/callback", "http://localhost:49930/callback")).toBe(true);
    expect(redirectMatches("http://localhost/callback", "http://127.0.0.1:49930/callback")).toBe(false);
    expect(redirectMatches("http://localhost/callback", "http://localhost:49930/callback/")).toBe(false);
    expect(redirectMatches("http://localhost/callback", "http://u:p@localhost:49930/callback")).toBe(false);
    expect(redirectMatches("https://app.example.com/cb", "https://app.example.com/cb")).toBe(true);
    expect(redirectMatches("https://app.example.com/cb", "https://app.example.com:8443/cb")).toBe(false);
  });

  it("lets a registered (RFC 7591) terminal client come back on a new port", async () => {
    const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Terminal app", redirect_uris: ["http://127.0.0.1:8765/callback"] }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    expect(await authorizePage(client_id, "http://127.0.0.1:40001/callback")).toContain("<strong>Terminal app</strong>");
    expect(await authorizePage(client_id, "http://localhost:8765/callback")).toContain(refused);
    expect(hits.size).toBe(0);
  });
});
