import type { JudgeVerdict, JudgeError } from './llm-judge.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Routing table (per spec §5.3, 10 classes)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// T11 — Retake Protocol
// ---------------------------------------------------------------------------
//
// The router already picked the right FIX AGENT per root cause. What it did not
// say is how expensive the fix is, or what the retake is allowed to change.
// Those are the two things that make a retry loop either converge or burn credit
// repeating the same mistake.
//
// Triage answers the first. The five outcomes are ordered by cost, cheapest
// first, and the first two spend nothing at all:
//
//   keep         accept as-is. No generation.
//   fix-in-post  fixable downstream (crop, colour, overlay). No generation.
//   edit         targeted edit of the SAME asset. Cheaper than regenerating and
//                keeps everything the reviewer already accepted.
//   re-roll      same prompt, new sample. For non-deterministic misses where the
//                prompt was right and the draw was unlucky.
//   rewrite      the prompt itself was wrong. New prompt, new generation.
//
// `changedVariable` answers the second, and is the "one variable per retake"
// discipline from the plan. A retake that changes the prompt AND the seed AND the
// reference set teaches nothing: when it fails you cannot tell which change was
// wrong, and when it succeeds you cannot tell which change was right. Recording
// exactly one variable per attempt is what turns a retry loop into a bisection.

/** Ordered cheapest-first. The first two never reach a provider. */
export const TRIAGE_ACTIONS = ['keep', 'fix-in-post', 'edit', 're-roll', 'rewrite'] as const;

export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

/**
 * The single variable a retake is permitted to change. `null` accompanies the
 * non-generating triage outcomes, where nothing is being retried.
 */
export type RetakeVariable =
  | 'prompt'
  | 'negative-prompt'
  | 'seed'
  | 'reference-set'
  | 'model'
  | 'duration'
  | 'post-processing'
  | null;

/**
 * True when the triage outcome results in a paid provider call.
 *
 * Exported and used at the billing boundary rather than inferred from
 * `action === 'retry'`: `keep` and `fix-in-post` are both non-generating, and
 * charging for them would bill the user for work no provider performed.
 */
export function triageSpendsCredit(triage: TriageAction): boolean {
  return triage === 'edit' || triage === 're-roll' || triage === 'rewrite';
}

/**
 * Maps a routing decision onto the cost guard's spend purpose (T14).
 *
 * Defined here, once, so the "is this a retake?" question has a single answer
 * rather than being re-derived at each billing call site. A dispatcher acting on
 * a decision sets `HandlersDeps.spendPurpose` from this, which is what lets a
 * reviewer fix draw on the reserved slice of the daily cap.
 *
 * Non-generating triage returns 'new' rather than 'retake': it will never reach
 * the guard at all, and returning 'retake' would misleadingly suggest it had
 * claim on the reserve.
 */
export function spendPurposeFor(decision: Pick<RouteDecision, 'triage'>): 'new' | 'retake' {
  return triageSpendsCredit(decision.triage) ? 'retake' : 'new';
}

interface RoutingTableEntry {
  fixTargetAgent: string;
  fixDirectiveTemplate: string;
  /**
   * How to retry this root cause, and the one variable the retry may move.
   *
   * These pairings are the routing decision, not a default. A text typo is a
   * sampling miss against a prompt that already named the string, so it re-rolls
   * against the negative prompt; a wrong subject noun means the prompt itself was
   * wrong, so it rewrites. Getting this backwards is what produces the "retry
   * burned credit repeating the same error" failure the plan calls out.
   */
  triage: Exclude<TriageAction, 'keep'>;
  changedVariable: Exclude<RetakeVariable, null>;
}

const ROUTING_TABLE: Record<string, RoutingTableEntry> = {
  text_typo: {
    fixTargetAgent: '<original generator>',
    fixDirectiveTemplate:
      'Re-generate with explicit negative prompt forbidding misspelled text: "{{negativeText}}". Reinforce exact target string verbatim.',
    triage: 're-roll',
    changedVariable: 'negative-prompt',
  },
  brand_violation_color: {
    fixTargetAgent: 'media-forge:enterprise-corrector',
    // Changed with T11 from "targeted re-generation" to a grading pass. A colour
    // delta against a known brand palette is correctable on the delivered asset,
    // and regenerating to fix it risks changing everything the reviewer already
    // accepted -- composition, text, subject -- to correct a hue. This is the one
    // routing class where the cheapest correct fix genuinely costs nothing, and
    // it is what makes `fix-in-post` a reachable outcome rather than a decorative
    // enum member.
    fixDirectiveTemplate:
      'Correct in post: grade the delivered asset toward the brand palette {{brandColors}}. Do not regenerate — the rest of the frame already passed review.',
    triage: 'fix-in-post',
    changedVariable: 'post-processing',
  },
  brand_violation_logo: {
    fixTargetAgent: 'media-forge:enterprise-corrector',
    fixDirectiveTemplate:
      'Reserve a logo zone in the composition. Logo must appear at {{logoPosition}} with ≥{{logoConfidence}} confidence.',
    triage: 'edit',
    changedVariable: 'post-processing',
  },
  brand_violation_font: {
    fixTargetAgent: 'media-forge:enterprise-corrector',
    fixDirectiveTemplate:
      'Use approved font(s): {{approvedFonts}}. Render any text in one of these typefaces.',
    triage: 'rewrite',
    changedVariable: 'prompt',
  },
  semantic_object_wrong: {
    fixTargetAgent: 'media-forge:prompt-engineer',
    fixDirectiveTemplate:
      'Rewrite prompt — be more specific about the subject noun. Add a negative prompt for the wrong-object class.',
    triage: 'rewrite',
    changedVariable: 'prompt',
  },
  semantic_color_wrong: {
    fixTargetAgent: 'media-forge:prompt-engineer',
    fixDirectiveTemplate:
      'Rewrite prompt — replace abstract color words with hex codes. Add negative prompt for the off-target hue.',
    triage: 'rewrite',
    changedVariable: 'prompt',
  },
  composition_wrong: {
    fixTargetAgent: 'media-forge:scene-composer',
    fixDirectiveTemplate:
      'Re-do multi-image composition. Verify role labels and reference ordering.',
    triage: 'rewrite',
    changedVariable: 'reference-set',
  },
  temporal_drift: {
    fixTargetAgent: 'media-forge:veo-director',
    fixDirectiveTemplate:
      'Re-prompt the extension hop with full character/scene description repeated verbatim (≥80% of original prompt).',
    triage: 'rewrite',
    changedVariable: 'prompt',
  },
  safety_blocked: {
    fixTargetAgent: 'media-forge:prompt-engineer',
    fixDirectiveTemplate:
      'Rephrase per safety bypass strategy: {{strategy}}. Avoid the flagged class.',
    triage: 'rewrite',
    changedVariable: 'prompt',
  },
  lipsync_miss: {
    fixTargetAgent: '<original generator>',
    fixDirectiveTemplate:
      'Re-prompt with "medium close-up" framing and shortened dialogue (≤12s).',
    triage: 're-roll',
    changedVariable: 'duration',
  },
  ref_match_low: {
    fixTargetAgent: 'media-forge:cinematic-director',
    fixDirectiveTemplate:
      'Regenerate with stronger visual alignment to the moodboard reference. Emphasise the requested cinematic effect and composition.',
    triage: 'rewrite',
    changedVariable: 'reference-set',
  },
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteOpts {
  verdict: JudgeVerdict;
  attemptCount: number;
  maxAttempts?: number;
  previousRootCause?: string;
  originalGeneratorAgent: string;

  /**
   * T11: variables moved by earlier attempts on this job. Omitted means "none
   * known", which keeps every pre-T11 caller behaving exactly as before rather
   * than being retroactively constrained by history it never tracked.
   */
  variablesAlreadyChanged?: ReadonlyArray<Exclude<RetakeVariable, null>>;

  /**
   * T11: how many earlier attempts actually reached a provider. Defaults to
   * `attemptCount`, i.e. the pessimistic assumption that every attempt was paid
   * — correct for callers that do not yet distinguish, and never over-grants
   * paid budget.
   */
  paidAttemptsUsed?: number;

  /**
   * T11: hard cap on attempts of any kind, free ones included. Defaults to
   * `maxAttempts * 2`. Purely a non-termination backstop, never a cost control —
   * that is what `maxAttempts` is.
   */
  maxTotalAttempts?: number;

  context?: {
    negativeText?: string;
    brandColors?: string[];
    logoPosition?: string;
    logoConfidence?: number;
    approvedFonts?: string[];
    strategy?: string;
  };
}

export interface RouteDecision {
  action: 'retry' | 'escalate' | 'accept';
  fixTargetAgent?: string;
  fixDirective?: string;
  reason: string;
  attemptCount: number;
  remainingBudget: number;

  /**
   * T11 triage. Always present, including on `escalate`, so a caller that hands
   * the job to a human still knows what the cheapest viable fix would have been.
   */
  triage: TriageAction;

  /**
   * T11: the ONE variable this retake may change. Null whenever nothing is being
   * retried (`keep`, or an escalation with no viable automated fix).
   *
   * Recorded into TakeReview so the attempt history reads as a sequence of single
   * changes rather than an undifferentiated list of failures.
   */
  changedVariable: RetakeVariable;

  /**
   * T11: whether acting on this decision will cost money.
   *
   * Derived from `triage`, not from `action`. `fix-in-post` is an `action:
   * 'retry'` that never reaches a provider; billing it off `action` alone would
   * charge for work nobody performed and consume the retake reserve for nothing.
   */
  spendsCredit: boolean;
}

/**
 * Explicit retake budget. The plan asks for "orçamento de tentativas explícito,
 * não só contador" — the difference is that a counter tells you how many times
 * you tried, while a budget tells you what you are still permitted to do.
 *
 * `remainingBudget` alone cannot answer "may I re-roll?", because a re-roll and a
 * fix-in-post draw on entirely different resources: one costs credit, the other
 * costs nothing and should never be rationed by a credit-derived limit.
 */
export interface RetakeBudget {
  /** Cap on PAID attempts. This is what MEDIA_FORGE_MAX_FIX_ATTEMPTS means. */
  readonly maxAttempts: number;
  /**
   * Hard cap on attempts of any kind, including free ones. Exists purely as a
   * non-termination backstop, not as a cost control.
   */
  readonly maxTotalAttempts: number;
  readonly attemptsUsed: number;
  readonly attemptsRemaining: number;
  /** Generating attempts left. Non-generating triage does not consume these. */
  readonly paidAttemptsRemaining: number;
  /** Variables already moved, oldest first. Enforces one-change-per-attempt. */
  readonly variablesAlreadyChanged: ReadonlyArray<Exclude<RetakeVariable, null>>;
}

/**
 * How many total attempts are permitted per paid attempt allowed.
 *
 * Free triage still costs wall-clock time and reviewer calls, so it cannot be
 * unbounded just because it is not billed. Two total attempts per paid attempt
 * leaves room for a fix-in-post pass between generations without letting a
 * degenerate loop run forever.
 */
const TOTAL_ATTEMPT_MULTIPLIER = 2;

/**
 * Builds the budget view from the attempt history.
 *
 * `paidAttemptsUsed` is separate from `attemptsUsed` because non-generating
 * triage must not consume paid budget: a job that spends two attempts on
 * `fix-in-post` should still have its full credit allowance for a genuine
 * re-roll. For that separation to mean anything the two must have DIFFERENT
 * caps — with a single shared cap the total gate always binds first and the paid
 * budget can never be the operative limit.
 */
export function buildRetakeBudget(args: {
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly paidAttemptsUsed: number;
  readonly maxTotalAttempts?: number;
  readonly variablesAlreadyChanged?: ReadonlyArray<Exclude<RetakeVariable, null>>;
}): RetakeBudget {
  const { maxAttempts, attemptsUsed, paidAttemptsUsed } = args;
  const maxTotalAttempts = args.maxTotalAttempts ?? maxAttempts * TOTAL_ATTEMPT_MULTIPLIER;
  return {
    maxAttempts,
    maxTotalAttempts,
    attemptsUsed,
    attemptsRemaining: Math.max(0, maxTotalAttempts - attemptsUsed),
    paidAttemptsRemaining: Math.max(0, maxAttempts - paidAttemptsUsed),
    variablesAlreadyChanged: args.variablesAlreadyChanged ?? [],
  };
}

/**
 * Guards the one-variable-per-retake discipline.
 *
 * Returns a reason to refuse when the proposed retake would move a variable that
 * a previous attempt already moved without success. Repeating a change that
 * already failed is the exact pattern that burns a retry budget while learning
 * nothing, and it is invisible to a plain attempt counter.
 */
export function checkRetakeVariable(
  budget: RetakeBudget,
  proposed: RetakeVariable,
): { allowed: true } | { allowed: false; reason: string } {
  if (proposed === null) return { allowed: true };
  if (budget.variablesAlreadyChanged.includes(proposed)) {
    return {
      allowed: false,
      reason:
        `"${proposed}" was already changed on an earlier attempt and the take still ` +
        `failed. Repeating it spends credit without testing anything new — change a ` +
        `different variable or escalate`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

function sortErrorsBySeverity(errors: JudgeError[]): JudgeError[] {
  return [...errors].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );
}

function resolveTemplate(
  template: string,
  originalGeneratorAgent: string,
  context?: RouteOpts['context'],
): string {
  return template
    .replace('{{negativeText}}', context?.negativeText ?? '')
    .replace('{{brandColors}}', context?.brandColors?.join(', ') ?? '')
    .replace('{{logoPosition}}', context?.logoPosition ?? 'center')
    .replace('{{logoConfidence}}', String(context?.logoConfidence ?? 0.8))
    .replace('{{approvedFonts}}', context?.approvedFonts?.join(', ') ?? '')
    .replace('{{strategy}}', context?.strategy ?? 'safe rephrasing');
}

function resolveAgent(agent: string, originalGeneratorAgent: string): string {
  return agent === '<original generator>' ? originalGeneratorAgent : agent;
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

export function route(opts: RouteOpts): RouteDecision {
  // Parse the env override but reject NaN/<=0 so a typo in the env var
  // (e.g. MEDIA_FORGE_MAX_FIX_ATTEMPTS=abc) cannot collapse retry gating —
  // attemptCount >= NaN is always false, which would allow indefinite retries.
  const envRaw = process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'];
  const envParsed = envRaw !== undefined ? parseInt(envRaw, 10) : NaN;
  const envValid = Number.isFinite(envParsed) && envParsed > 0;
  const maxAttempts = opts.maxAttempts ?? (envValid ? envParsed : 3);

  // Reports the PAID budget: it is the one that costs money and the one users
  // act on. Defaulting paidAttemptsUsed to attemptCount keeps this identical to
  // the pre-T11 number for every caller that does not distinguish the two.
  const remainingBudget = Math.max(
    0,
    maxAttempts - (opts.paidAttemptsUsed ?? opts.attemptCount) - 1,
  );

  // Rule 1: verdict is pass → accept
  if (opts.verdict.verdict === 'pass') {
    logger.info('router: verdict=pass → accept', { attemptCount: opts.attemptCount });
    return {
      action: 'accept',
      reason: 'verdict is pass',
      attemptCount: opts.attemptCount,
      remainingBudget,
      triage: 'keep',
      changedVariable: null,
      spendsCredit: false,
    };
  }

  // Rule 2: budget exhausted → escalate.
  //
  // T11 splits this into two limits that mean different things. The PAID limit
  // (maxAttempts, i.e. MEDIA_FORGE_MAX_FIX_ATTEMPTS) is the cost control and
  // counts only attempts that actually reached a provider. The TOTAL limit is a
  // non-termination backstop covering free triage as well, which costs no credit
  // but does cost wall-clock time and reviewer calls.
  //
  // Counting free attempts against the paid budget -- the pre-T11 behaviour --
  // means two fix-in-post passes silently consume the credit allowance for
  // generations that never happened.
  //
  // paidAttemptsUsed defaults to attemptCount, so a caller that does not
  // distinguish the two gets exactly the old behaviour on the paid limit.
  const paidAttemptsUsed = opts.paidAttemptsUsed ?? opts.attemptCount;
  const maxTotalAttempts = opts.maxTotalAttempts ?? maxAttempts * TOTAL_ATTEMPT_MULTIPLIER;

  if (paidAttemptsUsed >= maxAttempts || opts.attemptCount >= maxTotalAttempts) {
    const exhausted = paidAttemptsUsed >= maxAttempts ? 'paid' : 'total';
    logger.warn('router: attempt budget exhausted → escalate', {
      attemptCount: opts.attemptCount,
      paidAttemptsUsed,
      maxAttempts,
      maxTotalAttempts,
      exhausted,
    });
    return {
      action: 'escalate',
      reason:
        exhausted === 'paid'
          ? `max attempts (${maxAttempts}) reached`
          : `max total attempts (${maxTotalAttempts}) reached`,
      attemptCount: opts.attemptCount,
      remainingBudget: 0,
      // Budget is gone, so nothing may be spent regardless of what the root
      // cause would otherwise have suggested.
      triage: 'keep',
      changedVariable: null,
      spendsCredit: false,
    };
  }

  // Rule 3: same root cause repeated on second+ attempt → escalate
  // "2× in a row" = attemptCount >= 1 AND rootCause matches previousRootCause
  if (
    opts.previousRootCause !== undefined &&
    opts.verdict.rootCauseStage === opts.previousRootCause &&
    opts.attemptCount >= 1
  ) {
    logger.warn('router: same root cause repeated → escalate', {
      rootCause: opts.verdict.rootCauseStage,
      attemptCount: opts.attemptCount,
    });
    return {
      action: 'escalate',
      reason: 'same root cause repeated',
      attemptCount: opts.attemptCount,
      remainingBudget,
      // The previous fix for this cause did not work. Spending again on the same
      // cause is the burn-credit-learn-nothing case this protocol exists to stop.
      triage: 'keep',
      changedVariable: null,
      spendsCredit: false,
    };
  }

  // Rule 4: pick first error by severity, map to routing table
  const sortedErrors = sortErrorsBySeverity(opts.verdict.errors);
  const topError = sortedErrors[0];

  if (!topError) {
    // verdict is fail/partial but no errors — generic escalate
    logger.warn('router: fail verdict with no errors → escalate', {
      verdict: opts.verdict.verdict,
    });
    return {
      action: 'escalate',
      reason: 'verdict is non-pass but no errors provided',
      attemptCount: opts.attemptCount,
      remainingBudget,
      // No error to route on means no basis for choosing a fix. Guessing here
      // would spend credit on an arbitrary change.
      triage: 'keep',
      changedVariable: null,
      spendsCredit: false,
    };
  }

  const entry = ROUTING_TABLE[topError.class];
  if (!entry) {
    // Unknown error class — escalate
    logger.warn('router: unknown error class → escalate', { class: topError.class });
    return {
      action: 'escalate',
      reason: `unknown error class: ${topError.class}`,
      attemptCount: opts.attemptCount,
      remainingBudget,
      triage: 'keep',
      changedVariable: null,
      spendsCredit: false,
    };
  }

  const fixTargetAgent = resolveAgent(entry.fixTargetAgent, opts.originalGeneratorAgent);
  const fixDirective = resolveTemplate(
    entry.fixDirectiveTemplate,
    opts.originalGeneratorAgent,
    opts.context,
  );

  logger.info('router: routing to fix agent', {
    errorClass: topError.class,
    fixTargetAgent,
    attemptCount: opts.attemptCount,
  });

  // T11: refuse to move a variable an earlier attempt already moved without
  // success. This is checked before returning `retry` so the caller never gets a
  // decision it must then second-guess. A plain attempt counter cannot see this
  // — it only knows how many times you tried, not what you tried.
  const variableCheck = checkRetakeVariable(
    buildRetakeBudget({
      maxAttempts,
      maxTotalAttempts,
      attemptsUsed: opts.attemptCount,
      paidAttemptsUsed,
      variablesAlreadyChanged: opts.variablesAlreadyChanged,
    }),
    entry.changedVariable,
  );

  if (!variableCheck.allowed) {
    logger.warn('router: retake variable already exhausted → escalate', {
      variable: entry.changedVariable,
      attemptCount: opts.attemptCount,
    });
    return {
      action: 'escalate',
      reason: variableCheck.reason,
      attemptCount: opts.attemptCount,
      remainingBudget,
      triage: 'keep',
      changedVariable: null,
      spendsCredit: false,
    };
  }

  return {
    action: 'retry',
    fixTargetAgent,
    fixDirective,
    reason: `error class ${topError.class} (${topError.severity}) → route to ${fixTargetAgent}`,
    attemptCount: opts.attemptCount,
    remainingBudget,
    triage: entry.triage,
    changedVariable: entry.changedVariable,
    spendsCredit: triageSpendsCredit(entry.triage),
  };
}

// ---------------------------------------------------------------------------
// Budget estimator (C4 visible budget)
// ---------------------------------------------------------------------------

export function estimateRetryBudget(maxAttempts?: number): {
  maxAttempts: number;
  estimatedCostUsd: number;
} {
  const max =
    maxAttempts ??
    (process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS']
      ? parseInt(process.env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'], 10)
      : 3);
  return {
    maxAttempts: max,
    estimatedCostUsd: max * 0.5,
  };
}
