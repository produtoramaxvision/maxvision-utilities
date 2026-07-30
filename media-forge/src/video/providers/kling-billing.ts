// src/video/providers/kling-billing.ts
// What Kling ACTUALLY charged, from Kling — not what this repo estimated.
//
// ## The gap this closes
//
// Everywhere else, a Kling job settles at `rate x multiplier x duration` read out
// of src/core/models.ts. That is an estimate wearing the costume of a fact: it is
// only right while the local rate table matches Kling's real pricing, and nothing
// detects the moment it stops.
//
// Kling reports the charge per task. Two surfaces, both verified via context7
// against kling.ai/document-api on 2026-07-30:
//
//   GET /tasks (list form)   per task: billing[] = [{ charge_type, amount, package_type }]
//                            charge_type is 'cash' or 'unit'
//   GET /account/costs       resource packs: total_quantity / remaining_quantity,
//                            with a documented 12h delay on remaining
//
// ## The unit/cash distinction is the whole risk here
//
// `amount` is meaningless without `charge_type`. A task charged 8 UNITS costs
// $1.12; the same number read as cash is $8.00. Getting it backwards misprices by
// 7x in whichever direction, and the ledger would look authoritative either way
// because it came from the provider.
//
// So `chargeToUsd` refuses an unrecognised charge_type rather than assuming. A
// settlement this code cannot interpret must surface, not silently pick a branch.
//
// ## Not used for the daily cap
//
// The cap gates BEFORE submit and needs a number then; deduction is only knowable
// after. This is for settlement and drift detection, which is what T15 approximates
// today.

import { ApiError, ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

/** Same host as every other Kling call. */
export const KLING_BILLING_BASE = 'https://api-singapore.klingai.com';

/**
 * USD per Kling unit.
 *
 * $0.14, read off kling.ai/dev/pricing in an authenticated session on
 * 2026-07-30 — the same figure every Kling rate in src/core/models.ts derives
 * from. Kept here as a named export so a change reaches both the estimate and
 * the settlement, instead of the two drifting into disagreement.
 */
export const KLING_USD_PER_UNIT = 0.14;

/** Charge kinds the billing array reports. */
export const KLING_CHARGE_TYPES = ['cash', 'unit'] as const;
export type KlingChargeType = (typeof KLING_CHARGE_TYPES)[number];

export interface KlingBillingEntry {
  readonly charge_type?: string;
  readonly amount?: string | number;
  readonly package_type?: string;
}

/**
 * Converts one billing entry to USD.
 *
 * Throws on an unknown charge_type instead of guessing. The two known kinds
 * differ by a factor of ~7, so a wrong branch produces a number that is
 * confidently incorrect — worse than no number at all, because it would replace
 * a merely-approximate estimate with a wrong "actual".
 */
export function chargeToUsd(entry: KlingBillingEntry): number {
  const raw = typeof entry.amount === 'string' ? Number.parseFloat(entry.amount) : entry.amount;

  if (raw === undefined || !Number.isFinite(raw)) {
    throw new ValidationError(
      `kling billing entry has no usable amount: ${JSON.stringify(entry).slice(0, 200)}`,
    );
  }

  switch (entry.charge_type) {
    case 'cash':
      return raw;
    case 'unit':
      return raw * KLING_USD_PER_UNIT;
    default:
      throw new ValidationError(
        `kling billing reported charge_type "${entry.charge_type}", which this build does ` +
          `not know how to convert. Known kinds are ${KLING_CHARGE_TYPES.join(' and ')}, and ` +
          `they differ by roughly 7x — guessing would put a confidently wrong "actual" cost ` +
          `into the ledger. Read the current billing documentation before adding a branch.`,
      );
  }
}

/** Sums every charge on one task. A task can be billed on more than one line. */
export function totalChargeUsd(entries: ReadonlyArray<KlingBillingEntry>): number {
  return entries.reduce((sum, entry) => sum + chargeToUsd(entry), 0);
}

export interface KlingTaskBilling {
  readonly taskId: string;
  readonly actualUsd: number;
  readonly entries: ReadonlyArray<KlingBillingEntry>;
}

export interface FetchBillingOptions {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

/**
 * Builds the /tasks list query for a billing pull.
 *
 * The LIST form of /tasks, not the by-id form: only the list response carries
 * `billing[]`. Both live at the same path, which is easy to conflate — querying
 * by id returns a task with no billing at all and looks like a task that was
 * never charged.
 */
export function buildBillingQuery(args: {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly limit?: number;
  readonly cursor?: string;
}): string {
  const params = new URLSearchParams();

  // A cursor supersedes the window: the docs state start_time and end_time are
  // ignored when cursor is set, so sending all three invites the caller to
  // believe a window is being applied when it is not.
  if (args.cursor !== undefined && args.cursor.length > 0) {
    params.set('cursor', args.cursor);
  } else {
    params.set('start_time', String(args.startTimeMs));
    params.set('end_time', String(args.endTimeMs));
  }

  // Documented maximum is 500. Clamping rather than forwarding a larger number
  // keeps the failure local instead of a rejected request mid-reconciliation.
  const limit = Math.min(args.limit ?? 100, 500);
  params.set('limit', String(limit));

  return `/tasks?${params.toString()}`;
}

interface TaskListEnvelope {
  readonly code?: number;
  readonly message?: string;
  readonly data?: ReadonlyArray<{
    readonly id?: string;
    readonly task_id?: string;
    readonly billing?: ReadonlyArray<KlingBillingEntry>;
  }>;
  readonly next_cursor?: string;
  readonly has_more?: boolean;
}

export interface BillingPage {
  readonly tasks: ReadonlyArray<KlingTaskBilling>;
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

/**
 * Fetches one page of task billing.
 *
 * A task whose billing entry cannot be interpreted is SKIPPED with a warning
 * rather than failing the page: one unknown charge kind should not block
 * reconciling every other task in the window. The warning names the task so it
 * can be settled by hand.
 */
export async function fetchTaskBillingPage(
  args: {
    readonly startTimeMs: number;
    readonly endTimeMs: number;
    readonly limit?: number;
    readonly cursor?: string;
  },
  opts: FetchBillingOptions,
): Promise<BillingPage> {
  const base = opts.baseUrl ?? KLING_BILLING_BASE;
  const doFetch = opts.fetchImpl ?? fetch;

  const response = await doFetch(`${base}${buildBillingQuery(args)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new ApiError(`kling task-billing query failed: HTTP ${response.status}`, 'API', {
      provider: 'kling',
    });
  }

  const envelope = (await response.json()) as TaskListEnvelope;

  // HTTP 200 with a non-zero code is how Kling reports application failures.
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw new ApiError(
      `kling task-billing query returned code ${envelope.code}: ${envelope.message ?? ''}`.trim(),
      'API',
      { provider: 'kling' },
    );
  }

  const tasks: KlingTaskBilling[] = [];
  for (const row of envelope.data ?? []) {
    const taskId = row.id ?? row.task_id;
    if (taskId === undefined) continue;

    const entries = row.billing ?? [];
    if (entries.length === 0) continue;

    try {
      tasks.push({ taskId, actualUsd: totalChargeUsd(entries), entries });
    } catch (err) {
      logger.warn('kling billing: skipping a task with an uninterpretable charge', {
        taskId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    tasks,
    ...(envelope.next_cursor !== undefined && envelope.next_cursor.length > 0
      ? { nextCursor: envelope.next_cursor }
      : {}),
    hasMore: envelope.has_more === true,
  };
}

export interface KlingResourcePack {
  readonly name: string;
  readonly totalQuantity: number;
  readonly remainingQuantity: number;
  readonly status: string;
}

interface AccountCostsEnvelope {
  readonly code?: number;
  readonly message?: string;
  readonly data?: {
    readonly resource_pack_subscribe_infos?: ReadonlyArray<{
      readonly resource_pack_name?: string;
      readonly total_quantity?: number;
      readonly remaining_quantity?: number;
      readonly status?: string;
    }>;
  };
}

/**
 * Reads the account's resource packs.
 *
 * `GET /account/costs`, per the account-usage page. Useful for a balance view,
 * but NOT for settling an individual job: the documentation states remaining
 * quantity lags by 12 hours, so reconciling a job against it would compare a
 * fresh charge to a stale balance and report drift that does not exist. The
 * delay is surfaced in the return so a caller cannot forget it.
 */
export async function fetchAccountCosts(
  args: { readonly startTimeMs: number; readonly endTimeMs: number },
  opts: FetchBillingOptions,
): Promise<{ packs: ReadonlyArray<KlingResourcePack>; remainingIsDelayed: true }> {
  const base = opts.baseUrl ?? KLING_BILLING_BASE;
  const doFetch = opts.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    start_time: String(args.startTimeMs),
    end_time: String(args.endTimeMs),
  });

  const response = await doFetch(`${base}/account/costs?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new ApiError(`kling account-costs query failed: HTTP ${response.status}`, 'API', {
      provider: 'kling',
    });
  }

  const envelope = (await response.json()) as AccountCostsEnvelope;
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw new ApiError(
      `kling account-costs returned code ${envelope.code}: ${envelope.message ?? ''}`.trim(),
      'API',
      { provider: 'kling' },
    );
  }

  const packs = (envelope.data?.resource_pack_subscribe_infos ?? []).map((p) => ({
    name: p.resource_pack_name ?? '(unnamed)',
    totalQuantity: p.total_quantity ?? 0,
    remainingQuantity: p.remaining_quantity ?? 0,
    status: p.status ?? 'unknown',
  }));

  return { packs, remainingIsDelayed: true };
}

/**
 * Compares an estimate against what was actually charged.
 *
 * Returned as a ratio rather than a boolean because the useful question is not
 * "did it differ" — floating point and rounding guarantee it will — but "did it
 * differ enough to mean the rate table is wrong". The caller picks the threshold
 * it cares about.
 */
export function compareEstimateToActual(args: {
  readonly estimateUsd: number;
  readonly actualUsd: number;
}): { readonly deltaUsd: number; readonly ratio: number } {
  const deltaUsd = args.actualUsd - args.estimateUsd;
  // A zero estimate would make the ratio meaningless rather than infinite-and-
  // informative, so it is reported as 0 and the delta carries the signal.
  const ratio = args.estimateUsd === 0 ? 0 : args.actualUsd / args.estimateUsd;
  return { deltaUsd, ratio };
}
