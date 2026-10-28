export interface StoredBlob {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string | null;
}

/** Narrow object-storage contract. R2 implements it; a GCS profile would too. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, meta: { contentType: string; sha256: string }): Promise<void>;
  get(key: string): Promise<StoredBlob | null>;
  delete(key: string): Promise<void>;
}

export class R2BlobStore implements BlobStore {
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
}
