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
// Kling reports the charge per task. Two surfaces, read on 2026-07-30 from the
// documentation itself (kling.ai/document-api/llms.txt is the page index) and
// exercised against the live account at zero cost:
//
//   POST /tasks              the LIST form. Body {start_time,end_time,cursor,limit,filters}.
//                            Response data.result[] carries per task:
//                            billing[] = [{ charge_type, amount, package_type, list_price }]
//                            charge_type is 'cash' or 'unit'
//   GET  /account/costs      resource packs: total_quantity / remaining_quantity,
//                            with a documented 12h delay on remaining
//
// The earlier build of this file sent GET /tasks with the window as a query
// string. GET /tasks accepts ONLY task_ids / external_task_ids; the live API
// answers the window form with HTTP 400 code 1201 "task_ids or external_task_ids
// is required", so reconciliation never settled anything. Every test injected
// fetch and asserted against a fixture written from the same wrong belief, which
// is why 35 passing tests said nothing about it. The call shape is now asserted
// directly — verb, URL and body — because that is the part a fixture cannot vouch
// for on its own.
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
  /**
   * Pre-discount price, present only on the cash branch.
   *
   * Carried through untouched rather than folded into the settled cost: the
   * ledger must record what was actually deducted, not the list price. It is
   * kept because `amount` diverging from `list_price` is how a discount
   * changing under us would become visible.
   */
  readonly list_price?: string | number;
}

/**
 * Converts one billing entry to USD.
 *
 * Throws on an unknown charge_type instead of guessing. The two known kinds
 * differ by a factor of ~7, so a wrong branch produces a number that is
 * confidently incorrect — worse than no number at all, because it would replace
 * a merely-approximate estimate with a wrong "actual".
 *
 * KNOWN GAP on the cash branch: `billing[]` carries no currency, and Kling's
 * balance currency enum is CNY or USD (documented on the Balance Deduction
 * Detail page, which does return `currency`). A CNY-billed account would have
 * CNY written into `actual_usd` as though it were dollars. This build assumes
 * USD because that is what the pricing table quotes; the account this was
 * verified against had no deductions in the probe window, so the assumption is
 * untested rather than confirmed. Tracked in TODOS.md — the fix is to read
 * `currency` from POST /account/billing/balance, not to guess here.
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

/** Path of both /tasks query forms. The verb is what distinguishes them. */
export const KLING_TASK_LIST_PATH = '/tasks';

export interface KlingBillingRequestBody {
  readonly start_time?: number;
  readonly end_time?: number;
  readonly cursor?: string;
  readonly limit: number;
}

/**
 * Builds the body for the /tasks LIST query.
 *
 * A body, not a query string: `POST /tasks` is the cursor/window form, and it
 * is the only one whose response carries `billing[]` for a set of tasks.
 * `GET /tasks` shares the path but takes only task_ids / external_task_ids, so
 * the window sent as a query string is not merely ignored — the request is
 * rejected outright.
 */
export function buildBillingRequestBody(args: {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly limit?: number;
  readonly cursor?: string;
}): KlingBillingRequestBody {
  // Documented maximum is 500. Clamping rather than forwarding a larger number
  // keeps the failure local instead of a rejected request mid-reconciliation.
  const limit = Math.min(args.limit ?? 100, 500);

  // A cursor supersedes the window: the docs state start_time and end_time are
  // ignored when cursor is set, so sending all three invites the caller to
  // believe a window is being applied when it is not.
  if (args.cursor !== undefined && args.cursor.length > 0) {
    return { cursor: args.cursor, limit };
  }
  return { start_time: args.startTimeMs, end_time: args.endTimeMs, limit };
}

interface TaskListEnvelope {
  readonly code?: number;
  readonly message?: string;
  readonly data?: {
    readonly result?: ReadonlyArray<{
      readonly id?: string;
      readonly task_id?: string;
      readonly billing?: ReadonlyArray<KlingBillingEntry>;
    }>;
    readonly count?: number;
    readonly next_cursor?: string;
    readonly has_more?: boolean;
  };
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

  const response = await doFetch(`${base}${KLING_TASK_LIST_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildBillingRequestBody(args)),
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

  // `result` is omitted entirely — not returned empty — when the window holds
  // no tasks. Verified live against the real account: `data` came back as
  // { count: 0, has_more: false } with no result key.
  const tasks: KlingTaskBilling[] = [];
  for (const row of envelope.data?.result ?? []) {
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

  // Pagination lives inside `data`, next to `result` — not at the envelope
  // root. Read at the root, every page looked like the last one, so a window
  // wider than one page settled page 1 and still reported success.
  const nextCursor = envelope.data?.next_cursor;
  return {
    tasks,
    ...(nextCursor !== undefined && nextCursor.length > 0 ? { nextCursor } : {}),
    hasMore: envelope.data?.has_more === true,
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
