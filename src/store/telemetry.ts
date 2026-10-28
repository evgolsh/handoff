import type { Principal } from "../auth/verify";
import { recordEvent } from "./events";

/** One JSON-RPC request in an MCP POST that the console counts: a tool call, or the client's initialize. */
export interface McpCall {
  id: string | number | null;
  kind: "tool" | "initialize";
  name: string;
  version?: string;
}

const NAME = /^[A-Za-z0-9 ._:/@()+-]{1,80}$/;
const clean = (v: unknown): string | null => (typeof v === "string" && NAME.test(v) ? v : null);

/**
 * The tool calls and initialize requests in an MCP request body. Only names are kept: never arguments,
 * titles, briefs or file names. A body that is not JSON-RPC gives nothing.
 */
export async function mcpCallsIn(req: Request): Promise<McpCall[]> {
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return [];
  }
  const out: McpCall[] = [];
  for (const m of Array.isArray(body) ? body : [body]) {
    if (!m || typeof m !== "object") continue;
    const { id, method, params } = m as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
    const rid = typeof id === "string" || typeof id === "number" ? id : null;
    if (method === "tools/call") {
      out.push({ id: rid, kind: "tool", name: clean(params?.name) ?? "unknown" });
    } else if (method === "initialize") {
      const info = (params?.clientInfo ?? {}) as Record<string, unknown>;
      out.push({ id: rid, kind: "initialize", name: clean(info.name) ?? "unnamed", version: clean(info.version) ?? undefined });
    }
  }
  return out;
}

/**
 * Records each call with its outcome: "ok", the Handoff error code a tool returned ("not_found: ..."),
 * "error" for another tool error, or "rpc_error" when the request itself failed.
 */
export async function recordMcpCalls(db: D1Database, p: Principal, calls: McpCall[], res: Response, ms: number): Promise<void> {
  const byId = new Map<string | number, { result?: { isError?: boolean; content?: Array<{ text?: string }> }; error?: unknown }>();
  try {
    const body = (await res.json()) as unknown;
    for (const m of Array.isArray(body) ? body : [body]) {
      const id = (m as { id?: unknown })?.id;
      if (typeof id === "string" || typeof id === "number") byId.set(id, m as never);
    }
  } catch {
    // Not JSON (an error page): outcomes stay unknown.
  }
  for (const call of calls) {
    const reply = call.id === null ? undefined : byId.get(call.id);
    let outcome = res.ok ? "ok" : `http_${res.status}`;
    if (reply?.error) outcome = "rpc_error";
    else if (reply?.result?.isError) outcome = /^([a-z_]{2,40}):/.exec(reply.result.content?.[0]?.text ?? "")?.[1] ?? "error";
    else if (!reply && res.ok) outcome = "no_reply";
    await recordEvent(db, {
      kind: call.kind,
      name: call.name,
      subject: p.subject,
      client_id: p.clientId,
      outcome,
      ms: call.kind === "tool" ? ms : null,
      detail: call.version ? { version: call.version } : null,
    });
  }
}
