// src/refs/ref-cache.ts
// LRU cache for MinIO presigned URLs. Default TTL is 50 minutes — comfortably below
// the AWS-style maximum of 1 hour for presigned GET URLs, leaving slack for hook
// execution and downstream Veo polling.
import { LRUCache } from 'lru-cache';

export interface PresignedUrlCacheOpts {
  maxItems: number;
  ttlMs: number;
  /** Optional clock override for testing (must have a non-zero epoch). */
  _perf?: { now: () => number };
}

export class PresignedUrlCache {
  private readonly inner: LRUCache<string, string>;

  constructor(opts: PresignedUrlCacheOpts) {
    this.inner = new LRUCache<string, string>({
      max: opts.maxItems,
      ttl: opts.ttlMs,
      // ttlResolution:0 ensures every get() re-evaluates the clock without debounce.
      ttlResolution: opts._perf ? 0 : 1,
      ...(opts._perf ? { perf: opts._perf } : {}),
    });
  }

  get(key: string): string | undefined {
    return this.inner.get(key);
  }

  set(key: string, value: string): void {
    this.inner.set(key, value);
  }

  /**
   * TTL-aware set: encodes ttlSeconds into the cache key so that the same
   * objectKey with different TTLs occupy independent slots. Use alongside
   * getWithTtl to avoid serving a URL minted with the wrong TTL.
   */
  setWithTtl(objectKey: string, ttlSeconds: number, url: string): void {
    this.inner.set(`${objectKey}|${ttlSeconds}`, url);
  }

  /**
   * TTL-aware get: retrieves the cached URL for the specific objectKey+TTL
   * combination. Returns undefined when no entry was stored for that TTL.
   */
  getWithTtl(objectKey: string, ttlSeconds: number): string | undefined {
    return this.inner.get(`${objectKey}|${ttlSeconds}`);
  }

  size(): number {
    return this.inner.size;
  }
}
