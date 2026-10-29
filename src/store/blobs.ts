export interface StoredBlob {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string | null;
}

/** Narrow object-storage contract. Workers KV and R2 implement it. */
export interface BlobStore {
  /** "KV" or "R2": shown on the console's Overview. */
  readonly name: string;
  put(key: string, bytes: Uint8Array, meta: { contentType: string; sha256: string }): Promise<void>;
  get(key: string): Promise<StoredBlob | null>;
  delete(key: string): Promise<void>;
  /** One cheap round trip, for the console's health check. Rejects when the store does not answer. */
  ping(): Promise<void>;
}

/**
 * Workers KV: the default store of a self-hosted install. It is on the Workers free plan (no payment method),
 * holds values up to 25 MiB (the file limit) and 1 GB per account on that plan.
 */
export class KvBlobStore implements BlobStore {
  readonly name = "KV";
  constructor(private readonly kv: KVNamespace) {}

  async put(key: string, bytes: Uint8Array, meta: { contentType: string; sha256: string }): Promise<void> {
    await this.kv.put(key, bytes as unknown as ArrayBuffer, { metadata: { ...meta, size: bytes.byteLength } });
  }

  async get(key: string): Promise<StoredBlob | null> {
    const { value, metadata } = await this.kv.getWithMetadata<{ contentType?: string; size?: number }>(key, "stream");
    if (!value) return null;
    return { body: value, size: metadata?.size ?? 0, contentType: metadata?.contentType ?? null };
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async ping(): Promise<void> {
    await this.kv.list({ limit: 1 });
  }
}

/** R2: optional, for installs that have a payment method on Cloudflare and want more than KV's free plan. */
export class R2BlobStore implements BlobStore {
  readonly name = "R2";
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, bytes: Uint8Array, meta: { contentType: string; sha256: string }): Promise<void> {
    await this.bucket.put(key, bytes as unknown as ArrayBuffer, {
      httpMetadata: { contentType: meta.contentType },
      customMetadata: { sha256: meta.sha256 },
    });
  }

  async get(key: string): Promise<StoredBlob | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return { body: obj.body, size: obj.size, contentType: obj.httpMetadata?.contentType ?? null };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async ping(): Promise<void> {
    await this.bucket.list({ limit: 1 });
  }
}

/** The adapters by the FILE_STORE setting. A future "s3" or "gcs" entry builds its adapter from env secrets. */
const ADAPTERS: Record<string, (env: StoreEnv) => BlobStore | null> = {
  kv: (env) => (env.FILES ? new KvBlobStore(env.FILES) : null),
  r2: (env) => (env.BLOBS ? new R2BlobStore(env.BLOBS) : null),
};
const BINDING: Record<string, string> = { kv: "a KV namespace bound as FILES", r2: "an R2 bucket bound as BLOBS" };

export type StoreEnv = { FILE_STORE?: string; BLOBS?: R2Bucket; FILES?: KVNamespace };

/**
 * The file store of this deployment. FILE_STORE names it ("kv", the default of a self-hosted install, or "r2").
 * Unset: the R2 bucket when one is bound, otherwise the KV namespace, so an install that only binds one works.
 */
export function blobStore(env: StoreEnv): BlobStore {
  const chosen = (env.FILE_STORE ?? "").trim().toLowerCase();
  if (chosen) {
    const make = ADAPTERS[chosen];
    if (!make) throw new Error(`FILE_STORE "${chosen}" is unknown: use ${Object.keys(ADAPTERS).join(" or ")}`);
    const store = make(env);
    if (!store) throw new Error(`FILE_STORE is "${chosen}" but wrangler.jsonc binds no ${BINDING[chosen]}`);
    return store;
  }
  return ADAPTERS.r2!(env) ?? ADAPTERS.kv!(env) ?? (() => { throw new Error("no file store is bound: add a KV namespace (FILES) or an R2 bucket (BLOBS) to wrangler.jsonc"); })();
}
