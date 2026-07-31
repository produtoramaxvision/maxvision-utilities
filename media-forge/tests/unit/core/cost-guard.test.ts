// tests/unit/core/cost-guard.test.ts
// TDD for evaluateCostGuard (media-forge cost guards). Pure function, no I/O —
// every case below constructs GuardInput directly. Boundary cases use values
// that are exactly representable in IEEE754 (multiples of 0.5) so a failure
// reflects the guard's `>` logic, not a float-rounding artifact.
import { describe, it, expect } from 'vitest';
import { evaluateCostGuard } from '../../../src/core/cost-guard.js';

const THRESHOLDS = {
  blockThresholdUsd: 2.0,
  dailyCapUsd: 25,
  confirmThresholdUsd: 0.5,
};

describe('evaluateCostGuard', () => {
  it('allows a small estimate with no prior spend', () => {
    const decision = evaluateCostGuard({ estimateUsd: 0.3, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('warns (does not block) when the estimate exceeds the confirm threshold', () => {
    const decision = evaluateCostGuard({ estimateUsd: 0.6, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision.action).toBe('warn');
    if (decision.action === 'warn') {
      expect(decision.reason).toContain('0.60');
      expect(decision.reason).toContain('0.50');
      expect(decision.reason).toContain('MEDIA_FORGE_CONFIRM_THRESHOLD_USD');
    }
  });

  it('blocks when the single-call estimate exceeds the hard block threshold', () => {
    const decision = evaluateCostGuard({ estimateUsd: 2.5, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('2.50');
      expect(decision.reason).toContain('2.00');
      expect(decision.reason).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
    }
  });

  it('blocks when spentToday + estimate exceeds the daily cap, even though the estimate alone is under the block threshold', () => {
    const decision = evaluateCostGuard({ estimateUsd: 1.0, spentTodayUsd: 24.5, ...THRESHOLDS });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('24.50');
      expect(decision.reason).toContain('1.00');
      expect(decision.reason).toContain('25.50');
      expect(decision.reason).toContain('25.00');
      expect(decision.reason).toContain('MEDIA_FORGE_DAILY_CAP_USD');
    }
  });

  it('the hard-block check runs BEFORE the daily-cap check (strictest first)', () => {
    // estimate alone already exceeds blockThreshold — must report the block
    // reason, not the daily-cap reason, even though both would technically fire.
    const decision = evaluateCostGuard({ estimateUsd: 3.0, spentTodayUsd: 24, ...THRESHOLDS });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
    }
  });

  describe('exact-boundary cases (strictly `>`, not `>=`)', () => {
    it('estimate exactly AT the block threshold is allowed through that check (falls to warn)', () => {
      const decision = evaluateCostGuard({ estimateUsd: 2.0, spentTodayUsd: 0, ...THRESHOLDS });
      // 2.0 is not > 2.0 (block threshold) and not > 25 (daily cap alone), but
      // IS > 0.5 (confirm threshold) — so it warns, it does not block.
      expect(decision.action).toBe('warn');
    });

    it('spentToday + estimate exactly AT the daily cap is allowed (not blocked)', () => {
      const decision = evaluateCostGuard({ estimateUsd: 0.5, spentTodayUsd: 24.5, ...THRESHOLDS });
      // 24.5 + 0.5 = 25.0, not > 25 — daily cap does not fire.
      // estimateUsd 0.5 is not > confirmThresholdUsd 0.5 either — fully allowed.
      expect(decision).toEqual({ action: 'allow' });
    });

    it('estimate exactly AT the confirm threshold is allowed (no warning)', () => {
      const decision = evaluateCostGuard({ estimateUsd: 0.5, spentTodayUsd: 0, ...THRESHOLDS });
      expect(decision).toEqual({ action: 'allow' });
    });

    it('estimate one cent above the block threshold blocks', () => {
      const decision = evaluateCostGuard({ estimateUsd: 2.01, spentTodayUsd: 0, ...THRESHOLDS });
      expect(decision.action).toBe('block');
    });

    it('spentToday + estimate one cent above the daily cap blocks', () => {
      const decision = evaluateCostGuard({ estimateUsd: 0.51, spentTodayUsd: 24.5, ...THRESHOLDS });
      expect(decision.action).toBe('block');
    });
  });
});
