import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import privateJwk from "./test/fixtures/test-private-jwk.json" with { type: "json" };

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
      testTimeout: 20_000,
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            PUBLIC_URL: "https://handoff.test",
            // The Worker is the issuer. The test key signs its tokens, so test/helpers.ts can mint them too.
            OAUTH_SIGNING_JWK: JSON.stringify(privateJwk),
            HANDOFF_ENV: "production",
            MAX_ATTACHMENT_BYTES: String(1024 * 1024),
            // The import tests' stand-in host. An empty list turns imports off (test/import.test.ts checks that too).
            IMPORT_HOST_ALLOWLIST: "files.host-example.com",
            // The suite must not reach the network: the daily update check is off unless a test turns it on.
            HANDOFF_UPDATE_CHECK: "off",
          },
        },
      }),
    ],
  };
});
