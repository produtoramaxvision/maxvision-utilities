// src/video/providers/kling-deduction.ts
// Kling's per-task deduction records — the account-wide audit surface.
//
// ## Why this exists next to kling-billing.ts
//
// They answer different questions and neither replaces the other.
//
//   kling-billing.ts   POST /tasks          "what did THIS task cost"
//                      settles a job we already hold a native_task_id for
//   this file          POST /account/billing/balance    "what did this ACCOUNT
//                      POST /account/billing/package     get charged, for everything"
//
// The deduction endpoints carry three things `/tasks` billing[] does not:
//
//   currency        'CNY' or 'USD'. `/tasks` billing[] has no currency field at
//                   all, so the cash branch there ASSUMES dollars. That
//                   assumption is only checkable here.
//   list_price      pre-discount price, so a discount changing under us shows up
//                   as list_price diverging from deduction_amount.
//
// The responses also carry balance_before_deduction / balance_after_deduction.
// They are NOT parsed here: an arithmetic cross-check against a running balance
// only means something if every deduction in the window is present and ordered,
// and a cursor-paginated window with a page cap cannot promise that. A check
// that can silently be computed over a partial series is worse than none.
//
// ## The orphan signal
//
// A task Kling billed that this install has no ledger row for is exactly the
// signature of the known post-submit loss: the provider accepted the job (it ran
// and it cost money), credit was reserved, and the ledger write threw before the
// row existed. `fetchTaskBillingPage` skips those silently — correct, because the
// same API key can be used from more than one machine, and attributing someone
// else's spend here would be worse. But silently skipping means the one signal
// worth having is discarded.
//
// So this reports them. It does NOT reconstruct the missing ledger row: the row
// is missing precisely because writing it failed, and inventing one would put a
// job with no local provenance into the cost history.
//
// ## Verification status — read this before trusting the row shape
//
// The ENVELOPE is verified live: both endpoints answered HTTP 200 code 0 against
// the real account on 2026-07-30, with `data.result.detail` / `data.count` /
// `data.has_more` exactly as documented. The individual ROW fields are from the
// documentation only (kling.ai/document-api/api/assets/billing-deduction/
// {balance,package}.md) because the account had zero deductions in the probe
// window — there was nothing to sample. That is a weaker position than the
// envelope, and it is why every row field here is optional and why an
// unparseable row is skipped rather than assumed.

import { ApiError, ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { KLING_BILLING_BASE, KLING_USD_PER_UNIT } from './kling-billing.js';

/** Currencies the balance endpoint reports. Documented enum, not inferred. */
export const KLING_CURRENCIES = ['USD', 'CNY'] as const;
export type KlingCurrency = (typeof KLING_CURRENCIES)[number];

export const KLING_BALANCE_PATH = '/account/billing/balance';
export const KLING_PACKAGE_PATH = '/account/billing/package';

export interface KlingDeductionRow {
  readonly taskId: string;
  /** What was deducted, in whatever `currency` says. */
  readonly deductionAmount: number;
  /** Absent on the package (unit) endpoint — units have no currency. */
  readonly currency?: KlingCurrency;
  /** Pre-discount. Absent when the response omits it. */
  readonly listPrice?: number;
  readonly modelName?: string;
  readonly resolution?: string;
  readonly durationSec?: number;
  readonly deductionTimeMs?: number;
}

export interface DeductionPage {
  readonly rows: ReadonlyArray<KlingDeductionRow>;
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

export interface DeductionQueryArgs {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface DeductionRequestBody {
  readonly start_time?: number;
  readonly end_time?: number;
  readonly cursor?: string;
  /** Absent on the cursor branch — see buildDeductionRequestBody. */
  readonly limit?: number;
}

/**
 * Builds the request body for either deduction endpoint.
 *
 * NOT shared with buildBillingRequestBody in kling-billing.ts, despite the two
 * looking near-identical. The documented contracts differ, and a duplication
 * checker cannot see that:
 *
 *   POST /tasks              "When cursor is not empty, start_time and end_time
 *                             are ignored."   limit default 100
 *   POST /account/billing/*  "When cursor is provided, it overrides all other
 *                             parameters (start_time, end_time, filters,
 *                             limit)."        limit default 500
 *
 * So the deduction cursor branch omits `limit` as well as the window, and the
 * default page size is the one this endpoint documents. Collapsing the two into
 * one helper — which was tried and reverted — silently gave the deduction
 * endpoints /tasks' rules: a `limit` sent where the docs call it invalid, and
 * pages five times smaller than the endpoint's own default.
 */
export function buildDeductionRequestBody(args: DeductionQueryArgs): DeductionRequestBody {
  if (args.cursor !== undefined && args.cursor.length > 0) {
    return { cursor: args.cursor };
  }
  // Documented maximum AND documented default is 500 here.
  return {
    start_time: args.startTimeMs,
    end_time: args.endTimeMs,
    limit: Math.min(args.limit ?? 500, 500),
  };
}

interface DeductionEnvelope {
  readonly code?: number;
  readonly message?: string;
  readonly data?: {
    readonly result?: {
      readonly detail?: ReadonlyArray<Record<string, unknown>>;
      readonly count?: number;
    };
    readonly next_cursor?: string;
    readonly has_more?: boolean;
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** `{ key: value }` when value is present, `{}` when it is not. */
function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseRow(raw: Record<string, unknown>): KlingDeductionRow | undefined {
  const taskId = stringOrUndefined(raw['task_id']);
  const deductionAmount = numberOrUndefined(raw['deduction_amount']);
  // A row with no task id or no amount cannot be attributed or costed. Dropping
  // it is better than a row that reads as a $0 charge against an unknown job.
  if (taskId === undefined || deductionAmount === undefined) return undefined;

  return {
    taskId,
    deductionAmount,
    // find(), not a cast: an unrecognised currency string must become undefined
    // so balanceRowToUsd refuses it, rather than flowing through as if known.
    ...optional('currency', KLING_CURRENCIES.find((c) => c === raw['currency'])),
    ...optional('listPrice', numberOrUndefined(raw['list_price'])),
    ...optional('modelName', stringOrUndefined(raw['model_name'])),
    ...optional('resolution', stringOrUndefined(raw['resolution'])),
    ...optional('durationSec', numberOrUndefined(raw['duration'])),
    ...optional('deductionTimeMs', numberOrUndefined(raw['deduction_time'])),
  };
}

export interface DeductionFetchOptions {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

async function fetchDeductionPage(
  path: string,
  args: DeductionQueryArgs,
  opts: DeductionFetchOptions,
): Promise<DeductionPage> {
  const base = opts.baseUrl ?? KLING_BILLING_BASE;
  const doFetch = opts.fetchImpl ?? fetch;

  const response = await doFetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildDeductionRequestBody(args)),
  });

  if (!response.ok) {
    throw new ApiError(`kling deduction query failed: HTTP ${response.status}`, 'API', {
      provider: 'kling',
      path,
    });
  }

  const envelope = (await response.json()) as DeductionEnvelope;
  // HTTP 200 with a non-zero code is how Kling reports application failures.
  // Treating one as an empty page would under-report spend rather than error.
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    throw new ApiError(
      `kling deduction query returned code ${envelope.code}: ${envelope.message ?? ''}`.trim(),
      'API',
      { provider: 'kling', path },
    );
  }

  return parseDeductionPage(envelope, path);
}

/** Envelope -> page. Split out so the transport above stays one job. */
function parseDeductionPage(envelope: DeductionEnvelope, path: string): DeductionPage {
  const rows: KlingDeductionRow[] = [];
  for (const raw of envelope.data?.result?.detail ?? []) {
    const row = parseRow(raw);
    if (row === undefined) {
      logger.warn('kling deduction: skipping an unparseable row', {
        path,
        keys: Object.keys(raw).join(','),
      });
      continue;
    }
    rows.push(row);
  }

  const nextCursor = envelope.data?.next_cursor;
  return {
    rows,
    ...optional('nextCursor', nextCursor !== undefined && nextCursor.length > 0 ? nextCursor : undefined),
    hasMore: envelope.data?.has_more === true,
  };
}

/** Cash deductions — the only surface that reports a currency. */
export function fetchBalanceDeductions(
  args: DeductionQueryArgs,
  opts: DeductionFetchOptions,
): Promise<DeductionPage> {
  return fetchDeductionPage(KLING_BALANCE_PATH, args, opts);
}

/** Resource-package (unit) deductions. Amounts are units, never currency. */
export function fetchPackageDeductions(
  args: DeductionQueryArgs,
  opts: DeductionFetchOptions,
): Promise<DeductionPage> {
  return fetchDeductionPage(KLING_PACKAGE_PATH, args, opts);
}

/**
 * Converts a cash deduction row to USD.
 *
 * Refuses a non-USD currency rather than applying a rate. There is no FX source
 * in this repo, and a CNY amount silently written into `actual_usd` would be
 * wrong by roughly 7x with a provider number attached — the same failure the
 * charge_type branch in kling-billing.ts exists to prevent, arriving through a
 * different door. The caller is told exactly what it received.
 */
export function balanceRowToUsd(row: KlingDeductionRow): number {
  if (row.currency === undefined) {
    throw new ValidationError(
      `kling balance deduction for task ${row.taskId} reports no currency. The balance ` +
        `endpoint documents one ('USD' or 'CNY'); without it the amount cannot be read as ` +
        `dollars, and guessing would put a confidently wrong actual cost into the ledger.`,
    );
  }
  if (row.currency !== 'USD') {
    throw new ValidationError(
      `kling billed task ${row.taskId} in ${row.currency}, and this build has no exchange ` +
        `rate. Recording ${row.deductionAmount} ${row.currency} as USD would misprice the ` +
        `job. Configure a USD-billed Kling account, or add an explicit conversion with a ` +
        `declared rate — do not let this default.`,
    );
  }
  return row.deductionAmount;
}

/** Unit deductions convert at the documented, single published rate. */
export function packageRowToUsd(row: KlingDeductionRow): number {
  return row.deductionAmount * KLING_USD_PER_UNIT;
}

export interface DeductionAudit {
  /** Every cash deduction in the window. */
  readonly balance: ReadonlyArray<KlingDeductionRow>;
  /** Every unit deduction in the window. */
  readonly units: ReadonlyArray<KlingDeductionRow>;
  /**
   * Currencies actually seen on the cash rows.
   *
   * The reason the audit exists: kling-billing.ts assumes USD on the cash branch
   * and has no field to check it against. Anything other than exactly ['USD']
   * means that assumption is wrong for this account.
   */
  readonly currenciesSeen: ReadonlyArray<string>;
  /** True when every cash row is USD — i.e. the kling-billing assumption holds. */
  readonly usdAssumptionHolds: boolean;
  /** Set when pagination stopped at the page cap with results pending. */
  readonly truncated: boolean;
}

/** Same bound, and the same reason, as reconcileBillingWindow's page cap. */
const MAX_PAGES = 50;

async function drain(
  fetchPage: (args: DeductionQueryArgs, opts: DeductionFetchOptions) => Promise<DeductionPage>,
  args: DeductionQueryArgs,
  opts: DeductionFetchOptions,
): Promise<{ rows: KlingDeductionRow[]; truncated: boolean }> {
  const rows: KlingDeductionRow[] = [];
  let cursor: string | undefined;
  let pages = 0;

  for (;;) {
    const page = await fetchPage(
      { ...args, ...(cursor !== undefined ? { cursor } : {}) },
      opts,
    );
    rows.push(...page.rows);
    pages += 1;

    if (!page.hasMore) return { rows, truncated: false };
    if (page.nextCursor === undefined) {
      // has_more says there is more, but no usable cursor came back. Returning
      // truncated:false here would report a complete audit built on one page —
      // the same silent-success failure the page cap is bounded to avoid.
      logger.warn('kling deduction: has_more is set but no next_cursor was returned', {
        pages,
        rowsSoFar: rows.length,
      });
      return { rows, truncated: true };
    }
    if (pages >= MAX_PAGES) {
      logger.warn('kling deduction: stopped at the page cap with more results pending', {
        pages,
        maxPages: MAX_PAGES,
        rowsSoFar: rows.length,
      });
      return { rows, truncated: true };
    }
    cursor = page.nextCursor;
  }
}

/**
 * Pulls both deduction surfaces for a window and reports what the account was
 * actually charged.
 *
 * Read-only. It never writes to the ledger — this answers "is what we recorded
 * true", and a function that both asks and answers that question would be
 * checking its own work.
 */
export async function auditDeductions(
  args: DeductionQueryArgs,
  opts: DeductionFetchOptions,
): Promise<DeductionAudit> {
  const [balance, units] = await Promise.all([
    drain(fetchBalanceDeductions, args, opts),
    drain(fetchPackageDeductions, args, opts),
  ]);

  const currenciesSeen = [
    ...new Set(balance.rows.map((r) => r.currency).filter((c): c is KlingCurrency => c !== undefined)),
  ];

  return {
    balance: balance.rows,
    units: units.rows,
    currenciesSeen,
    // Every row must CARRY a currency and every one must be USD.
    //
    // Two vacuous truths are excluded here, and both would read as "verified":
    // an empty window (`[].every()` is true), and a window whose rows all omit
    // `currency` (they filter out of currenciesSeen, leaving `[]` — also true).
    // The second is the nastier one: it reports the USD assumption as confirmed
    // having checked nothing, and it suppresses the operator warning in
    // KlingProvider.auditBillingWindow that exists to catch exactly this.
    // balanceRowToUsd already throws on a missing currency; this flag must not
    // disagree with its own sibling.
    usdAssumptionHolds:
      balance.rows.length > 0 && balance.rows.every((r) => r.currency === 'USD'),
    truncated: balance.truncated || units.truncated,
  };
}

export interface OrphanCharge {
  readonly taskId: string;
  readonly usd: number;
  readonly source: 'balance' | 'package';
  readonly modelName?: string;
}

/**
 * Charges Kling made that this install has no ledger row for.
 *
 * This is the detection half of the known post-submit loss: a submit succeeded,
 * the provider started billing, and the ledger write threw before the row
 * existed. Reported, never repaired — the row is missing because writing it
 * failed, and fabricating one would put a job with no local provenance into the
 * cost history.
 *
 * `hasLocalRow` is injected rather than read here so this stays a pure function
 * over the audit. A row can legitimately be absent because the same API key was
 * used from another machine; the caller is the only one who knows which of the
 * two it is looking at, and the doc comment on the MCP tool says so.
 */
export function findOrphanCharges(
  audit: Pick<DeductionAudit, 'balance' | 'units'>,
  hasLocalRow: (taskId: string) => boolean,
): ReadonlyArray<OrphanCharge> {
  const out: OrphanCharge[] = [];

  for (const row of audit.balance) {
    if (hasLocalRow(row.taskId)) continue;
    try {
      out.push({
        taskId: row.taskId,
        usd: balanceRowToUsd(row),
        source: 'balance',
        ...(row.modelName !== undefined ? { modelName: row.modelName } : {}),
      });
    } catch (err) {
      // A charge we cannot price is still a charge with no ledger row, which is
      // the thing worth surfacing. Reporting it at 0 would hide it inside a
      // total, so it is logged and left out of the priced list.
      logger.warn('kling deduction: orphan charge could not be priced', {
        taskId: row.taskId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const row of audit.units) {
    if (hasLocalRow(row.taskId)) continue;
    out.push({
      taskId: row.taskId,
      usd: packageRowToUsd(row),
      source: 'package',
      ...(row.modelName !== undefined ? { modelName: row.modelName } : {}),
    });
  }

  return out;
}
