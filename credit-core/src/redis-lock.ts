import type { Redis } from 'ioredis';
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** Returned when another replica holds the lock, so "did not run" stays distinguishable
 *  from "ran and returned nothing". Signalling the skip with undefined made every
 *  successful sweep look skipped: the scheduler's run is `() => Promise<void>`, so its
 *  own resolution value is undefined too. */
export const LOCK_NOT_ACQUIRED: unique symbol = Symbol('credit-core:lock-not-acquired');
export type LockNotAcquired = typeof LOCK_NOT_ACQUIRED;

/** SET NX PX mutual exclusion across replicas. Runs fn only if THIS instance won the
 *  lock; returns LOCK_NOT_ACQUIRED otherwise. Releases via check-and-del Lua so we
 *  never delete a lock another replica acquired after our TTL expired. */
export function makeRedisLock(redis: Redis) {
  return async function withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | LockNotAcquired> {
    const token = `${process.pid}-${process.hrtime.bigint()}`;
    const got = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (got !== 'OK') return LOCK_NOT_ACQUIRED;
    try { return await fn(); }
    finally { await redis.eval(RELEASE, 1, key, token).catch(() => {}); }
  };
}
