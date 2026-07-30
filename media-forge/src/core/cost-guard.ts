// src/core/cost-guard.ts
// Pure decision function for the media-forge cost guards. No I/O — callers
// supply spentTodayUsd (from dailySpendUsd, see cost-tracker.ts) and the three
// thresholds already read off config (dailyCapUsd / confirmThresholdUsd /
// blockThresholdUsd). Kept pure so the boundary logic is trivially testable
// without a database.
//
// Evaluation order, strictest first:
//   1. estimateUsd > blockThresholdUsd        -> block (single-call hard limit)
//   2. spentTodayUsd + estimateUsd > dailyCapUsd -> block (daily cap)
//   3. T14 reserve: a NEW generation may not consume the slice of the daily cap
//      held back for retakes -> block or warn depending on reserveMode
//   4. estimateUsd > confirmThresholdUsd      -> warn (never blocks)
//   5. otherwise                              -> allow
//
// All comparisons are strictly `>` — an estimate exactly AT a limit is
// allowed. This is deliberate per spec; do not switch to `>=`.
//
// ## T14 — why a reserve exists at all
//
// The reviewer retries a failed take up to maxFixAttempts times, and each retry
// is a real paid generation. Without a reserve, a day's worth of first-attempt
// generations can consume the entire cap, and the reviewer then cannot afford to
// fix any of them. The job dies mid-flight having spent the full budget on
// output nobody accepted — the worst possible way to run out of money.
//
// The fix is to make new work stop before the cap rather than at it, leaving a
// slice only retakes can spend.

/** What the spend is for. Retakes may draw on the reserved slice; new work may not. */
export type SpendPurpose = 'new' | 'retake';

/**
 * How the reserve is enforced.
 *
 *   observe — record the crossing, change nothing. THE DEFAULT, because it is
 *             the behaviour that shipped before T14. Defaulting to `cap` would
 *             silently tighten every existing install's usable budget by the
 *             reserve percentage without anyone opting in.
 *   warn    — allow, but tell the caller the reserve is being consumed.
 *   cap     — block new work once only the reserve is left.
 */
export type ReserveMode = 'observe' | 'warn' | 'cap';

export type GuardDecision =
  | { action: 'allow' }
  | { action: 'warn'; reason: string }
  | { action: 'block'; reason: string };

export interface GuardInput {
  readonly estimateUsd: number;
  readonly spentTodayUsd: number;
  readonly blockThresholdUsd: number;
  readonly dailyCapUsd: number;
  readonly confirmThresholdUsd: number;

  /**
   * Fraction of dailyCapUsd held back for retakes, 0..1. Omitted or 0 disables
   * the reserve entirely, which is what every pre-T14 caller gets.
   */
  readonly reservePct?: number;

  /** Defaults to 'observe' — see ReserveMode. */
  readonly reserveMode?: ReserveMode;

  /** Defaults to 'new'. An unlabelled call is treated as new work, which is the
   *  conservative reading: it is the case the reserve is meant to constrain. */
  readonly purpose?: SpendPurpose;
}

/**
 * Clamps the reserve fraction into 0..1.
 *
 * A misconfigured `MEDIA_FORGE_BUDGET_RESERVE_PCT=90` (someone reading it as a
 * percentage rather than a fraction) would otherwise compute a negative
 * available budget and block every generation with an incomprehensible message.
 * Clamping turns a typo into a conservative budget rather than an outage.
 */
export function normalizeReservePct(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * The portion of the daily cap that new work is allowed to reach.
 * Exported because the CLI and the README both quote this number, and computing
 * it in two places is how they drift apart.
 */
export function newWorkBudgetUsd(dailyCapUsd: number, reservePct: number | undefined): number {
  return dailyCapUsd * (1 - normalizeReservePct(reservePct));
}

export function evaluateCostGuard(input: GuardInput): GuardDecision {
  const { estimateUsd, spentTodayUsd, blockThresholdUsd, dailyCapUsd, confirmThresholdUsd } = input;
  const reserveMode: ReserveMode = input.reserveMode ?? 'observe';
  const purpose: SpendPurpose = input.purpose ?? 'new';
  const reservePct = normalizeReservePct(input.reservePct);

  if (estimateUsd > blockThresholdUsd) {
    return {
      action: 'block',
      reason:
        `estimated $${estimateUsd.toFixed(2)} exceeds the hard block of ` +
        `$${blockThresholdUsd.toFixed(2)} (MEDIA_FORGE_BLOCK_THRESHOLD_USD)`,
    };
  }

  const projectedTotalUsd = spentTodayUsd + estimateUsd;
  if (projectedTotalUsd > dailyCapUsd) {
    return {
      action: 'block',
      reason:
        `today's spend $${spentTodayUsd.toFixed(2)} + estimated $${estimateUsd.toFixed(2)} = ` +
        `$${projectedTotalUsd.toFixed(2)} exceeds the daily cap of $${dailyCapUsd.toFixed(2)} ` +
        `(MEDIA_FORGE_DAILY_CAP_USD)`,
    };
  }

  // T14 — the retake reserve. Only new work is constrained; a retake is exactly
  // what the slice was held back for, so it passes through to the checks above
  // and is bounded by the hard daily cap alone.
  if (reservePct > 0 && purpose === 'new' && reserveMode !== 'observe') {
    const newWorkBudget = newWorkBudgetUsd(dailyCapUsd, reservePct);
    if (projectedTotalUsd > newWorkBudget) {
      const reservedUsd = dailyCapUsd - newWorkBudget;
      const reason =
        `today's spend $${spentTodayUsd.toFixed(2)} + estimated $${estimateUsd.toFixed(2)} = ` +
        `$${projectedTotalUsd.toFixed(2)} exceeds the $${newWorkBudget.toFixed(2)} available to ` +
        `new generations. $${reservedUsd.toFixed(2)} of the $${dailyCapUsd.toFixed(2)} daily cap ` +
        `is reserved for reviewer retakes (${(reservePct * 100).toFixed(0)}%, ` +
        `MEDIA_FORGE_BUDGET_RESERVE_PCT)`;

      if (reserveMode === 'cap') {
        return {
          action: 'block',
          reason:
            `${reason}. Raise MEDIA_FORGE_DAILY_CAP_USD, lower the reserve, or set ` +
            `MEDIA_FORGE_BUDGET_RESERVE_MODE=warn to proceed anyway`,
        };
      }
      return { action: 'warn', reason: `${reason} — proceeding (reserve mode is "warn")` };
    }
  }

  if (estimateUsd > confirmThresholdUsd) {
    return {
      action: 'warn',
      reason:
        `estimated $${estimateUsd.toFixed(2)} exceeds the confirmation threshold of ` +
        `$${confirmThresholdUsd.toFixed(2)} (MEDIA_FORGE_CONFIRM_THRESHOLD_USD) — proceeding, ` +
        `no confirmation required`,
    };
  }

  return { action: 'allow' };
}
