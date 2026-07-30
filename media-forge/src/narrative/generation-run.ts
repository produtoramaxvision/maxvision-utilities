// src/narrative/generation-run.ts
// T10 — Zod port of skills/_shared/schemas/generation-run.schema.json, plus the
// reconciliation the plan explicitly calls for.
//
// ## Why this file is mostly about what it does NOT contain
//
// The plan's warning on T10 is precise: "generation-run e o trace/lineage atual
// se sobrepoem. Reconciliar, nao duplicar -- dois registros do mesmo evento
// divergem e corrompem o custo."
//
// Both records describe a generation. The overlap is real. So the split is drawn
// on grain and ownership rather than by picking a winner:
//
//   trace.jsonl (src/trace/trace-writer.ts)
//     Per-STAGE, per-job. Owns timing (`durationMs`) and MONEY (`costUsd`).
//     Already written by every provider path and already reconciled against the
//     credit ledger by the sweep.
//
//   GenerationRun (here)
//     Per-ATTEMPT, per-clip. Owns NARRATIVE identity: which project, which clip,
//     which prompt version, which references were in play, how it ended.
//     Answers "which prompt produced this take", not "what did it cost".
//
// GenerationRun therefore has NO cost field, and must never grow one. If it did,
// two independent writers would record the price of the same generation, they
// would disagree the first time a retry settled at a different actual cost, and
// there would be no principled way to decide which one the daily cap should
// believe. `assertNoCostFields` below turns that from a convention into a test
// failure. The link back to money is `run_id`, which is the job id the trace and
// the ledger are both keyed on -- one number, one owner, joinable from either
// side.

import { z } from 'zod';

/** How a run ended. `not_run_fixture` exists so eval fixtures never bill. */
export const RESULT_STATUSES = [
  'not_run_fixture',
  'submitted',
  'generated',
  'reviewed',
  'accepted',
  'rejected',
] as const;

export const ResultStatus = z.enum(RESULT_STATUSES);
export type ResultStatusT = z.infer<typeof ResultStatus>;

export const GenerationRun = z
  .object({
    /**
     * The job id. Deliberately the same identifier the trace entries and the
     * ledger rows use, so the narrative record joins to the cost record without
     * either side storing the other's data.
     */
    run_id: z.string().min(1),

    project_id: z.string(),
    clip_id: z.string(),

    /** Provider/model surface this run was dispatched to. */
    surface: z.string(),

    /** Ties the run to the exact PromptSpec that produced it. */
    prompt_version: z.string(),

    input_mode: z.string(),
    reference_tags: z.array(z.string()),
    prompt: z.string(),

    result_status: ResultStatus,

    /**
     * True for records produced by the eval suite. A synthetic run must never
     * have reserved credit, and separating them by a flag rather than by a
     * separate store means the "did this bill?" question has one answer path.
     */
    is_synthetic_fixture: z.boolean(),
  })
  .strict();

export type GenerationRunT = z.infer<typeof GenerationRun>;

/**
 * Field names that would re-introduce the double-accounting this schema exists to
 * avoid. Checked by the test suite against the actual Zod shape, so adding a cost
 * field to GenerationRun fails CI with the reason attached rather than silently
 * creating a second source of truth for money.
 */
export const FORBIDDEN_COST_FIELDS = [
  'cost',
  'cost_usd',
  'costUsd',
  'actual_cost_usd',
  'actualUsd',
  'credits',
  'actual_credits',
  'actualCredits',
  'estimate_usd',
  'estimatedCostUSD',
  'price',
] as const;

/**
 * Verifies the no-money invariant on the schema itself.
 *
 * Throws rather than returning a boolean because there is no sensible way for a
 * caller to continue: if this fails, the cost model has two owners and every
 * number downstream is suspect.
 */
export function assertNoCostFields(): void {
  const declared = Object.keys(GenerationRun.shape);
  const offending = declared.filter((key) =>
    (FORBIDDEN_COST_FIELDS as readonly string[]).includes(key),
  );
  if (offending.length > 0) {
    throw new Error(
      `GenerationRun must not carry cost data (found: ${offending.join(', ')}). ` +
        `Money is owned by trace.jsonl (costUsd) and the credit ledger, joined on run_id. ` +
        `A second writer for the same amount diverges on retry and corrupts the daily cap.`,
    );
  }
}

/**
 * A run is only billable once it has actually been dispatched to a provider.
 *
 * `not_run_fixture` is the eval-suite status and `is_synthetic_fixture` marks
 * eval records; neither may appear against a ledger row. Used by the tests that
 * guard the fixture/billing boundary, and safe to call before reserving credit.
 */
export function isBillableRun(run: GenerationRunT): boolean {
  if (run.is_synthetic_fixture) return false;
  return run.result_status !== 'not_run_fixture';
}

/**
 * Consistency between the fixture flag and the status.
 *
 * A record flagged synthetic but reporting `generated` means an eval fixture
 * reached a real provider -- exactly the mistake that spends money during a test
 * run, and the reason this is checked rather than trusted.
 */
export function validateGenerationRunConsistency(run: GenerationRunT): string[] {
  const problems: string[] = [];

  if (run.is_synthetic_fixture && run.result_status !== 'not_run_fixture') {
    problems.push(
      `is_synthetic_fixture is true but result_status is "${run.result_status}"; ` +
        `a synthetic fixture must never report a dispatched status`,
    );
  }

  if (!run.is_synthetic_fixture && run.result_status === 'not_run_fixture') {
    problems.push(
      'result_status "not_run_fixture" requires is_synthetic_fixture to be true',
    );
  }

  return problems;
}

/** Parses and enforces the fixture/billing consistency rules. */
export function parseGenerationRun(input: unknown): GenerationRunT {
  const run = GenerationRun.parse(input);
  const problems = validateGenerationRunConsistency(run);
  if (problems.length > 0) {
    throw new z.ZodError(
      problems.map((message) => ({
        code: z.ZodIssueCode.custom,
        path: ['result_status'],
        message,
      })),
    );
  }
  return run;
}
