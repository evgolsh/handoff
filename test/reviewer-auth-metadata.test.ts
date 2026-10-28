import { describe, expect, it } from "vitest";
import { SignJWT, importJWK } from "jose";
import privateJwk from "./fixtures/test-private-jwk.json";
import { AUDIENCE, ISSUER, rpc } from "./helpers";

describe("reviewer: production bearer validation", () => {
  it.each(["toString", "constructor", "__proto__"])("rejects inherited-object bearer %s", async (bearer) => {
    const result = await rpc(bearer, "tools/list");
    expect(result.status).toBe(401);
  });

  it("rejects a signed access token without an expiry", async () => {
    const key = await importJWK(privateJwk, "ES256");
    const bearer = await new SignJWT({ scope: "handoff", client_id: "test-client" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("reviewer-no-expiry")
      .setIssuedAt()
      .sign(key);
    const result = await rpc(bearer, "tools/list");
    expect(result.status).toBe(401);
  });
});
