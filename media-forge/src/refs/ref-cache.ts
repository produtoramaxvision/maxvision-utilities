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
  /** Default TTL stored separately so per-entry setWithTtl can cap against it. */
  private readonly defaultTtlMs: number;

  constructor(opts: PresignedUrlCacheOpts) {
    this.defaultTtlMs = opts.ttlMs;
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
   * objectKey with different TTLs occupy independent slots. The lru-cache entry
   * lifetime is capped to min(defaultTtlMs, requestedTtlMs - safetyMargin) so
   * a short-lived presigned URL (e.g. ttlSeconds=60) never outlives its MinIO
   * validity window inside the cache. A 5-second safety margin guards against
   * clock skew and processing latency. Requests shorter than the safety margin
   * are not cached at all.
   */
  setWithTtl(objectKey: string, ttlSeconds: number, url: string): void {
    const compositeKey = `${objectKey}|${ttlSeconds}`;
    const safetyMarginMs = 5_000;
    const requestedTtlMs = Math.max(0, ttlSeconds * 1000 - safetyMarginMs);
    const entryTtlMs = Math.min(this.defaultTtlMs, requestedTtlMs);
    if (entryTtlMs <= 0) {
      // Requested TTL too short to cache safely — skip to avoid returning a dead URL.
      return;
    }
    this.inner.set(compositeKey, url, { ttl: entryTtlMs });
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
