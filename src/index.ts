import { createApp } from "./app";
import { runCleanup } from "./cleanup";
import type { Env } from "./env";
import { runUpdateCheck } from "./update-check";

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env, "schedule"));
    // Once a day (the module keeps the date); never fails the run.
    ctx.waitUntil(runUpdateCheck(env).catch(() => undefined));
  },
} satisfies ExportedHandler<Env>;
