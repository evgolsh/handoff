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

/** The store this deployment has: the R2 bucket when one is bound (BLOBS), otherwise the KV namespace (FILES). */
export function blobStore(env: { BLOBS?: R2Bucket; FILES?: KVNamespace }): BlobStore {
  if (env.BLOBS) return new R2BlobStore(env.BLOBS);
  if (env.FILES) return new KvBlobStore(env.FILES);
  throw new Error("no file store is bound: add a KV namespace (FILES) or an R2 bucket (BLOBS) to wrangler.jsonc");
}
