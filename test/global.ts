export {};

type AppEnv = import("../src/env").Env;
type Migrations = import("cloudflare:test").D1Migration[];

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: Migrations;
    }
  }
}
