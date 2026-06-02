import { describe, it, expect, beforeEach } from 'vitest';
import IORedisMock from 'ioredis-mock';
import { RedisRateLimiter, NullRateLimiter } from '../../../src/http/rate-limiter.js';

describe('NullRateLimiter', () => {
  it('sempre permite', async () => {
    const lim = new NullRateLimiter();
    const r = await lim.check('tenant-x', 'pro');
    expect(r.allowed).toBe(true);
  });
});

describe('RedisRateLimiter', () => {
  let redis: InstanceType<typeof IORedisMock>;
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    redis = new IORedisMock();
    // limite baixo pra teste: 3 req/janela de 60s para tier 'free'
    limiter = new RedisRateLimiter(redis as never, { free: 3, creator: 120, pro: 600 }, 60);
  });

  it('permite até o limite', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await limiter.check('t1', 'free');
      expect(r.allowed, `request ${i + 1} deve ser permitida`).toBe(true);
    }
  });

  it('bloqueia após atingir o limite', async () => {
    for (let i = 0; i < 3; i++) await limiter.check('t1', 'free');
    const r = await limiter.check('t1', 'free');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it('tenants independentes não se afetam', async () => {
    for (let i = 0; i < 3; i++) await limiter.check('t1', 'free');
    const r = await limiter.check('t2', 'free'); // t2 ainda não usou
    expect(r.allowed).toBe(true);
  });

  it('creator tem limite maior que free', async () => {
    // 4 requests: passa para creator mas bloquearia free (limite=3)
    for (let i = 0; i < 4; i++) await limiter.check('t3', 'creator');
    const r = await limiter.check('t3', 'creator');
    expect(r.allowed).toBe(true); // creator tem 120, não 3
  });
});
