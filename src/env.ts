export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  /** Public origin, without a trailing slash. Empty: the origin of the request. */
  PUBLIC_URL?: string;
  /** Optional ES256 private JWK (JSON) that signs access tokens. Empty: a key generated once and kept in D1. */
  OAUTH_SIGNING_JWK?: string;
  HANDOFF_ENV?: string;
  /** Local development only (HANDOFF_ENV=dev): JSON object { "<token>": "<subject>" }. */
  DEV_TOKENS?: string;
  /**
   * A secret the deployer chooses (12 characters or more). While no member is an admin, /console/setup accepts it
   * once to create the first admin. Set by the Deploy to Cloudflare button from .dev.vars.example.
   */
  HANDOFF_SETUP_CODE?: string;
  MAX_ATTACHMENT_BYTES?: string;
  IMPORT_HOST_ALLOWLIST?: string;
  ASSETS?: Fetcher;
  /** The deployed version (wrangler.jsonc version_metadata), shown on the console's Ops page. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

/** Scopes this server offers. A token's scope is informational: every signed-in member may use every tool. */
export const SCOPES = ["handoff", "offline_access"];

export interface Config {
  publicUrl: string;
  /** The MCP endpoint, PUBLIC_URL + "/mcp": the audience of every access token. */
  mcpResource: string;
  /** This Worker is its own OAuth 2.1 authorization server: the issuer is PUBLIC_URL. */
  issuer: string;
  oauthSigningJwk: string | null;
  /** Dev bearer token -> subject. Empty unless HANDOFF_ENV=dev and the request is to localhost. A Map, so no inherited property can match. */
  devTokens: Map<string, string>;
  maxAttachmentBytes: number;
  importHostAllowlist: string[];
  /** Attachments larger than this are not returned inline as image content. */
  maxInlineImageBytes: number;
  maxInlineTextChars: number;
  maxBriefChars: number;
  maxTitleChars: number;
  maxAttachmentsPerPacket: number;
  /** Files of one owner that are uploading or uploaded but in no packet. A new upload or import beyond it is refused. */
  maxUnsentFilesPerOwner: number;
  /** Cleanup works in batches of this many rows, at most this many batches per kind of row in one run. */
  cleanupBatch: number;
  cleanupRounds: number;
  defaultExpiryHours: number;
  maxExpiryHours: number;
  uploadTicketTtlMs: number;
  downloadTicketTtlMs: number;
  stagingTtlMs: number;
  unattachedReadyTtlMs: number;
  expiredPacketGraceMs: number;
}

const list = (s: string | undefined): string[] =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Whether a request came to this computer: dev tokens work only there, even if HANDOFF_ENV=dev were deployed. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return (protocol === "http:" || protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function configFrom(env: Env, requestOrigin = ""): Config {
  const publicUrl = (env.PUBLIC_URL?.trim() || requestOrigin).replace(/\/+$/, "");
  const mcpResource = `${publicUrl}/mcp`;
  const devTokens = new Map<string, string>();
  if (env.HANDOFF_ENV === "dev" && env.DEV_TOKENS && isLoopbackOrigin(requestOrigin)) {
    try {
      const parsed: unknown = JSON.parse(env.DEV_TOKENS);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [token, subject] of Object.entries(parsed)) {
          if (token && typeof subject === "string" && subject) devTokens.set(token, subject);
        }
      }
    } catch {
      // Malformed DEV_TOKENS: no dev tokens.
    }
  }
  const hour = 3_600_000;
  return {
    publicUrl,
    mcpResource,
    issuer: publicUrl,
    oauthSigningJwk: env.OAUTH_SIGNING_JWK?.trim() || null,
    devTokens,
    maxAttachmentBytes: Number(env.MAX_ATTACHMENT_BYTES) || 25 * 1024 * 1024,
    importHostAllowlist: list(env.IMPORT_HOST_ALLOWLIST).map((h) => h.toLowerCase()),
    maxInlineImageBytes: 3 * 1024 * 1024,
    maxInlineTextChars: 100_000,
    maxBriefChars: 64_000,
    maxTitleChars: 200,
    maxAttachmentsPerPacket: 10,
    maxUnsentFilesPerOwner: 50,
    cleanupBatch: 200,
    cleanupRounds: 5,
    defaultExpiryHours: 24 * 30,
    maxExpiryHours: 24 * 90,
    uploadTicketTtlMs: 15 * 60_000,
    downloadTicketTtlMs: 10 * 60_000,
    stagingTtlMs: 24 * hour,
    unattachedReadyTtlMs: 7 * 24 * hour,
    expiredPacketGraceMs: 7 * 24 * hour,
  };
}
