import { configFrom, type Env } from "./env";
import { redactSecrets } from "./domain/errors";
import { HandoffService } from "./domain/service";
import { D1Repository } from "./store/d1";
import { R2BlobStore } from "./store/blobs";
import { pruneRecords, recordEvent, type RecordsPruned } from "./store/events";

export type CleanupResult = { attachments_deleted: number; packets_deleted: number; backlog: boolean } & RecordsPruned;

/**
 * One cleanup run: expired packets and stale files (src/domain/service.ts), then records that no longer do
 * anything (src/store/events.ts). Runs hourly (wrangler.jsonc triggers) and from the console's Ops page.
 * The run is recorded as an event and logged; a failed run is rethrown.
 */
export async function runCleanup(env: Env, trigger: "schedule" | "console", by: string | null = null): Promise<CleanupResult> {
  const started = Date.now();
  try {
    const service = new HandoffService(new D1Repository(env.DB), new R2BlobStore(env.BLOBS), configFrom(env));
    const result: CleanupResult = { ...(await service.cleanup()), ...(await pruneRecords(env.DB)) };
    const ms = Date.now() - started;
    await recordEvent(env.DB, { kind: "cleanup", name: trigger, subject: by, outcome: result.backlog ? "backlog" : "ok", ms, detail: { ...result } });
    console.log(JSON.stringify({ level: result.backlog ? "warn" : "info", event: "cleanup", trigger, ms, ...result }));
    return result;
  } catch (err) {
    const e = err as Error;
    const message = redactSecrets(String(e.message));
    await recordEvent(env.DB, { kind: "cleanup", name: trigger, subject: by, outcome: "error", ms: Date.now() - started, detail: { error: e.name, message: message.slice(0, 300) } });
    console.error(JSON.stringify({ level: "error", event: "cleanup", trigger, name: e.name, message }));
    // Rethrown, so a scheduled run is recorded as failed. Deletions done before the error stay done.
    throw err;
  }
}
