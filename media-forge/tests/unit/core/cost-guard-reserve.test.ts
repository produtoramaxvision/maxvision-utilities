// tests/unit/core/cost-guard-reserve.test.ts
// T14 — the reviewer-retake budget reserve. Companion to cost-guard.test.ts,
// which is left untouched: this file adds coverage for reservePct /
// reserveMode / purpose without weakening or restating the pre-existing
// assertions (those are mirrored here only to prove nothing regressed).
//
// Numbers are chosen to be exactly representable in IEEE754 (multiples of
// 0.25, or derived from newWorkBudgetUsd) so a failure reflects the guard's
// `>` logic, not float rounding.
import { describe, it, expect } from 'vitest';
import {
  evaluateCostGuard,
  normalizeReservePct,
  newWorkBudgetUsd,
} from '../../../src/core/cost-guard.js';
import { loadConfig } from '../../../src/core/config.js';

const THRESHOLDS = {
  blockThresholdUsd: 2.0,
  dailyCapUsd: 25,
  confirmThresholdUsd: 0.5,
};

describe('T14 backward compatibility — no reservePct/reserveMode/purpose supplied', () => {
  // These mirror cost-guard.test.ts's own assertions line for line. If any of
  // these ever disagrees with that file, T14 broke a caller that never opted
  // into the reserve — the single worst regression this feature could cause.
  it('allows a small estimate with no prior spend', () => {
    const decision = evaluateCostGuard({ estimateUsd: 0.3, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('warns (does not block) when the estimate exceeds the confirm threshold', () => {
    const decision = evaluateCostGuard({ estimateUsd: 0.6, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision.action).toBe('warn');
  });

  it('blocks when the single-call estimate exceeds the hard block threshold', () => {
    const decision = evaluateCostGuard({ estimateUsd: 2.5, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
    }
  });

  it('blocks when spentToday + estimate exceeds the daily cap', () => {
    const decision = evaluateCostGuard({ estimateUsd: 1.0, spentTodayUsd: 24.5, ...THRESHOLDS });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('MEDIA_FORGE_DAILY_CAP_USD');
    }
  });

  it('the hard-block check runs BEFORE the daily-cap check (strictest first)', () => {
    const decision = evaluateCostGuard({ estimateUsd: 3.0, spentTodayUsd: 24, ...THRESHOLDS });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
    }
  });

  it('estimate exactly AT the block threshold is allowed through that check (falls to warn)', () => {
    const decision = evaluateCostGuard({ estimateUsd: 2.0, spentTodayUsd: 0, ...THRESHOLDS });
    expect(decision.action).toBe('warn');
  });

  it('spentToday + estimate exactly AT the daily cap is allowed (not blocked)', () => {
    const decision = evaluateCostGuard({ estimateUsd: 0.5, spentTodayUsd: 24.5, ...THRESHOLDS });
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

  it('a call with reservePct/reserveMode/purpose all omitted behaves identically to omitting them entirely (defaults are truly inert)', () => {
    // Same inputs as the "allowed at exact daily cap" case above, but this
    // time constructed with the T14 fields present-but-undefined, the shape
    // a TypeScript caller gets from an optional field that was never set.
    const decision = evaluateCostGuard({
      estimateUsd: 0.5,
      spentTodayUsd: 24.5,
      ...THRESHOLDS,
      reservePct: undefined,
      reserveMode: undefined,
      purpose: undefined,
    });
    expect(decision).toEqual({ action: 'allow' });
  });
});

describe('T14 default mode is "observe" and is inert', () => {
  it('reservePct set, mode omitted (defaults to observe): does not block or warn about the reserve even inside the reserved slice', () => {
    // budget = 25 * (1 - 0.1) = 22.5. projected = 22.25 + 0.5 = 22.75, which
    // IS inside the reserved slice — if 'observe' silently behaved like 'cap'
    // or 'warn', this would regress every install that has not opted in,
    // since reserveMode has no env default other than 'observe'.
    const decision = evaluateCostGuard({
      estimateUsd: 0.5,
      spentTodayUsd: 22.25,
      ...THRESHOLDS,
      reservePct: 0.1,
      purpose: 'new',
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('reservePct set, mode explicitly "observe": same as above', () => {
    const decision = evaluateCostGuard({
      estimateUsd: 0.5,
      spentTodayUsd: 22.25,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'observe',
      purpose: 'new',
    });
    expect(decision).toEqual({ action: 'allow' });
  });
});

describe('T14 mode "cap" — the core of the feature', () => {
  // budget = 25 * (1 - 0.1) = 22.5. spent 22.25 + estimate 0.5 = 22.75, which
  // is > budget but well under the full 25 daily cap. estimateUsd 0.5 is not
  // > the 0.5 confirm threshold, so an 'allow' result on the retake side is
  // unambiguously the reserve check passing through, not a lesser warn.
  const spentTodayUsd = 22.25;
  const estimateUsd = 0.5;

  it('purpose "new" over the reserve boundary is BLOCKED', () => {
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'cap',
      purpose: 'new',
    });
    expect(decision.action).toBe('block');
    if (decision.action === 'block') {
      expect(decision.reason).toContain('reserved for reviewer retakes');
      expect(decision.reason).toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
    }
  });

  it('the exact same numbers with purpose "retake" are ALLOWED — this is the whole point of the reserve', () => {
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'cap',
      purpose: 'retake',
    });
    // If this ever blocks, the reviewer cannot fix a bad take on a day the cap
    // is nearly spent — the exact failure T14 exists to prevent.
    expect(decision).toEqual({ action: 'allow' });
  });

  it('an un-labelled purpose (default "new") is treated as new work and is blocked', () => {
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'cap',
      // purpose omitted
    });
    expect(decision.action).toBe('block');
  });
});

describe('T14 mode "warn" — allow + surface the reserve, never block', () => {
  const spentTodayUsd = 22.25;
  const estimateUsd = 0.5;

  it('purpose "new" over the reserve boundary returns action "warn", not "block"', () => {
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'warn',
      purpose: 'new',
    });
    expect(decision.action).toBe('warn');
    if (decision.action === 'warn') {
      expect(decision.reason).toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      expect(decision.reason).toContain('proceeding');
    }
  });

  it('purpose "retake" over the same boundary is fully allowed (no warning at all)', () => {
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'warn',
      purpose: 'retake',
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('purpose "new" over BOTH the confirm threshold and the reserve boundary: the reserve reason wins (reserve check runs before the confirm check), action is still "warn" either way', () => {
    // estimateUsd 0.6 is > THRESHOLDS.confirmThresholdUsd (0.5) as well as
    // over the reserve boundary. Documents that the confirm-threshold warning
    // is swallowed by the reserve warning here — not a regression (both are
    // 'warn'), but pins the reason text a caller actually sees.
    const decision = evaluateCostGuard({
      estimateUsd: 0.6,
      spentTodayUsd,
      ...THRESHOLDS,
      reservePct: 0.1,
      reserveMode: 'warn',
      purpose: 'new',
    });
    expect(decision.action).toBe('warn');
    if (decision.action === 'warn') {
      expect(decision.reason).toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      expect(decision.reason).not.toContain('MEDIA_FORGE_CONFIRM_THRESHOLD_USD');
    }
  });
});

describe('T14 precedence — the hard per-call block and the hard daily cap win over the reserve, in every mode', () => {
  const modes = ['observe', 'warn', 'cap'] as const;

  for (const reserveMode of modes) {
    it(`mode "${reserveMode}": a spend over the FULL daily cap reports the daily-cap reason, not the reserve reason, even for purpose "retake"`, () => {
      // Same numbers as the pre-T14 daily-cap test: 24.5 spent + 1.0 estimate
      // = 25.5, over the full $25 cap. Reserve is NOT an escape hatch from the
      // cap: a retake that would blow the whole day's budget must still block.
      const decision = evaluateCostGuard({
        estimateUsd: 1.0,
        spentTodayUsd: 24.5,
        ...THRESHOLDS,
        reservePct: 0.1,
        reserveMode,
        purpose: 'retake',
      });
      expect(decision.action).toBe('block');
      if (decision.action === 'block') {
        expect(decision.reason).toContain('MEDIA_FORGE_DAILY_CAP_USD');
        expect(decision.reason).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      }
    });

    it(`mode "${reserveMode}": purpose "new" over the FULL daily cap ALSO reports the daily-cap reason, not the reserve reason`, () => {
      // The discriminating case: with purpose 'new' in mode 'cap', BOTH the
      // daily-cap check and the reserve check would fire on these numbers
      // (25.5 > 25 cap, and 25.5 > 22.5 reserve budget). Only by seeing the
      // daily-cap reason win here — not just on the 'retake' side, where the
      // reserve branch never runs at all — does this actually prove ordering
      // ("strictest first") rather than "reserve is skipped for retakes".
      const decision = evaluateCostGuard({
        estimateUsd: 1.0,
        spentTodayUsd: 24.5,
        ...THRESHOLDS,
        reservePct: 0.1,
        reserveMode,
        purpose: 'new',
      });
      expect(decision.action).toBe('block');
      if (decision.action === 'block') {
        expect(decision.reason).toContain('MEDIA_FORGE_DAILY_CAP_USD');
        expect(decision.reason).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      }
    });

    it(`mode "${reserveMode}": a per-call estimate over the hard block threshold reports the block reason, not the reserve reason`, () => {
      const decision = evaluateCostGuard({
        estimateUsd: 3.0,
        spentTodayUsd: 0,
        ...THRESHOLDS,
        reservePct: 0.1,
        reserveMode,
        purpose: 'retake',
      });
      expect(decision.action).toBe('block');
      if (decision.action === 'block') {
        expect(decision.reason).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
        expect(decision.reason).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      }
    });
  }
});

describe('T14 boundary arithmetic — strictly `>`, not `>=`', () => {
  // Derive the boundary from newWorkBudgetUsd itself rather than a hand-typed
  // literal, per the spec note: the two must never be able to drift apart.
  const dailyCapUsd = 25;
  const reservePct = 0.1;
  // Loosen confirm/block for this group so only the reserve branch is in play.
  const RESERVE_ONLY = { blockThresholdUsd: 10, dailyCapUsd, confirmThresholdUsd: 5 };
  const budget = newWorkBudgetUsd(dailyCapUsd, reservePct);
  const estimateUsd = 1;
  const spentTodayUsd = budget - estimateUsd; // sums to exactly `budget`

  it('projected total exactly AT the reserve boundary is ALLOWED (not >)', () => {
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      ...RESERVE_ONLY,
      reservePct,
      reserveMode: 'cap',
      purpose: 'new',
    });
    expect(decision).toEqual({ action: 'allow' });
  });

  it('projected total one cent over the reserve boundary is BLOCKED', () => {
    const decision = evaluateCostGuard({
      estimateUsd: estimateUsd + 0.01,
      spentTodayUsd,
      ...RESERVE_ONLY,
      reservePct,
      reserveMode: 'cap',
      purpose: 'new',
    });
    expect(decision.action).toBe('block');
  });
});

describe('normalizeReservePct', () => {
  it('undefined -> 0 (no reserve for a caller that never set it)', () => {
    expect(normalizeReservePct(undefined)).toBe(0);
  });

  it('NaN -> 0 (a corrupt/unparsed value must not silently reserve the whole cap or go negative)', () => {
    expect(normalizeReservePct(NaN)).toBe(0);
  });

  it('negative -> 0', () => {
    expect(normalizeReservePct(-0.5)).toBe(0);
  });

  it('>1 -> 1 (clamped, never overshoots into a negative available budget)', () => {
    expect(normalizeReservePct(1.5)).toBe(1);
  });

  it('0.1 -> 0.1 (a valid fraction passes through unchanged)', () => {
    expect(normalizeReservePct(0.1)).toBe(0.1);
  });

  it('the misconfiguration case: MEDIA_FORGE_BUDGET_RESERVE_PCT=90 (percentage typed instead of a fraction) clamps to 1, not a negative budget', () => {
    // newWorkBudgetUsd(dailyCap, 90) would be dailyCap * (1 - 90) = dailyCap * -89
    // without clamping — a large negative "available budget" that blocks every
    // generation with a nonsensical message instead of a bounded, sane one.
    expect(normalizeReservePct(90)).toBe(1);
  });
});

describe('T14 reservePct 0 disables the reserve entirely, even with mode "cap"', () => {
  it('a spend that would be well over the reserve boundary at pct 0.1 is not touched by the reserve when pct is 0', () => {
    // Same shape as the mode-"cap" block case above (spent near the cap,
    // estimate that would cross a 10% reserve) but with reservePct explicitly
    // 0 — the reserve branch must not fire at all, regardless of mode.
    const decision = evaluateCostGuard({
      estimateUsd: 0.9,
      spentTodayUsd: 24,
      ...THRESHOLDS,
      reservePct: 0,
      reserveMode: 'cap',
      purpose: 'new',
    });
    // 24 + 0.9 = 24.9, under the $25 cap; 0.9 > confirmThresholdUsd 0.5 so this
    // still warns — but it must be the confirm-threshold warning, not a
    // reserve warning/block, and it must never be 'block'.
    expect(decision.action).toBe('warn');
    if (decision.action === 'warn') {
      expect(decision.reason).not.toContain('MEDIA_FORGE_BUDGET_RESERVE_PCT');
      expect(decision.reason).toContain('MEDIA_FORGE_CONFIRM_THRESHOLD_USD');
    }
  });
});

describe('newWorkBudgetUsd', () => {
  it('25 with 0.1 -> 22.5', () => {
    expect(newWorkBudgetUsd(25, 0.1)).toBe(22.5);
  });

  it('25 with undefined -> 25 (no reserve configured, full cap is available to new work)', () => {
    expect(newWorkBudgetUsd(25, undefined)).toBe(25);
  });
});

describe('T14 config plumbing — MEDIA_FORGE_BUDGET_RESERVE_PCT / MEDIA_FORGE_BUDGET_RESERVE_MODE', () => {
  // loadConfig takes an env object as an argument rather than reading
  // process.env directly (see config.test.ts) — no process.env mutation or
  // afterEach restoration is needed here, matching that file's own pattern.
  const BASE_ENV = {
    GOOGLE_API_KEY: 'AIzaSyTEST',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
  };

  it('reads MEDIA_FORGE_BUDGET_RESERVE_PCT and MEDIA_FORGE_BUDGET_RESERVE_MODE through when set', () => {
    const c = loadConfig({
      ...BASE_ENV,
      MEDIA_FORGE_BUDGET_RESERVE_PCT: '0.15',
      MEDIA_FORGE_BUDGET_RESERVE_MODE: 'cap',
    });
    expect(c.budgetReservePct).toBe(0.15);
    expect(c.budgetReserveMode).toBe('cap');
  });

  it('unset gives the shipped defaults: 0.1 / "observe"', () => {
    const c = loadConfig({ ...BASE_ENV });
    // The mode default matters more than the pct default: 'observe' is what
    // keeps this a no-op for every install that upgrades without opting in.
    expect(c.budgetReservePct).toBe(0.1);
    expect(c.budgetReserveMode).toBe('observe');
  });

  it('an invalid MEDIA_FORGE_BUDGET_RESERVE_MODE string falls back to "observe" rather than throwing', () => {
    const c = loadConfig({
      ...BASE_ENV,
      MEDIA_FORGE_BUDGET_RESERVE_MODE: 'block-everything',
    });
    expect(c.budgetReserveMode).toBe('observe');
  });
});
