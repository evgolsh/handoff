import { nowIso } from "../domain/ids";
import { recordEvent } from "../store/events";

/**
 * Which assistants may ask a member to sign in, and where the sign-in may return.
 *
 * Any standard MCP client signs in without being listed here. Two kinds:
 * - Registered (RFC 7591): the assistant POSTs its redirect addresses to /oauth/register and gets a client_id.
 * - Metadata document (draft-ietf-oauth-client-id-metadata-document, used by MCP since 2025-11-25): the client_id
 *   is an https URL where the assistant publishes its name and redirect addresses. Claude Code signs in this way.
 *   The document is fetched when first seen, kept in oauth_clients, and fetched again after a day.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Schemes a browser runs, reads or handles itself. Never a place for a sign-in code. */
const BROWSER_SCHEMES = new Set([
  "javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "filesystem:", "view-source:",
  "ws:", "wss:", "ftp:", "mailto:", "tel:", "sms:", "intent:", "chrome:", "edge:",
]);

/**
 * Where a sign-in may return: https, http on the same computer (loopback), or a desktop app's own scheme such as
 * cursor:// (RFC 8252 §7.1). Another app could claim the same scheme, but the code is useless without the PKCE
 * verifier, which this server requires.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  return !BROWSER_SCHEMES.has(u.protocol);
}

/**
 * Whether the requested redirect address is the registered one. A loopback address matches on any port
 * (RFC 8252 §7.3): a terminal app picks a free port each time it signs in, and the code stays on that computer.
 */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  let r: URL;
  let q: URL;
  try {
    r = new URL(registered);
    q = new URL(requested);
  } catch {
    return false;
  }
  if (r.protocol !== "http:" || q.protocol !== "http:" || !LOOPBACK.has(r.hostname) || q.hostname !== r.hostname) return false;
  if (r.username || r.password || q.username || q.password || q.hash) return false;
  return q.pathname === r.pathname && q.search === r.search;
}

/** Fetched documents are kept this long before they are fetched again. */
export const METADATA_TTL_MS = 24 * 3_600_000;
const METADATA_MAX_BYTES = 5 * 1024;
const METADATA_TIMEOUT_MS = 5_000;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * A client_id that names a metadata document: an https URL with a host name (not an address), the default port,
 * a path, and no user, password or fragment, written in its normal form.
 */
export function isMetadataClientId(id: string): boolean {
  if (!id || id.length > 512) return false;
  let u: URL;
  try {
    u = new URL(id);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.hash) return false;
  if (IPV4.test(u.hostname) || u.hostname.startsWith("[") || !u.hostname.includes(".")) return false;
  if (u.pathname === "/" || u.pathname === "") return false;
  // The normal form only: no "..", no default port, no case tricks in the host.
  return u.toString() === id;
}

export interface ClientMetadata {
  client_name: string;
  redirect_uris: string[];
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(all);
  } catch {
    return null;
  }
}

/**
 * Fetches and checks a client's metadata document. Null, with the reason, when it cannot be used: not 200 (a
 * redirect is not followed), larger than 5 KB, slower than 5 s, not JSON, a different client_id inside, or no
 * usable redirect address.
 *
 * The client's preferred token_endpoint_auth_method is not checked. This server never authenticates clients
 * (it advertises only "none"): PKCE S256 and the document's own redirect addresses protect the code, so a client
 * that prefers a key, as ChatGPT does, signs in like any other.
 */
export async function fetchClientMetadata(clientId: string): Promise<{ ok: ClientMetadata } | { problem: string }> {
  let res: Response;
  try {
    res = await globalThis.fetch(clientId, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch {
    return { problem: "unreachable" };
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    return { problem: `http_${res.status}` };
  }
  const text = await readCapped(res, METADATA_MAX_BYTES);
  if (text === null) return { problem: "too_large" };
  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { problem: "not_json" };
    doc = parsed as Record<string, unknown>;
  } catch {
    return { problem: "not_json" };
  }
  if (doc.client_id !== clientId) return { problem: "client_id_mismatch" };
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) return { problem: "bad_redirect_uris" };
  if (!uris.every((u) => typeof u === "string" && isAllowedRedirectUri(u))) return { problem: "bad_redirect_uris" };
  const host = new URL(clientId).host;
  const name = typeof doc.client_name === "string" && doc.client_name.trim() ? doc.client_name.trim().slice(0, 120) : host;
  return { ok: { client_name: name, redirect_uris: uris as string[] } };
}

export interface KnownClient {
  name: string;
  /** For a metadata-document client: the host that publishes the document (for example claude.ai). */
  publisher: string | null;
}

interface ClientRow {
  client_name: string | null;
  redirect_uris: string;
  fetched_at: string | null;
}

/** A client's name and redirect addresses: from oauth_clients, fetching a metadata document when needed. */
async function lookupClient(db: D1Database, clientId: string): Promise<{ name: string; redirectUris: string[]; publisher: string | null } | null> {
  const row = await db
    .prepare("SELECT client_name, redirect_uris, fetched_at FROM oauth_clients WHERE client_id = ?")
    .bind(clientId)
    .first<ClientRow>();
  const parse = (r: ClientRow): string[] => {
    try {
      const v: unknown = JSON.parse(r.redirect_uris);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };

  if (!isMetadataClientId(clientId)) {
    // Only registered clients. An unknown client_id with any https redirect would hand the code to whatever
    // site the link names.
    return row ? { name: row.client_name || "An MCP client", redirectUris: parse(row), publisher: null } : null;
  }

  const publisher = new URL(clientId).host;
  const fetchedAt = row?.fetched_at ? Date.parse(row.fetched_at) : NaN;
  if (row && Number.isFinite(fetchedAt) && Date.now() - fetchedAt < METADATA_TTL_MS) {
    return { name: row.client_name || publisher, redirectUris: parse(row), publisher };
  }
  const got = await fetchClientMetadata(clientId);
  if ("problem" in got) {
    // A document that cannot be read now is not used, even if an older copy is kept: the client may have
    // withdrawn a redirect address.
    await recordEvent(db, { kind: "client_metadata", name: publisher, client_id: clientId, outcome: got.problem }, { unauthenticated: true });
    return null;
  }
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO oauth_clients (client_id, redirect_uris, client_name, created_at, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET redirect_uris = excluded.redirect_uris, client_name = excluded.client_name,
         fetched_at = excluded.fetched_at`,
    )
    .bind(clientId, JSON.stringify(got.ok.redirect_uris), got.ok.client_name, now, now)
    .run();
  return { name: got.ok.client_name, redirectUris: got.ok.redirect_uris, publisher };
}

/** The client's name if this redirect address is one of its own; null otherwise. */
export async function registeredClient(db: D1Database, clientId: string, redirectUri: string): Promise<KnownClient | null> {
  if (!clientId || !isAllowedRedirectUri(redirectUri)) return null;
  const client = await lookupClient(db, clientId);
  if (!client || !client.redirectUris.some((r) => redirectMatches(r, redirectUri))) return null;
  return { name: client.name, publisher: client.publisher };
}
