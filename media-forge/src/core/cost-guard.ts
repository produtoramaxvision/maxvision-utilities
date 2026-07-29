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
//   3. estimateUsd > confirmThresholdUsd      -> warn (never blocks)
//   4. otherwise                              -> allow
//
// All comparisons are strictly `>` — an estimate exactly AT a limit is
// allowed. This is deliberate per spec; do not switch to `>=`.

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
}

export function evaluateCostGuard(input: GuardInput): GuardDecision {
  const { estimateUsd, spentTodayUsd, blockThresholdUsd, dailyCapUsd, confirmThresholdUsd } = input;

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
