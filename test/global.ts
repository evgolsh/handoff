export {};

type AppEnv = import("../src/env").Env;
type Migrations = import("cloudflare:test").D1Migration[];

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: Migrations;
      /** vitest.config.ts binds both stores: R2 (the suite's default) and the KV namespace from wrangler.jsonc. */
      BLOBS: R2Bucket;
      FILES: KVNamespace;
    }
  }
}
