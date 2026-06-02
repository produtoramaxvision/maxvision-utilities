// media-forge/src/http/rate-limiter.ts
// Rate-limit por tenant: fixed-window INCR+EXPIRE via ioredis.
// NullRateLimiter: no-op para self-host sem Redis e para testes.
import Redis from 'ioredis';
import type { Tier } from './auth.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec?: number; // presente apenas quando allowed=false
}

export interface RateLimiter {
  check(tenantId: string, tier: Tier): Promise<RateLimitResult>;
}

export type TierLimits = Record<Tier, number>; // req por janela

const DEFAULT_LIMITS: TierLimits = { free: 20, creator: 120, pro: 600 };
const DEFAULT_WINDOW_SEC = 60;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private redis: InstanceType<typeof Redis>,
    private limits: TierLimits = DEFAULT_LIMITS,
    private windowSec: number = DEFAULT_WINDOW_SEC,
  ) {}

  async check(tenantId: string, tier: Tier): Promise<RateLimitResult> {
    const limit = this.limits[tier];
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / this.windowSec) * this.windowSec;
    const key = `rl:${tenantId}:${windowStart}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      // Primeira requisicao da janela -- define TTL para expirar automaticamente
      await this.redis.expire(key, this.windowSec + 1);
    }

    if (count > limit) {
      const retryAfterSec = windowStart + this.windowSec - now;
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    return { allowed: true };
  }
}

/** No-op: usado em self-host (sem Redis) e em testes unitarios de auth/app. */
export class NullRateLimiter implements RateLimiter {
  async check(_tenantId: string, _tier: Tier): Promise<RateLimitResult> {
    return { allowed: true };
  }
}

/** Factory: retorna RedisRateLimiter se REDIS_URL presente, NullRateLimiter caso contrario. */
export function createRateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  const url = env['REDIS_URL'];
  if (!url) return new NullRateLimiter();
  return new RedisRateLimiter(new Redis(url));
}
