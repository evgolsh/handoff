import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createApp } from "../src/app";
import { upsertMember } from "../src/auth/builtin";
import { base64url } from "../src/domain/ids";
import { ORIGIN } from "./helpers";

describe("built-in Worker OAuth 2.1 server (zero external IdP)", () => {
  const builtinEnv = () => ({
    ...env,
    PUBLIC_URL: ORIGIN,
  });

  it("completes full RFC 8414 discovery, RFC 7591 DCR, PKCE S256 login, MCP call, and refresh rotation", async () => {
    const app = createApp();
    const bEnv = builtinEnv();

    // Seed two family/team members in D1.
    await upsertMember(env.DB, "tom", "tom-passcode-2026");
    await upsertMember(env.DB, "tim", "tim-passcode-2026");

    // 1. Protected resource metadata points to this Worker as the authorization server.
    const prmRes = await app.fetch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`), bEnv);
    expect(prmRes.status).toBe(200);
    const prm = (await prmRes.json()) as any;
    expect(prm.authorization_servers).toEqual([ORIGIN]);

    // 2. Authorization server metadata & JWKS.
    const asmRes = await app.fetch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), bEnv);
    expect(asmRes.status).toBe(200);
    const asm = (await asmRes.json()) as any;
    expect(asm.issuer).toBe(ORIGIN);
    expect(asm.code_challenge_methods_supported).toEqual(["S256"]);

    const jwksRes = await app.fetch(new Request(`${ORIGIN}/.well-known/jwks.json`), bEnv);
    expect(jwksRes.status).toBe(200);
    const jwks = (await jwksRes.json()) as any;
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].alg).toBe("ES256");

    // 3. Dynamic Client Registration (RFC 7591).
    const badDcr = await app.fetch(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://evil.example.com/cb"] }),
      }),
      bEnv,
    );
    expect(badDcr.status).toBe(400);

    const redirectUri = "http://127.0.0.1:8765/callback";
    const dcrRes = await app.fetch(
      new Request(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Hermes Agent", redirect_uris: [redirectUri] }),
      }),
      bEnv,
    );
    expect(dcrRes.status).toBe(201);
    const client = (await dcrRes.json()) as { client_id: string };
    expect(client.client_id).toMatch(/^client_/);

    // 4. GET /authorize serves the built-in console-styled form (no Stytch script).
    const verifier = "verifier_secret_string_for_pkce_s256_test_1234567890";
    const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = base64url(challengeBytes);

    const authGet = await app.fetch(
      new Request(
        `${ORIGIN}/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=xyz123`,
      ),
      bEnv,
    );
    expect(authGet.status).toBe(200);
    const authHtml = await authGet.text();
    expect(authHtml).toContain("<strong>Hermes Agent</strong> asks to use Handoff as you");
    expect(authHtml).not.toContain("/stytch.js");

    // 5. POST /authorize rejects a bad passcode, then issues a single-use code on the valid passcode.
    const badPost = await app.fetch(
      new Request(`${ORIGIN}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: redirectUri,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "xyz123",
          handle: "tom",
          access_code: "wrong-code",
        }),
      }),
      bEnv,
    );
    expect(badPost.status).toBe(401);

    const goodPost = await app.fetch(
      new Request(`${ORIGIN}/authorize`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: redirectUri,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          state: "xyz123",
          handle: "tom",
          access_code: "tom-passcode-2026",
        }),
      }),
      bEnv,
    );
    expect(goodPost.status).toBe(302);
    const loc = new URL(goodPost.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(redirectUri);
    expect(loc.searchParams.get("state")).toBe("xyz123");
    expect(loc.searchParams.get("iss")).toBe(ORIGIN);
    const code = loc.searchParams.get("code")!;
    expect(code).toMatch(/^hc_/);

    // 6. POST /oauth/token exchanges the code with PKCE verification and rejects replay.
    const tokenRes = await app.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: client.client_id,
          redirect_uri: redirectUri,
        }),
      }),
      bEnv,
    );
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toMatch(/^hr_/);

    const replayCode = await app.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: client.client_id,
          redirect_uri: redirectUri,
        }),
      }),
      bEnv,
    );
    expect(replayCode.status).toBe(400);

    // 7. Call /mcp using the built-in OAuth access_token!
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const mcpRes = await app.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "handoff_send",
            arguments: {
              title: "Built-in OAuth test",
              brief: "Sent by tom using built-in Worker OAuth.",
              to: "tim",
              idempotency_key: crypto.randomUUID(),
            },
          },
        }),
      }),
      bEnv,
      ctx,
    );
    expect(mcpRes.status).toBe(200);
    const mcpJson = (await mcpRes.json()) as any;
    expect(mcpJson.result.structuredContent.from).toBe("tom");
    expect(mcpJson.result.structuredContent.to).toBe("tim");

    // 8. Rotate the refresh token and verify single-use rotation.
    const refreshRes = await app.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: client.client_id,
        }),
      }),
      bEnv,
    );
    expect(refreshRes.status).toBe(200);
    const rotated = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    const reuseRefresh = await app.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: client.client_id,
        }),
      }),
      bEnv,
    );
    expect(reuseRefresh.status).toBe(400);
  });
});
