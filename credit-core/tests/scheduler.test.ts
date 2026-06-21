import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startSweepScheduler } from '../src/scheduler.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const okLock = async <T>(_k: string, _ttl: number, fn: () => Promise<T>) => fn();

describe('startSweepScheduler', () => {
  it('runs on interval; anti-overlap keeps maxActive at 1', async () => {
    let active = 0; let maxActive = 0;
    const run = async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 50)); active--; };
    const h = startSweepScheduler({ intervalMs: 10, run, withLock: okLock, logger: () => {} });
    await vi.advanceTimersByTimeAsync(35);
    expect(maxActive).toBe(1);
    h.stop();
  });

  it('a throwing run does not stop the scheduler', async () => {
    let runs = 0;
    const h = startSweepScheduler({ intervalMs: 10, run: async () => { runs++; throw new Error('boom'); }, withLock: okLock, logger: () => {} });
    await vi.advanceTimersByTimeAsync(35);
    expect(runs).toBeGreaterThanOrEqual(3);
    h.stop();
  });

  it('stop() halts further runs', async () => {
    let runs = 0;
    const h = startSweepScheduler({ intervalMs: 10, run: async () => { runs++; }, withLock: okLock, logger: () => {} });
    await vi.advanceTimersByTimeAsync(15);
    const after = runs; h.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(after);
  });

  it('lock held by another replica (withLock returns undefined) prevents run', async () => {
    let runs = 0;
    const skipLock = (async () => undefined) as never;
    const h = startSweepScheduler({ intervalMs: 10, run: async () => { runs++; }, withLock: skipLock, logger: () => {} });
    await vi.advanceTimersByTimeAsync(35);
    expect(runs).toBe(0);
    h.stop();
  });
});
