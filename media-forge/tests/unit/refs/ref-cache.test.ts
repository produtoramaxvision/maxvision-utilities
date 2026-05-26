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
});
