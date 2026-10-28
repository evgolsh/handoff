import { createApp } from "./app";
import { runCleanup } from "./cleanup";
import type { Env } from "./env";

const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env, "schedule"));
  },
} satisfies ExportedHandler<Env>;
