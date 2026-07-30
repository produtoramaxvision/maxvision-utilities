// tests/unit/review/retake-protocol.test.ts
// T11 — Retake Protocol.
//
// router.test.ts already covers per-class fixTargetAgent/fixDirective routing
// (10 of 11 classes) and the pre-T11 escalate/accept/env-override rules. This
// file is additive: it covers the T11 surface only — triage, changedVariable,
// spendsCredit, the retake budget, and the one-variable-per-retake refusal —
// without repeating or weakening anything router.test.ts already asserts.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import {
  route,
  TRIAGE_ACTIONS,
  triageSpendsCredit,
  spendPurposeFor,
  buildRetakeBudget,
  checkRetakeVariable,
  type TriageAction,
  type RetakeVariable,
  type RouteDecision,
} from '../../../src/review/router.js';
import type { JudgeVerdict, JudgeError } from '../../../src/review/llm-judge.js';
import { TakeReview, type TakeReviewT } from '../../../src/review/take-review.js';
import { recordLineage, readLineage } from '../../../src/trace/lineage.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    verdict: 'fail',
    scores: { adherence: 5, quality: 5, alignment: 5, safety: 8, overall: 5 },
    rootCauseStage: 'prompt-engineer',
    errors: [],
    ...overrides,
  };
}

function makeError(
  cls: JudgeError['class'],
  severity: JudgeError['severity'] = 'major',
): JudgeError {
  return { class: cls, severity, detail: `test error for ${cls}` };
}

function makeTakeReview(overrides: Partial<TakeReviewT> = {}): TakeReviewT {
  return {
    project_id: 'proj-1',
    clip_id: 'clip-1',
    take_id: 'take-1',
    source_status: 'generated',
    verdict: 'accept',
    observed_start_state: {},
    observed_end_state: {},
    completed_beats: ['beat-a'],
    incomplete_beats: [],
    unexpected_completed_beats: [],
    continuity_breaks: [],
    accepted_deviations: [],
    observation_confidence: 'high',
    uncertainties: [],
    requires_user_confirmation: false,
    ...overrides,
  };
}

// All 11 error classes the routing table must cover. Kept as a literal array
// (not derived from the table) so a class the table forgets to register is
// still iterated here and fails loudly, rather than silently shrinking the
// coverage to whatever the table happens to contain.
const ERROR_CLASSES: JudgeError['class'][] = [
  'text_typo',
  'brand_violation_color',
  'brand_violation_logo',
  'brand_violation_font',
  'semantic_object_wrong',
  'semantic_color_wrong',
  'composition_wrong',
  'temporal_drift',
  'safety_blocked',
  'lipsync_miss',
  'ref_match_low',
];

// ---------------------------------------------------------------------------
// 1. Every routing-table class yields a triage + changedVariable
// ---------------------------------------------------------------------------

describe('every routing-table class produces a triage and a changedVariable', () => {
  for (const cls of ERROR_CLASSES) {
    it(`${cls} → retry with non-null changedVariable and a valid triage`, () => {
      const decision = route({
        verdict: makeVerdict({ errors: [makeError(cls)] }),
        attemptCount: 0,
        originalGeneratorAgent: 'media-forge:image-generator',
      });
      // This is the test that catches a future class added to ROUTING_TABLE
      // without wiring up its retry triage: an entry present in the table but
      // missing `triage`/`changedVariable` would fail here, not silently ship.
      expect(decision.action).toBe('retry');
      expect(decision.changedVariable).not.toBeNull();
      expect(TRIAGE_ACTIONS).toContain(decision.triage);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. triageSpendsCredit
// ---------------------------------------------------------------------------

describe('triageSpendsCredit', () => {
  // Iterated over TRIAGE_ACTIONS (not a hand-picked subset) so a new triage
  // action added to the exported tuple forces a decision here instead of
  // silently defaulting to whatever the `||` chain falls through to.
  const expected: Record<TriageAction, boolean> = {
    keep: false,
    'fix-in-post': false,
    edit: true,
    're-roll': true,
    rewrite: true,
  };

  for (const action of TRIAGE_ACTIONS) {
    it(`${action} → spendsCredit ${expected[action]}`, () => {
      expect(triageSpendsCredit(action)).toBe(expected[action]);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. spendPurposeFor
// ---------------------------------------------------------------------------

describe('spendPurposeFor', () => {
  const expected: Record<TriageAction, 'new' | 'retake'> = {
    keep: 'new',
    'fix-in-post': 'new',
    edit: 'retake',
    're-roll': 'retake',
    rewrite: 'retake',
  };

  for (const triage of TRIAGE_ACTIONS) {
    it(`triage "${triage}" → spend purpose "${expected[triage]}"`, () => {
      expect(spendPurposeFor({ triage })).toBe(expected[triage]);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Non-generating triage must not spend (the discriminating test)
// ---------------------------------------------------------------------------

describe('non-generating triage never spends and never claims the retake reserve', () => {
  // Constructed directly rather than through route(): the routing table never
  // emits 'fix-in-post' (nothing in ROUTING_TABLE maps to it today), but the
  // billing boundary must still treat it as free if a future entry ever does.
  const nonGenerating: TriageAction[] = ['keep', 'fix-in-post'];

  for (const triage of nonGenerating) {
    it(`triage "${triage}": spendsCredit is false and spendPurposeFor is "new"`, () => {
      expect(triageSpendsCredit(triage)).toBe(false);
      // 'new' rather than 'retake' matters here: 'retake' would let this
      // triage draw on the reserved slice of the daily cap it never earns,
      // because nothing was actually generated.
      expect(spendPurposeFor({ triage })).toBe('new');
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Every escalate path sets triage 'keep' / changedVariable null / spendsCredit false
// ---------------------------------------------------------------------------

describe('every escalate path reports a non-spending triage', () => {
  function assertNonSpendingEscalate(decision: RouteDecision): void {
    expect(decision.action).toBe('escalate');
    expect(decision.triage).toBe('keep');
    expect(decision.changedVariable).toBeNull();
    expect(decision.spendsCredit).toBe(false);
  }

  it('max attempts reached', () => {
    const decision = route({
      verdict: makeVerdict({ errors: [makeError('text_typo')] }),
      attemptCount: 3,
      maxAttempts: 3,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    assertNonSpendingEscalate(decision);
  });

  it('same root cause repeated', () => {
    const decision = route({
      verdict: makeVerdict({
        rootCauseStage: 'prompt-engineer',
        errors: [makeError('semantic_object_wrong')],
      }),
      attemptCount: 1,
      previousRootCause: 'prompt-engineer',
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    assertNonSpendingEscalate(decision);
  });

  it('fail verdict with no errors', () => {
    const decision = route({
      verdict: makeVerdict({ verdict: 'fail', errors: [] }),
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    assertNonSpendingEscalate(decision);
  });

  it('unknown error class', () => {
    const decision = route({
      verdict: makeVerdict({ errors: [makeError('made_up_class' as JudgeError['class'])] }),
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    assertNonSpendingEscalate(decision);
  });

  it('variable already changed on an earlier attempt', () => {
    // semantic_object_wrong's changedVariable is 'prompt' (see ROUTING_TABLE).
    // Reporting a spending triage here would let a job that just got handed
    // off to escalation ALSO bill for the attempt that triggered the handoff.
    const decision = route({
      verdict: makeVerdict({ errors: [makeError('semantic_object_wrong')] }),
      attemptCount: 1,
      originalGeneratorAgent: 'media-forge:image-generator',
      variablesAlreadyChanged: ['prompt'],
    });
    assertNonSpendingEscalate(decision);
  });
});

// ---------------------------------------------------------------------------
// 6. checkRetakeVariable
// ---------------------------------------------------------------------------

describe('checkRetakeVariable', () => {
  const budget = buildRetakeBudget({
    maxAttempts: 3,
    attemptsUsed: 1,
    paidAttemptsUsed: 1,
    variablesAlreadyChanged: ['prompt'],
  });

  it('null is always allowed — nothing is being retried', () => {
    expect(checkRetakeVariable(budget, null)).toEqual({ allowed: true });
  });

  it('a variable not yet used is allowed', () => {
    expect(checkRetakeVariable(budget, 'seed')).toEqual({ allowed: true });
  });

  it('a variable already changed is refused with a reason naming it', () => {
    const result = checkRetakeVariable(budget, 'prompt');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('prompt');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. route() refuses a repeat of an already-changed variable
// ---------------------------------------------------------------------------

describe('route() enforces one-variable-per-retake via history', () => {
  // semantic_object_wrong routes to changedVariable 'prompt' (ROUTING_TABLE).
  function routeSemanticObjectWrong(variablesAlreadyChanged?: RetakeVariable[]) {
    return route({
      verdict: makeVerdict({ errors: [makeError('semantic_object_wrong')] }),
      attemptCount: 1,
      originalGeneratorAgent: 'media-forge:image-generator',
      ...(variablesAlreadyChanged
        ? { variablesAlreadyChanged: variablesAlreadyChanged as Exclude<RetakeVariable, null>[] }
        : {}),
    });
  }

  it('WITH "prompt" already in variablesAlreadyChanged → escalate, reason mentions the variable', () => {
    const decision = routeSemanticObjectWrong(['prompt']);
    expect(decision.action).toBe('escalate');
    expect(decision.reason).toContain('prompt');
  });

  it('WITHOUT variablesAlreadyChanged → retry (proves the refusal above was caused by history, not the class)', () => {
    const decision = routeSemanticObjectWrong(undefined);
    expect(decision.action).toBe('retry');
    expect(decision.changedVariable).toBe('prompt');
  });
});

// ---------------------------------------------------------------------------
// 8. buildRetakeBudget
// ---------------------------------------------------------------------------

describe('buildRetakeBudget', () => {
  it('attemptsRemaining never goes negative when attemptsUsed exceeds the total cap', () => {
    // attemptsRemaining counts against maxTotalAttempts (default maxAttempts*2),
    // not maxAttempts. The two caps mean different things: maxAttempts is the
    // PAID budget (the cost control), maxTotalAttempts is a non-termination
    // backstop that free triage also consumes.
    // 3 paid -> 6 total; 7 used is past it, so the floor at 0 applies.
    const budget = buildRetakeBudget({ maxAttempts: 3, attemptsUsed: 7, paidAttemptsUsed: 5 });
    expect(budget.attemptsRemaining).toBe(0);
  });

  it('paidAttemptsRemaining never goes negative when paidAttemptsUsed exceeds maxAttempts', () => {
    const budget = buildRetakeBudget({ maxAttempts: 3, attemptsUsed: 5, paidAttemptsUsed: 5 });
    expect(budget.paidAttemptsRemaining).toBe(0);
  });

  it('paidAttemptsUsed lower than attemptsUsed leaves MORE paid budget than total remaining', () => {
    // Two attempts were used, but only one of them actually spent (the other
    // was a free 'fix-in-post'/'keep' triage). Free triage must not consume
    // paid budget — this is the entire point of tracking the two separately
    // instead of a single attempt counter.
    //
    // Corrected with the T11 two-cap fix. The earlier expectation
    // (attemptsRemaining 1, derived from maxAttempts) encoded the very bug this
    // separation exists to remove: with a single shared cap, the total gate
    // always binds before the paid gate and the paid budget can never actually
    // be the operative limit. maxAttempts 3 -> maxTotalAttempts 6.
    const budget = buildRetakeBudget({ maxAttempts: 3, attemptsUsed: 2, paidAttemptsUsed: 1 });
    expect(budget.maxTotalAttempts).toBe(6);
    expect(budget.attemptsRemaining).toBe(4); // 6 - 2
    expect(budget.paidAttemptsRemaining).toBe(2); // 3 - 1
  });

  it('a job that spends every attempt on free triage keeps its full paid allowance', () => {
    // The concrete case the split exists for: three fix-in-post passes must not
    // eat the credit allowance for generations that never happened.
    const budget = buildRetakeBudget({ maxAttempts: 3, attemptsUsed: 3, paidAttemptsUsed: 0 });
    expect(budget.paidAttemptsRemaining).toBe(3);
    expect(budget.attemptsRemaining).toBeGreaterThan(0);
  });

  it('an explicit maxTotalAttempts overrides the derived default', () => {
    const budget = buildRetakeBudget({
      maxAttempts: 3,
      maxTotalAttempts: 4,
      attemptsUsed: 1,
      paidAttemptsUsed: 1,
    });
    expect(budget.maxTotalAttempts).toBe(4);
    expect(budget.attemptsRemaining).toBe(3);
  });

  it('variablesAlreadyChanged defaults to [] when omitted', () => {
    const budget = buildRetakeBudget({ maxAttempts: 3, attemptsUsed: 0, paidAttemptsUsed: 0 });
    expect(budget.variablesAlreadyChanged).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. paidAttemptsUsed defaults to attemptCount when omitted from RouteOpts
// ---------------------------------------------------------------------------

describe('paidAttemptsUsed default (RouteOpts contract)', () => {
  // route() does not leak its internal RetakeBudget through RouteDecision —
  // checkRetakeVariable only reads variablesAlreadyChanged, never
  // paidAttemptsRemaining — so this default cannot be observed through
  // route()'s return value today. It is pinned directly against
  // buildRetakeBudget instead, mirroring the exact expression router.ts uses
  // (`opts.paidAttemptsUsed ?? opts.attemptCount`): the pessimistic default
  // that assumes every past attempt was paid, so it never over-grants paid
  // budget to a caller that has not started tracking paid vs. free attempts.
  it('omitting paidAttemptsUsed is equivalent to passing paidAttemptsUsed = attemptCount', () => {
    const attemptCount = 2;
    const paidAttemptsUsedOmitted = undefined as number | undefined;

    const budgetWithDefault = buildRetakeBudget({
      maxAttempts: 5,
      attemptsUsed: attemptCount,
      paidAttemptsUsed: paidAttemptsUsedOmitted ?? attemptCount,
    });
    const budgetExplicit = buildRetakeBudget({
      maxAttempts: 5,
      attemptsUsed: attemptCount,
      paidAttemptsUsed: attemptCount,
    });

    expect(budgetWithDefault).toEqual(budgetExplicit);
    // The two remaining counts are NOT equal even when paid == total used,
    // because they are measured against different caps: paid against maxAttempts
    // (5 - 2 = 3), total against maxTotalAttempts (10 - 2 = 8). Asserting they
    // match would re-encode the single-cap bug.
    expect(budgetWithDefault.paidAttemptsRemaining).toBe(3);
    expect(budgetWithDefault.attemptsRemaining).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 10. Backward compatibility
// ---------------------------------------------------------------------------

describe('backward compatibility with pre-T11 callers', () => {
  it('a route() call with only pre-T11 fields still returns a well-formed decision', () => {
    // No variablesAlreadyChanged, no paidAttemptsUsed — exactly what every
    // caller written before T11 passes.
    const decision = route({
      verdict: makeVerdict({ errors: [makeError('text_typo')] }),
      attemptCount: 0,
      originalGeneratorAgent: 'media-forge:image-generator',
    });
    expect(decision.action).toBe('retry');
    expect(decision.fixTargetAgent).toBeDefined();
    expect(decision.fixDirective).toBeDefined();
    expect(typeof decision.reason).toBe('string');
    expect(typeof decision.attemptCount).toBe('number');
    expect(typeof decision.remainingBudget).toBe('number');
    // T11 fields must still be present and well-typed even when the caller
    // never mentioned them.
    expect(TRIAGE_ACTIONS).toContain(decision.triage);
    expect(typeof decision.spendsCredit).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// 11. take-review round-trip
// ---------------------------------------------------------------------------

describe('TakeReview T11 fields round-trip', () => {
  it('a review WITHOUT retake_triage/retake_variable still parses (pre-T11 reviews stay readable)', () => {
    expect(() => TakeReview.parse(makeTakeReview())).not.toThrow();
  });

  it('a review WITH valid retake_triage/retake_variable parses', () => {
    const review = makeTakeReview({
      verdict: 'repair',
      retake_triage: 're-roll',
      retake_variable: 'seed',
    });
    const parsed = TakeReview.parse(review);
    expect(parsed.retake_triage).toBe('re-roll');
    expect(parsed.retake_variable).toBe('seed');
  });

  it('an invalid retake_variable is rejected', () => {
    const review = {
      ...makeTakeReview({ verdict: 'repair' }),
      retake_variable: 'made-up-variable',
    };
    expect(() => TakeReview.parse(review)).toThrow();
  });

  it('retake_variable: null is accepted (nothing is being retried)', () => {
    const review = makeTakeReview({ verdict: 'accept', retake_variable: null });
    const parsed = TakeReview.parse(review);
    expect(parsed.retake_variable).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. lineage round-trip
// ---------------------------------------------------------------------------

describe('LineageEntry T11 fields round-trip', () => {
  let tmpDir: string;
  let jobDir: string;

  function setup(): void {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-retake-lineage-'));
    jobDir = join(tmpDir, 'job-1');
    fs.mkdirSync(jobDir, { recursive: true });
  }

  function teardown(): void {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — appendFile may still hold a handle at cleanup time;
      // the OS reclaims the temp dir on its own.
    }
  }

  it('recordLineage WITHOUT triage/changedVariable writes an entry with NEITHER key present', async () => {
    setup();
    try {
      await recordLineage({
        jobDir,
        attempt: 1,
        rootCause: 'pre-T11 caller',
        fixTargetAgent: 'agent-a',
        fixDirective: 'fix it',
        verdict: 'fail',
      });
      const [entry] = await readLineage({ jobDir });
      expect(entry).toBeDefined();
      // LineageEntry is .strict(): a key present-but-undefined is a different
      // record shape than a key genuinely absent, and JSON.stringify would
      // drop an explicit `undefined` anyway — assert absence directly rather
      // than via `=== undefined`, which is also true for "present as null".
      expect('triage' in entry!).toBe(false);
      expect('changedVariable' in entry!).toBe(false);
    } finally {
      teardown();
    }
  });

  it('recordLineage WITH triage/changedVariable round-trips through readLineage', async () => {
    setup();
    try {
      await recordLineage({
        jobDir,
        attempt: 1,
        rootCause: 'semantic_object_wrong',
        fixTargetAgent: 'media-forge:prompt-engineer',
        fixDirective: 'rewrite prompt',
        verdict: 'fail',
        triage: 'rewrite',
        changedVariable: 'prompt',
      });
      const [entry] = await readLineage({ jobDir });
      expect(entry).toBeDefined();
      expect(entry!.triage).toBe('rewrite');
      expect(entry!.changedVariable).toBe('prompt');
    } finally {
      teardown();
    }
  });
});
