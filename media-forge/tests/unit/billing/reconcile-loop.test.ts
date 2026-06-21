// tests/unit/billing/reconcile-loop.test.ts
// eng E1+E2: the hardened reconcile loop must LOG a throwing tick (not swallow it)
// and SKIP an overlapping tick while the previous one is still running.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startReconcileLoop } from '../../../src/billing/reconcile.js';

describe('startReconcileLoop hardening', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('logs (does not swallow) a throwing tick', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const store = {
      pendingGrants: vi.fn(async () => { throw new Error('boom'); }),
      markGranted: vi.fn(async () => {}),
      reconcileTiers: vi.fn(async () => 0),
    };
    const credit = { grant: vi.fn(async () => {}) };
    const stop = startReconcileLoop({ store, credit, logger } as never, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith(
      'reconcile loop tick failed',
      expect.objectContaining({ err: 'boom' }),
    );
    stop();
  });

  it('skips an overlapping tick while the previous is still running', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => { release = r; });
    const store = {
      pendingGrants: vi.fn(async () => { await slow; return []; }),
      markGranted: vi.fn(async () => {}),
      reconcileTiers: vi.fn(async () => 0),
    };
    const credit = { grant: vi.fn(async () => {}) };
    const stop = startReconcileLoop({ store, credit, logger } as never, 1000);

    await vi.advanceTimersByTimeAsync(1000); // tick 1 starts, blocks inside pendingGrants
    await vi.advanceTimersByTimeAsync(1000); // tick 2 fires while tick 1 still running → skipped

    expect(logger.warn).toHaveBeenCalledWith('reconcile tick skipped (previous still running)');
    expect(store.pendingGrants).toHaveBeenCalledTimes(1); // tick 2 never entered the body

    release();
    await vi.advanceTimersByTimeAsync(0); // let tick 1 settle
    stop();
  });

  it('logs corrected drift when reconcileTiers fixes tenants', async () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    const store = {
      pendingGrants: vi.fn(async () => []),
      markGranted: vi.fn(async () => {}),
      reconcileTiers: vi.fn(async () => 2),
    };
    const credit = { grant: vi.fn(async () => {}) };
    const stop = startReconcileLoop({ store, credit, logger } as never, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.warn).toHaveBeenCalledWith('tier reconcile corrected drift', { fixed: 2 });
    stop();
  });
});
