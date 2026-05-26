import { describe, it, expect } from 'vitest';
import { PresignedUrlCache } from '../../../src/refs/ref-cache.js';

describe('PresignedUrlCache', () => {
  it('returns cached value within TTL', () => {
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: 60_000 });
    cache.set('foo/bar.gif', 'https://signed.example/foo');
    expect(cache.get('foo/bar.gif')).toBe('https://signed.example/foo');
  });

  it('returns undefined after TTL expires', () => {
    // lru-cache v11 uses performance.now() which vitest fake timers do not intercept.
    // Use the _perf injection point with a manual monotonic clock instead.
    let now = 1_000; // non-zero start (lru-cache treats start=0 as "no TTL")
    const fakeClock = { now: () => now };
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: 1000, _perf: fakeClock });
    cache.set('foo/bar.gif', 'https://signed.example/foo');
    now += 1500; // advance past TTL
    expect(cache.get('foo/bar.gif')).toBeUndefined();
  });

  it('evicts LRU when over capacity', () => {
    const cache = new PresignedUrlCache({ maxItems: 2, ttlMs: 60_000 });
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('url-b');
    expect(cache.get('c')).toBe('url-c');
  });

  // --- TTL-aware composite key tests (Finding 1) ---

  it('different TTL = different cache slot', () => {
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: 60_000 });
    cache.setWithTtl('refs/a.gif', 600, 'https://signed.example/short-lived');
    // Same object key, different TTL — must NOT hit the slot set above
    expect(cache.getWithTtl('refs/a.gif', 3000)).toBeUndefined();
  });

  it('same key + same TTL hits TTL-aware cache slot', () => {
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: 60_000 });
    cache.setWithTtl('refs/a.gif', 600, 'https://signed.example/short-lived');
    expect(cache.getWithTtl('refs/a.gif', 600)).toBe('https://signed.example/short-lived');
  });

  // --- Finding 3: per-entry TTL bound tests ---

  it('short-TTL request creates entry that expires before default 50min TTL', () => {
    // Use the _perf injection so lru-cache v11 honours the fake clock.
    let now = 1_000; // non-zero start required by lru-cache
    const fakeClock = { now: () => now };
    const defaultTtlMs = 50 * 60 * 1000; // 50 min
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: defaultTtlMs, _perf: fakeClock });

    // 60-second presigned URL: entry TTL = 60000ms - 5000ms margin = 55000ms
    cache.setWithTtl('refs/short.gif', 60, 'https://signed.example/short');
    expect(cache.getWithTtl('refs/short.gif', 60)).toBe('https://signed.example/short');

    // Advance 56 seconds — beyond the 55s entry TTL, well before default 50min
    now += 56_000;
    expect(cache.getWithTtl('refs/short.gif', 60)).toBeUndefined();
  });

  it('does not cache entries with TTL at or below safety margin (5 s)', () => {
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: 50 * 60 * 1000 });
    // 5-second request: 5000ms - 5000ms = 0 → skip cache
    cache.setWithTtl('refs/tooshort.gif', 5, 'https://signed.example/tooshort');
    expect(cache.getWithTtl('refs/tooshort.gif', 5)).toBeUndefined();
  });

  it('caps entry TTL at defaultTtlMs for very long requests', () => {
    let now = 1_000;
    const fakeClock = { now: () => now };
    const defaultTtlMs = 5_000; // 5s default for test isolation
    const cache = new PresignedUrlCache({ maxItems: 10, ttlMs: defaultTtlMs, _perf: fakeClock });

    // 1-hour request: would be 3600000-5000=3595000ms, but capped at 5000ms default
    cache.setWithTtl('refs/long.gif', 3600, 'https://signed.example/long');
    expect(cache.getWithTtl('refs/long.gif', 3600)).toBe('https://signed.example/long');

    // Advance 5001ms — should be expired (capped at defaultTtlMs=5000ms)
    now += 5_001;
    expect(cache.getWithTtl('refs/long.gif', 3600)).toBeUndefined();
  });
});
