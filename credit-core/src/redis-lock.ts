import type { Redis } from 'ioredis';
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
/** SET NX PX mutual exclusion across replicas. Runs fn only if THIS instance won the
 *  lock; returns undefined (skipped) otherwise. Releases via check-and-del Lua so we
 *  never delete a lock another replica acquired after our TTL expired. */
export function makeRedisLock(redis: Redis) {
  return async function withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const token = `${process.pid}-${process.hrtime.bigint()}`;
    const got = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (got !== 'OK') return undefined;
    try { return await fn(); }
    finally { await redis.eval(RELEASE, 1, key, token).catch(() => {}); }
  };
}
