import { SignJWT, importJWK } from "jose";
import { SELF } from "cloudflare:test";
import privateJwk from "./fixtures/test-private-jwk.json";

export const ORIGIN = "https://handoff.test";
/** The Worker is its own OAuth issuer. */
export const ISSUER = ORIGIN;
export const AUDIENCE = `${ORIGIN}/mcp`;

let keyPromise: Promise<CryptoKey | Uint8Array> | null = null;
const key = () => (keyPromise ??= importJWK(privateJwk as JsonWebKey & { alg: string }, "ES256"));

export interface TokenOpts {
  iss?: string;
  aud?: string | string[];
  expInSeconds?: number;
  scope?: string;
  kid?: string;
  clientId?: string;
}

export async function token(sub: string, opts: TokenOpts = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({ scope: opts.scope ?? "handoff", client_id: opts.clientId ?? "test-client" })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "test-key-1" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expInSeconds ?? 3600));
  return jwt.sign(await key());
}

export const alice = () => token("user_alice");
export const bob = () => token("user_bob");

let rpcId = 0;

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export async function rpc(bearer: string, method: string, params: unknown = {}): Promise<{ status: number; body: any }> {
  const res = await SELF.fetch(`${ORIGIN}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const textBody = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(textBody);
  } catch {
    body = { raw: textBody };
  }
  return { status: res.status, body };
}

export async function call(bearer: string, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const { status, body } = await rpc(bearer, "tools/call", { name, arguments: args });
  if (status !== 200) throw new Error(`tools/call ${name}: HTTP ${status} ${JSON.stringify(body)}`);
  if (body.error) throw new Error(`tools/call ${name}: rpc error ${JSON.stringify(body.error)}`);
  return body.result as ToolResult;
}

export function expectOk(r: ToolResult): Record<string, unknown> {
  if (r.isError) throw new Error(`tool returned error: ${r.content.map((c) => c.text).join(" | ")}`);
  return r.structuredContent ?? {};
}

export function errorText(r: ToolResult): string {
  if (!r.isError) throw new Error(`expected an error result, got ${JSON.stringify(r.structuredContent)}`);
  return r.content.map((c) => c.text ?? "").join(" ");
}

export async function send(bearer: string, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return expectOk(
    await call(bearer, "handoff_send", {
      title: "Smart-invoice: next step",
      brief: "Purpose: ship the VAT fix.\nDecision: keep Hono.\nNext: run the tests.",
      idempotency_key: crypto.randomUUID(),
      ...overrides,
    }),
  );
}

export async function uploadBytes(bearer: string, filename: string, bytes: Uint8Array, contentType?: string, extraHeaders: Record<string, string> = {}) {
  const created = await SELF.fetch(`${ORIGIN}/v1/uploads`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({ filename, mime_type: contentType }),
  });
  if (created.status !== 201) throw new Error(`create upload: ${created.status} ${await created.text()}`);
  const { attachment_id, upload_url } = (await created.json()) as { attachment_id: string; upload_url: string };
  const put = await SELF.fetch(upload_url, {
    method: "PUT",
    headers: { authorization: `Bearer ${bearer}`, ...(contentType ? { "content-type": contentType } : {}), ...extraHeaders },
    body: bytes,
  });
  return { attachment_id, status: put.status, body: (await put.json()) as any };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n4 0 obj << /Length 44 >> stream\nBT (The code word is PELICAN) Tj ET\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
);
export const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
  0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa7, 0x56, 0xbd, 0xfa, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
export const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
export const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
