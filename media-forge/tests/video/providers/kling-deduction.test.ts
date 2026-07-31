// tests/video/providers/kling-deduction.test.ts
// Covers src/video/providers/kling-deduction.ts (the account-wide deduction audit
// surface: POST /account/billing/balance + POST /account/billing/package) and
// KlingProvider.auditBillingWindow (src/video/providers/kling.ts).
//
// Fixtures below are built field-for-field from the "Response Example" JSON in
// the locally saved docs (billing-balance.md, billing-package.md), NOT from
// reading kling-deduction.ts and matching what it parses. The two ARE allowed to
// disagree — see the DISCREPANCY / BUG comments below for the places they do.
// Everything here is pure/injectable fetch or a real temp sqlite db; no network
// I/O is ever exercised.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDeductionRequestBody,
  fetchBalanceDeductions,
  fetchPackageDeductions,
  balanceRowToUsd,
  packageRowToUsd,
  auditDeductions,
  findOrphanCharges,
  KLING_BALANCE_PATH,
  KLING_PACKAGE_PATH,
  type KlingDeductionRow,
} from '../../../src/video/providers/kling-deduction.js';
import { KLING_USD_PER_UNIT } from '../../../src/video/providers/kling-billing.js';
import { ApiError, ValidationError } from '../../../src/core/errors.js';
import { closeDb } from '../../../src/core/db.js';
import { recordJob } from '../../../src/core/cost-tracker.js';
import { KlingProvider } from '../../../src/video/providers/kling.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Envelope shape per both docs: code/message/request_id/data.result.{detail,count}/next_cursor/has_more. */
function envelopeWith(
  rows: ReadonlyArray<Record<string, unknown>>,
  extra?: { nextCursor?: string; hasMore?: boolean },
): unknown {
  return {
    code: 0,
    message: '',
    request_id: 'req-test',
    data: {
      result: { detail: rows, count: rows.length },
      next_cursor: extra?.nextCursor ?? '',
      has_more: extra?.hasMore ?? false,
    },
  };
}

// Field-for-field from billing-balance.md's Response Example. "string" placeholders
// are replaced with real documented enum values (currency's placeholder is literally
// "string", which is NOT in the USD/CNY enum — copying it verbatim would silently
// drop the field and prove nothing about parsing it).
const DOC_BALANCE_ROW: Record<string, unknown> = {
  task_id: 'task-doc-1',
  api_key_name: 'my-key',
  product_function: 'Image to Video',
  model_name: 'kling-v2.5-turbo',
  resolution: '1080p',
  duration: '5.04', // documented as a STRING, not a number
  refer_video_input: true,
  video_sound: 'native',
  voice_control: false,
  deduction_time: '1779549455861', // documented as a STRING
  balance_before_deduction: 13037.3,
  deduction_amount: 5.0,
  balance_after_deduction: 13032.3,
  list_price: 5.0,
  currency: 'USD',
};

// Field-for-field from billing-package.md's Response Example. No currency field
// exists on this surface at all — units have no currency, per the source's own
// KlingDeductionRow doc comment.
const DOC_PACKAGE_ROW: Record<string, unknown> = {
  package_id: 'pkg-doc-1',
  product_type: 'video',
  task_id: 'task-doc-pkg-1',
  api_key_name: 'my-key',
  product_function: 'Image to Video',
  model_name: 'kling-v2.5-turbo',
  resolution: '1080p',
  duration: '5.04',
  refer_video_input: true,
  video_sound: 'native',
  voice_control: false,
  deduction_time: '1779549455861',
  unit_before_deduction: 13037.3,
  deduction_amount: 5.0,
  unit_after_deduction: 13032.3,
};

// ---------------------------------------------------------------------------
// buildDeductionRequestBody
// ---------------------------------------------------------------------------
describe('buildDeductionRequestBody', () => {
  it('without cursor: carries start_time + end_time + this endpoint’s default limit', () => {
    const b = buildDeductionRequestBody({ startTimeMs: 1000, endTimeMs: 2000 });
    expect(b.start_time).toBe(1000);
    expect(b.end_time).toBe(2000);
    expect(b.cursor).toBeUndefined();
    // 500, not /tasks' 100 — the deduction docs give this endpoint its own default.
    expect(b.limit).toBe(500);
  });

  // Both docs state the cursor "overrides all other parameters (start_time,
  // end_time, filters, limit)". Sending the window alongside it would let a
  // caller believe a window still applies on page 2+ when the server ignores it.
  it('with cursor: carries cursor and OMITS start_time/end_time entirely', () => {
    const b = buildDeductionRequestBody({ startTimeMs: 1000, endTimeMs: 2000, cursor: 'cur-abc' });
    expect(b.cursor).toBe('cur-abc');
    expect(b).not.toHaveProperty('start_time');
    expect(b).not.toHaveProperty('end_time');
  });

  // The deduction docs give `limit` the IDENTICAL "invalid when cursor is set"
  // note as start_time/end_time, and the cursor note names it explicitly:
  // "overrides all other parameters (start_time, end_time, filters, limit)".
  // /tasks does NOT say that about limit, which is exactly why these two builders
  // are separate functions despite looking alike.
  it('with cursor: limit is omitted too, not just the window', () => {
    const b = buildDeductionRequestBody({ startTimeMs: 1000, endTimeMs: 2000, cursor: 'cur-abc' });
    expect(b).not.toHaveProperty('limit');
  });

  it('limit clamps at 500', () => {
    const b = buildDeductionRequestBody({ startTimeMs: 0, endTimeMs: 1, limit: 10000 });
    expect(b.limit).toBe(500);
  });

  // 500 is what THIS endpoint documents as its default. Inheriting /tasks' 100
  // would silently quintuple the number of round trips an audit needs.
  it('default limit is 500', () => {
    const b = buildDeductionRequestBody({ startTimeMs: 0, endTimeMs: 1 });
    expect(b.limit).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// fetchBalanceDeductions / fetchPackageDeductions — verb, path, auth, envelope
// ---------------------------------------------------------------------------
describe('fetchBalanceDeductions / fetchPackageDeductions', () => {
  const args = { startTimeMs: 1000, endTimeMs: 2000 };

  it('fetchBalanceDeductions issues POST /account/billing/balance', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([])));
    await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`https://api-singapore.klingai.com${KLING_BALANCE_PATH}`);
    expect(init.method).toBe('POST');
  });

  it('fetchPackageDeductions issues POST /account/billing/package', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([])));
    await fetchPackageDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`https://api-singapore.klingai.com${KLING_PACKAGE_PATH}`);
    expect(init.method).toBe('POST');
  });

  it('Authorization header is "Bearer <key>", and the body is JSON matching the request builder', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([])));
    await fetchBalanceDeductions(args, {
      apiKey: 'secret-key-1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key-1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ start_time: 1000, end_time: 2000, limit: 500 });
  });

  it('non-2xx throws ApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(
      fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(ApiError);
  });

  // Kling reports application-level failures as HTTP 200 + non-zero `code` — the
  // same contract as /tasks billing. Trusting the status line alone would read an
  // auth/quota refusal as an empty (successful) deduction page and under-report
  // the account's true spend.
  it('HTTP 200 with a non-zero code throws ApiError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 401, message: 'auth expired' }));
    await expect(
      fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/401/);
  });

  it('same non-2xx / non-zero-code contract holds for the package surface', async () => {
    const fetchImplHttp = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    await expect(
      fetchPackageDeductions(args, { apiKey: 'k', fetchImpl: fetchImplHttp as unknown as typeof fetch }),
    ).rejects.toThrow(ApiError);

    const fetchImplCode = vi.fn().mockResolvedValue(jsonResponse({ code: 7, message: 'rate limited' }));
    await expect(
      fetchPackageDeductions(args, { apiKey: 'k', fetchImpl: fetchImplCode as unknown as typeof fetch }),
    ).rejects.toThrow(/rate limited/);
  });
});

// ---------------------------------------------------------------------------
// Row parsing — built from the doc fixtures above, not from the parser's own logic
// ---------------------------------------------------------------------------
describe('row parsing', () => {
  const args = { startTimeMs: 1000, endTimeMs: 2000 };

  it('a full doc-shaped BALANCE row parses every field the source consumes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([DOC_BALANCE_ROW])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(page.rows).toEqual([
      {
        taskId: 'task-doc-1',
        deductionAmount: 5.0,
        currency: 'USD',
        listPrice: 5.0,
        modelName: 'kling-v2.5-turbo',
        resolution: '1080p',
        durationSec: 5.04,
        deductionTimeMs: 1779549455861,
      },
    ]);
  });

  it('a full doc-shaped PACKAGE row parses the same way — no currency on this surface', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([DOC_PACKAGE_ROW])));
    const page = await fetchPackageDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(page.rows).toEqual([
      {
        taskId: 'task-doc-pkg-1',
        deductionAmount: 5.0,
        modelName: 'kling-v2.5-turbo',
        resolution: '1080p',
        durationSec: 5.04,
        deductionTimeMs: 1779549455861,
      },
    ]);
  });

  // A row with no task id or no amount cannot be attributed or costed. Returning
  // it as a $0 charge against an unknown job would understate spend while
  // looking like a real, priced row.
  it('a row missing task_id is skipped, not returned as a zero-cost row', async () => {
    const { task_id: _drop, ...rowWithoutTaskId } = DOC_BALANCE_ROW;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([rowWithoutTaskId])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.rows).toEqual([]);
  });

  it('a row missing deduction_amount is skipped, not returned as a zero-cost row', async () => {
    const { deduction_amount: _drop, ...rowWithoutAmount } = DOC_BALANCE_ROW;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([rowWithoutAmount])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.rows).toEqual([]);
  });

  it('optional fields absent from the raw row are genuinely absent from the row, not undefined placeholders', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(envelopeWith([{ task_id: 'bare-task', deduction_amount: 1 }])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(page.rows).toHaveLength(1);
    const row = page.rows[0]!;
    expect(row).toEqual({ taskId: 'bare-task', deductionAmount: 1 });
    expect(row).not.toHaveProperty('currency');
    expect(row).not.toHaveProperty('listPrice');
    expect(row).not.toHaveProperty('modelName');
    expect(row).not.toHaveProperty('resolution');
    expect(row).not.toHaveProperty('durationSec');
    expect(row).not.toHaveProperty('deductionTimeMs');
  });

  // The documented enum is exactly USD/CNY. A value outside it must not be kept
  // as-is (which would let a garbage string flow into balanceRowToUsd's
  // currency !== 'USD' branch looking like a legitimate, checked value) — it has
  // to come back genuinely absent, so callers get the "no currency" refusal
  // instead of a confusing "CNY-shaped" one.
  it('a currency outside the documented enum (USD, CNY) is dropped, not coerced', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(envelopeWith([{ ...DOC_BALANCE_ROW, currency: 'EUR' }])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.rows[0]!.currency).toBeUndefined();
  });

  it('currency CNY (the documented alternative to USD) passes through unchanged', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(envelopeWith([{ ...DOC_BALANCE_ROW, currency: 'CNY' }])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.rows[0]!.currency).toBe('CNY');
  });

  // DOCSTRING OVERCLAIM (src/video/providers/kling-deduction.ts:13-20): the
  // module's own header comment lists "balance_before/after — an independent
  // check on the arithmetic" as one of three things this file carries that
  // `/tasks` billing[] does not. Neither balance_before_deduction nor
  // balance_after_deduction (nor the package endpoint's unit_before_deduction /
  // unit_after_deduction) is read anywhere in parseRow, and KlingDeductionRow has
  // no field for either — no arithmetic check is actually performed. Pinned here
  // so the claim in the header comment doesn't quietly get assumed true.
  it('balance_before_deduction / balance_after_deduction are documented but never surface on the parsed row', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(envelopeWith([DOC_BALANCE_ROW])));
    const page = await fetchBalanceDeductions(args, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.rows[0]).not.toHaveProperty('balanceBeforeDeduction');
    expect(page.rows[0]).not.toHaveProperty('balanceAfterDeduction');
  });
});

// ---------------------------------------------------------------------------
// balanceRowToUsd — the highest-risk function in the module. A CNY row read as
// USD misprices by ~7x (1 / KLING_USD_PER_UNIT), silently, with a provider
// number attached.
// ---------------------------------------------------------------------------
describe('balanceRowToUsd', () => {
  it('USD passes through unchanged', () => {
    const row: KlingDeductionRow = { taskId: 't1', deductionAmount: 5, currency: 'USD' };
    expect(balanceRowToUsd(row)).toBe(5);
  });

  it('CNY throws ValidationError rather than silently pricing at face value', () => {
    const row: KlingDeductionRow = { taskId: 't2', deductionAmount: 35, currency: 'CNY' };
    expect(() => balanceRowToUsd(row)).toThrow(ValidationError);
  });

  it('a missing currency throws ValidationError — absence is not evidence of USD', () => {
    const row: KlingDeductionRow = { taskId: 't3', deductionAmount: 5 };
    expect(() => balanceRowToUsd(row)).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// packageRowToUsd
// ---------------------------------------------------------------------------
describe('packageRowToUsd', () => {
  it('multiplies by KLING_USD_PER_UNIT', () => {
    const row: KlingDeductionRow = { taskId: 't1', deductionAmount: 10 };
    expect(packageRowToUsd(row)).toBeCloseTo(10 * KLING_USD_PER_UNIT, 10);
    expect(packageRowToUsd(row)).toBeCloseTo(1.4, 10);
  });
});

// ---------------------------------------------------------------------------
// auditDeductions — drains both surfaces under Promise.all. Routed by URL below
// because a single mockResolvedValueOnce chain would interleave nondeterministically
// across the two concurrent surfaces.
// ---------------------------------------------------------------------------
describe('auditDeductions', () => {
  it('drains both surfaces (balance + package) in one pass', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        return jsonResponse(envelopeWith([{ task_id: 'bal-1', deduction_amount: 5, currency: 'USD' }]));
      }
      return jsonResponse(envelopeWith([{ task_id: 'pkg-1', deduction_amount: 10 }]));
    }) as unknown as typeof fetch;

    const audit = await auditDeductions({ startTimeMs: 0, endTimeMs: 1000 }, { apiKey: 'k', fetchImpl });
    expect(audit.balance.map((r) => r.taskId)).toEqual(['bal-1']);
    expect(audit.units.map((r) => r.taskId)).toEqual(['pkg-1']);
  });

  it('follows next_cursor, so a window larger than one page is fully drained', async () => {
    let balanceCalls = 0;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        balanceCalls += 1;
        if (balanceCalls === 1) {
          expect(body.cursor).toBeUndefined();
          return jsonResponse(
            envelopeWith([{ task_id: 'bal-p1', deduction_amount: 1, currency: 'USD' }], {
              nextCursor: 'CUR-2',
              hasMore: true,
            }),
          );
        }
        // Second page must be requested BY CURSOR, with the window dropped.
        expect(body.cursor).toBe('CUR-2');
        expect(body).not.toHaveProperty('start_time');
        return jsonResponse(envelopeWith([{ task_id: 'bal-p2', deduction_amount: 2, currency: 'USD' }]));
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const audit = await auditDeductions({ startTimeMs: 1, endTimeMs: 2 }, { apiKey: 'k', fetchImpl });
    expect(audit.balance.map((r) => r.taskId)).toEqual(['bal-p1', 'bal-p2']);
    expect(balanceCalls).toBe(2);
  });

  // Isolated to the balance surface only (package returns one page) so the
  // assertion is unambiguous: exactly 50 calls, not an off-by-one either side of
  // the cap.
  it('reports truncated at the 50-page cap on a surface that never stops paginating', async () => {
    let balanceCalls = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        balanceCalls += 1;
        return jsonResponse(
          envelopeWith([{ task_id: `bal-${balanceCalls}`, deduction_amount: 1, currency: 'USD' }], {
            nextCursor: 'more',
            hasMore: true,
          }),
        );
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const audit = await auditDeductions({ startTimeMs: 0, endTimeMs: 1 }, { apiKey: 'k', fetchImpl });
    expect(balanceCalls).toBe(50);
    expect(audit.balance).toHaveLength(50);
    expect(audit.truncated).toBe(true);
  });

  // has_more set with no usable cursor. Treating that as "done" would report a
  // complete audit built on a single page — the same silent-success the page cap
  // exists to prevent, arriving through a different door. An empty-string
  // next_cursor normalises to undefined upstream, so this is the shape a real
  // response would take.
  it('has_more with an empty next_cursor reports truncated, not a clean finish', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        return jsonResponse(
          envelopeWith([{ task_id: 'bal-1', deduction_amount: 1, currency: 'USD' }], {
            nextCursor: '',
            hasMore: true,
          }),
        );
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const audit = await auditDeductions({ startTimeMs: 0, endTimeMs: 1 }, { apiKey: 'k', fetchImpl });
    expect(audit.balance).toHaveLength(1);
    expect(audit.truncated).toBe(true);
  });

  // Zero rows prove nothing either way — reporting "verified USD" off an empty
  // window is how an untested assumption gets promoted to a confirmed one.
  it('usdAssumptionHolds is FALSE for an empty window', async () => {
    const fetchImpl = (async () => jsonResponse(envelopeWith([]))) as unknown as typeof fetch;
    const audit = await auditDeductions({ startTimeMs: 0, endTimeMs: 1 }, { apiKey: 'k', fetchImpl });
    expect(audit.balance).toEqual([]);
    expect(audit.usdAssumptionHolds).toBe(false);
  });

  // The second vacuous truth, and the nastier one. currenciesSeen filters OUT
  // rows with no currency, so a page whose rows ALL lack `currency` yields
  // currenciesSeen = [] — and `[].every(...)` is true. Combined with
  // rows.length > 0 that once reported the USD assumption as HELD having checked
  // nothing, and it suppressed the operator warning in
  // KlingProvider.auditBillingWindow that exists to catch exactly this case.
  // balanceRowToUsd throws on a missing currency; this flag must agree with it.
  it('usdAssumptionHolds is FALSE when balance rows exist but none report a currency', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        return jsonResponse(envelopeWith([{ task_id: 'no-currency-1', deduction_amount: 5 }]));
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const audit = await auditDeductions({ startTimeMs: 0, endTimeMs: 1 }, { apiKey: 'k', fetchImpl });
    expect(audit.balance).toHaveLength(1);
    expect(audit.currenciesSeen).toEqual([]);
    expect(audit.usdAssumptionHolds).toBe(false);
  });

  // The inverse, so the flag cannot be satisfied by simply always returning false.
  it('usdAssumptionHolds is TRUE when every balance row reports USD', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        return jsonResponse(
          envelopeWith([{ task_id: 'usd-1', deduction_amount: 5, currency: 'USD' }]),
        );
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const audit = await auditDeductions({ startTimeMs: 0, endTimeMs: 1 }, { apiKey: 'k', fetchImpl });
    expect(audit.usdAssumptionHolds).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findOrphanCharges — pure function over an audit + a hasLocalRow predicate.
// No fetch involved.
// ---------------------------------------------------------------------------
describe('findOrphanCharges', () => {
  const audit = {
    balance: [
      { taskId: 'billed-no-row', deductionAmount: 5, currency: 'USD' } as KlingDeductionRow,
      { taskId: 'billed-has-row', deductionAmount: 3, currency: 'USD' } as KlingDeductionRow,
      { taskId: 'billed-cny', deductionAmount: 35, currency: 'CNY' } as KlingDeductionRow,
    ],
    units: [{ taskId: 'unit-no-row', deductionAmount: 10 } as KlingDeductionRow],
  };
  const hasLocalRow = (taskId: string) => taskId === 'billed-has-row';

  it('a billed task with no local row is reported (both balance and package sources)', () => {
    const orphans = findOrphanCharges(audit, hasLocalRow);
    expect(orphans.map((o) => o.taskId).sort()).toEqual(['billed-no-row', 'unit-no-row']);
  });

  it('a billed task WITH a local row is not reported', () => {
    const orphans = findOrphanCharges(audit, hasLocalRow);
    expect(orphans.find((o) => o.taskId === 'billed-has-row')).toBeUndefined();
  });

  // A CNY row can't be priced without an FX rate (balanceRowToUsd throws).
  // Reporting it at usd: 0 would make an unpriced charge look like a free one —
  // it must be excluded from the priced list, not zeroed.
  it('an unpriceable (CNY) orphan is excluded from the priced list, not reported at 0', () => {
    const orphans = findOrphanCharges(audit, () => false);
    expect(orphans.find((o) => o.taskId === 'billed-cny')).toBeUndefined();
    expect(orphans.some((o) => o.usd === 0)).toBe(false);
  });

  it('sources are tagged correctly (balance vs package)', () => {
    const orphans = findOrphanCharges(audit, () => false);
    expect(orphans.find((o) => o.taskId === 'billed-no-row')?.source).toBe('balance');
    expect(orphans.find((o) => o.taskId === 'unit-no-row')?.source).toBe('package');
  });
});

// ---------------------------------------------------------------------------
// KlingProvider.auditBillingWindow — wires the above into the real sqlite db.
// Follows the temp-dir / real recordJob / closeDb pattern from
// kling-reconcile.test.ts. fetchImpl is always injected — no network I/O.
// ---------------------------------------------------------------------------
describe('KlingProvider.auditBillingWindow', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-deduction-audit-'));
    dbPath = join(tmpDir, 'cost.db');
  });

  afterEach(() => {
    try {
      closeDb(dbPath);
    } catch {
      /* ignore — handle may already be closed */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM straggler — ignore */
    }
  });

  // The deduction endpoints are API 2.0 only, which accepts API-key auth
  // exclusively — a legacy AccessKey/SecretKey env has nothing this call can
  // use, so it must refuse loudly and name the missing var.
  it('throws when KLING_API_KEY is unset, naming it', async () => {
    const provider = new KlingProvider({ dbPath, env: {} });
    await expect(
      provider.auditBillingWindow({ startTimeMs: 0, endTimeMs: 1000 }),
    ).rejects.toThrow(/KLING_API_KEY/);
  });

  it('wires orphan detection to the real sqlite db: a billed task with a local row is not an orphan, one without is', async () => {
    recordJob({
      dbPath,
      jobId: 'job-owned',
      provider: 'kling',
      model: 'kling-v3-standard',
      mode: 't2v',
      paramsHash: 'hash-owned',
      estUsd: 1,
      nativeTaskId: 'task-owned',
    });

    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        return jsonResponse(
          envelopeWith([
            { task_id: 'task-owned', deduction_amount: 2, currency: 'USD' },
            { task_id: 'task-orphan', deduction_amount: 3, currency: 'USD' },
          ]),
        );
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const provider = new KlingProvider({ dbPath, env: { KLING_API_KEY: 'ak-test' } });
    const result = await provider.auditBillingWindow({ startTimeMs: 0, endTimeMs: 1000, fetchImpl });

    expect(result.orphans.map((o) => o.taskId)).toEqual(['task-orphan']);
    expect(result.orphans.find((o) => o.taskId === 'task-owned')).toBeUndefined();
  });

  it('an unpriceable (CNY) orphan is logged and excluded, not reported at $0, through the real provider path', async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).endsWith(KLING_BALANCE_PATH)) {
        return jsonResponse(envelopeWith([{ task_id: 'task-cny-orphan', deduction_amount: 35, currency: 'CNY' }]));
      }
      return jsonResponse(envelopeWith([]));
    }) as unknown as typeof fetch;

    const provider = new KlingProvider({ dbPath, env: { KLING_API_KEY: 'ak-test' } });
    const result = await provider.auditBillingWindow({ startTimeMs: 0, endTimeMs: 1000, fetchImpl });

    expect(result.orphans.find((o) => o.taskId === 'task-cny-orphan')).toBeUndefined();
    expect(result.orphans.some((o) => o.usd === 0)).toBe(false);
  });

  // One task can be billed on BOTH surfaces — part cash, part units — which is
  // why totalChargeUsd sums an array in the first place. Reported per surface,
  // one orphan read as two, and the count is the first thing an operator looks
  // at when deciding whether money went missing.
  it('a task billed on BOTH surfaces is ONE orphan, with the amounts summed', () => {
    const both = {
      balance: [{ taskId: 'split-task', deductionAmount: 2, currency: 'USD' } as KlingDeductionRow],
      units: [{ taskId: 'split-task', deductionAmount: 10 } as KlingDeductionRow],
    };
    const orphans = findOrphanCharges(both, () => false);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.taskId).toBe('split-task');
    expect(orphans[0]!.usd).toBeCloseTo(2 + 10 * 0.14, 6);
    // Naming only one surface would be wrong — which one it came from is the
    // operator's next question.
    expect(orphans[0]!.source).toBe('both');
  });
});
