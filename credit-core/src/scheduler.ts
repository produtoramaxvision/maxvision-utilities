import { LOCK_NOT_ACQUIRED, type LockNotAcquired } from './redis-lock.js';

export interface SchedulerOpts {
  intervalMs: number;
  run: () => Promise<void>;
  withLock: <T>(key: string, ttlMs: number, fn: () => Promise<T>) => Promise<T | LockNotAcquired>;
  lockKey?: string; lockTtlMs?: number; logger?: (msg: string) => void;
}
export interface SchedulerHandle { stop: () => void }
/** Periodic caller. Anti-overlap (skip a tick while the previous run is in flight),
 *  error-isolated (a throwing run never stops the interval), multi-replica-safe
 *  (run wrapped in a Redis lock so only one replica sweeps). */
export function startSweepScheduler(opts: SchedulerOpts): SchedulerHandle {
  const log = opts.logger ?? (() => {});
  const lockKey = opts.lockKey ?? 'credit-core:sweep:lock';
  const lockTtlMs = opts.lockTtlMs ?? Math.max(opts.intervalMs * 5, 30_000);
  let inFlight = false;
  const tick = async () => {
    if (inFlight) { log('sweep: previous run still in flight, skipping tick'); return; }
    inFlight = true;
    try {
      const r = await opts.withLock(lockKey, lockTtlMs, opts.run);
      if (r === LOCK_NOT_ACQUIRED) log('sweep: lock held by another replica, skipped');
    } catch (err) { log(`sweep: run failed (isolated): ${(err as Error).message}`); }
    finally { inFlight = false; }
  };
  const handle = setInterval(() => { void tick(); }, opts.intervalMs);
  return { stop: () => clearInterval(handle) };
}
