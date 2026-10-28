import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { upsertMember } from "../src/auth/builtin";
import { base64url } from "../src/domain/ids";
import { ORIGIN, ISSUER, alice, rpc, token } from "./helpers";

describe("protected resource metadata", () => {
  it("is served at both RFC 9728 locations without auth", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`);
      expect(res.status).toBe(200);
      const meta = (await res.json()) as any;
      expect(meta.resource).toBe(`${ORIGIN}/mcp`);
      expect(meta.authorization_servers).toEqual([ORIGIN]);
      expect(ISSUER).toBe(ORIGIN);
      expect(meta.bearer_methods_supported).toEqual(["header"]);
      expect(meta.scopes_supported).toEqual(["handoff", "offline_access"]);
    }
  });
});

describe("bearer token checks on /mcp", () => {
  const post = (headers: Record<string, string>) =>
    SELF.fetch(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });

  it("401 with a resource_metadata challenge when no token is sent", async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    const www = res.headers.get("www-authenticate") ?? "";
    expect(www).toContain('resource_metadata="https://handoff.test/.well-known/oauth-protected-resource"');
    expect(www).toMatch(/^Bearer /);
  });

  it("rejects a token from another issuer", async () => {
    const res = await post({ authorization: `Bearer ${await token("x", { iss: "https://evil.example" })}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("rejects a token for another audience", async () => {
    const res = await post({ authorization: `Bearer ${await token("x", { aud: "https://other.example/mcp" })}` });
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const res = await post({ authorization: `Bearer ${await token("x", { expInSeconds: -3600 })}` });
    expect(res.status).toBe(401);
  });

  it("rejects a token signed by an unknown key", async () => {
    const res = await post({ authorization: `Bearer ${await token("x", { kid: "someone-else" })}` });
    expect(res.status).toBe(401);
  });

  it("rejects garbage", async () => {
    const res = await post({ authorization: "Bearer not.a.jwt" });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token", async () => {
    const { status, body } = await rpc(await alice(), "tools/list");
    expect(status).toBe(200);
    expect(body.result.tools.map((t: any) => t.name).sort()).toEqual(
      ["handoff_inbox", "handoff_read", "handoff_revoke", "handoff_send", "handoff_upload_url"].sort(),
    );
  });

  it("never lets the owner come from request input", async () => {
    // Bob has a packet; Alice asks for Bob's inbox by argument. The owner is the token's subject, so she sees only hers.
    const bobPacket = await rpc(await token("user_bob"), "tools/call", {
      name: "handoff_send",
      arguments: { title: "bob's", brief: "b", idempotency_key: crypto.randomUUID() },
    });
    const bobId = bobPacket.body.result.structuredContent.packet_id;
    const { body } = await rpc(await alice(), "tools/call", { name: "handoff_inbox", arguments: { owner_id: "user_bob", owner: "user_bob", user_id: "user_bob" } });
    const ids = (body.result.structuredContent.packets as any[]).map((p) => p.packet_id);
    expect(ids).not.toContain(bobId);
  });
});

describe("authorize page", () => {
  it("has no script, frames nothing in, and offers no form for a client that never registered", async () => {
    const res = await SELF.fetch(`${ORIGIN}/authorize?client_id=client_unknown&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fx&response_type=code&code_challenge=abc`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src");
    const html = await res.text();
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toContain("<form");
    expect(html).toContain("did not come from an assistant registered with this server");
  });

  it("names a registered client and where it returns to", async () => {
    const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude Code <b>", redirect_uris: ["http://localhost:33418/callback"] }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const html = await (await SELF.fetch(`${ORIGIN}/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent("http://localhost:33418/callback")}&response_type=code&code_challenge=abc&code_challenge_method=S256`)).text();
    expect(html).toContain("<strong>Claude Code &lt;b&gt;</strong> asks to use Handoff as you");
    expect(html).toContain("<code>localhost:33418</code>");
    expect(html).toContain('<form method="post" action="/authorize">');
  });

  it("signs in a desktop app that returns to its own scheme, as Cursor does", async () => {
    const redirectUri = "cursor://anysphere.cursor-mcp/oauth/callback";
    const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Cursor", redirect_uris: [redirectUri] }),
    });
    expect(reg.status).toBe(201);
    const { client_id } = (await reg.json()) as { client_id: string };
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const oauth = { client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1", scope: "handoff offline_access" };
    const html = await (await SELF.fetch(`${ORIGIN}/authorize?${new URLSearchParams(oauth)}`)).text();
    expect(html).toContain("<code>cursor://anysphere.cursor-mcp</code>");

    await upsertMember(env.DB, "cursor-user", "cursor-passcode-2026");
    const signIn = await SELF.fetch(`${ORIGIN}/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...oauth, handle: "cursor-user", access_code: "cursor-passcode-2026" }),
    });
    expect(signIn.status).toBe(302);
    const loc = new URL(signIn.headers.get("location")!);
    expect(`${loc.protocol}//${loc.host}${loc.pathname}`).toBe(redirectUri);
    const tok = await SELF.fetch(`${ORIGIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: loc.searchParams.get("code")!, code_verifier: verifier, client_id, redirect_uri: redirectUri }),
    });
    expect(tok.status).toBe(200);
  });

  it("refuses to register return addresses a browser would run or read, and plain http off this computer", async () => {
    for (const uri of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "http://evil.example.net/cb", "mailto:x@example.com", "https://ok.example.com/cb#frag"]) {
      const reg = await SELF.fetch(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Bad", redirect_uris: [uri] }),
      });
      expect(reg.status, uri).toBe(400);
    }
  });

  it("has no Stytch page, callback or SDK", async () => {
    expect((await SELF.fetch(`${ORIGIN}/authenticate`)).status).toBe(404);
    expect((await SELF.fetch(`${ORIGIN}/stytch.js`)).status).toBe(404);
  });
});
