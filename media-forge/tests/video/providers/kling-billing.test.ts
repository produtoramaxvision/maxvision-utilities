// tests/video/providers/kling-billing.test.ts
// Covers src/video/providers/kling-billing.ts — what Kling ACTUALLY charged,
// read from the provider's billing surfaces. Everything here is pure/injectable
// fetch; no network I/O is ever exercised.
import { describe, it, expect, vi } from 'vitest';
import {
  KLING_USD_PER_UNIT,
  KLING_CHARGE_TYPES,
  chargeToUsd,
  totalChargeUsd,
  buildBillingRequestBody,
  fetchTaskBillingPage,
  fetchAccountCosts,
  compareEstimateToActual,
} from '../../../src/video/providers/kling-billing.js';
import { ApiError, ValidationError } from '../../../src/core/errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// chargeToUsd — the highest-risk function in the module. Reading a 'unit'
// charge as 'cash' (or vice versa) misprices by ~7x, silently, with a provider
// number attached — the exact failure mode the module exists to prevent.
// ---------------------------------------------------------------------------
describe('chargeToUsd', () => {
  it('charge_type "cash" with amount "8" -> 8.00 (string amount parsed)', () => {
    expect(chargeToUsd({ charge_type: 'cash', amount: '8' })).toBe(8);
  });

  it('charge_type "unit" with amount "8" -> 8 * KLING_USD_PER_UNIT (1.12)', () => {
    expect(chargeToUsd({ charge_type: 'unit', amount: '8' })).toBeCloseTo(8 * KLING_USD_PER_UNIT, 10);
    expect(chargeToUsd({ charge_type: 'unit', amount: '8' })).toBeCloseTo(1.12, 10);
  });

  // The whole reason chargeToUsd refuses to guess: reading amount=8 as the
  // wrong charge_type reports $8.00 when the true charge is $1.12 (or the
  // reverse) — a ~7.14x misprice in whichever direction the branch is flipped,
  // and the ledger would look equally authoritative either way because the
  // number came straight from the provider.
  it('cash and unit interpretations of the SAME amount differ (~7x) — proves the branches are not interchangeable', () => {
    const cashUsd = chargeToUsd({ charge_type: 'cash', amount: '8' });
    const unitUsd = chargeToUsd({ charge_type: 'unit', amount: '8' });
    expect(cashUsd).not.toBeCloseTo(unitUsd, 2);
    expect(cashUsd / unitUsd).toBeCloseTo(1 / KLING_USD_PER_UNIT, 5); // ~7.14x
  });

  it('an UNKNOWN charge_type throws, and the message names the known kinds', () => {
    expect(() => chargeToUsd({ charge_type: 'crypto', amount: '5' })).toThrow(ValidationError);
    try {
      chargeToUsd({ charge_type: 'crypto', amount: '5' });
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      for (const kind of KLING_CHARGE_TYPES) {
        expect(msg).toContain(kind);
      }
    }
  });

  it('a missing amount throws', () => {
    expect(() => chargeToUsd({ charge_type: 'cash' })).toThrow(ValidationError);
  });

  it('a non-numeric string amount throws', () => {
    expect(() => chargeToUsd({ charge_type: 'cash', amount: 'not-a-number' })).toThrow(ValidationError);
  });

  it('amount as a NUMBER (not string) works — the API types it loosely', () => {
    expect(chargeToUsd({ charge_type: 'cash', amount: 8 })).toBe(8);
    expect(chargeToUsd({ charge_type: 'unit', amount: 8 })).toBeCloseTo(1.12, 10);
  });
});

// ---------------------------------------------------------------------------
// totalChargeUsd
// ---------------------------------------------------------------------------
describe('totalChargeUsd', () => {
  it('sums multiple entries (mixed cash + unit)', () => {
    const total = totalChargeUsd([
      { charge_type: 'cash', amount: '2' },
      { charge_type: 'unit', amount: '10' },
    ]);
    expect(total).toBeCloseTo(2 + 10 * KLING_USD_PER_UNIT, 10);
  });

  it('empty array -> 0', () => {
    expect(totalChargeUsd([])).toBe(0);
  });

  // One bad entry must make the whole sum throw — a caller that wants partial
  // tolerance (fetchTaskBillingPage) handles that ABOVE this function, by
  // catching the throw per-task rather than swallowing it here.
  it('one bad entry makes the whole sum throw', () => {
    expect(() =>
      totalChargeUsd([
        { charge_type: 'cash', amount: '2' },
        { charge_type: 'mystery', amount: '1' },
      ]),
    ).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// buildBillingRequestBody
//
// The listing form of /tasks is POST-with-a-body, NOT a query string. The
// previous shape here sent GET /tasks?start_time=…&end_time=…&limit=… — which
// the live API answers with HTTP 400 code 1201 "task_ids or external_task_ids
// is required", because GET only accepts task_ids / external_task_ids.
// Source: kling.ai/document-api/api/video/3-0-turbo/image-to-video.md,
// sections "Query Task (By task ID)" (GET) and "Query Task (By Cursor)" (POST).
// ---------------------------------------------------------------------------
describe('buildBillingRequestBody', () => {
  it('without cursor: carries start_time + end_time', () => {
    const b = buildBillingRequestBody({ startTimeMs: 1000, endTimeMs: 2000 });
    expect(b.start_time).toBe(1000);
    expect(b.end_time).toBe(2000);
    expect(b.cursor).toBeUndefined();
  });

  // The docs state start_time/end_time are ignored once cursor is set. Sending
  // all three anyway would let a caller believe a window is still being
  // applied on page 2+ of a paginated pull when it is not — so the fields must
  // be genuinely ABSENT, not just superseded server-side.
  it('with cursor: carries cursor and OMITS start_time/end_time entirely', () => {
    const b = buildBillingRequestBody({ startTimeMs: 1000, endTimeMs: 2000, cursor: 'cur-abc' });
    expect(b.cursor).toBe('cur-abc');
    expect(b).not.toHaveProperty('start_time');
    expect(b).not.toHaveProperty('end_time');
  });

  it('limit clamps at 500', () => {
    const b = buildBillingRequestBody({ startTimeMs: 0, endTimeMs: 1, limit: 10000 });
    expect(b.limit).toBe(500);
  });

  it('default limit is 100', () => {
    const b = buildBillingRequestBody({ startTimeMs: 0, endTimeMs: 1 });
    expect(b.limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// fetchTaskBillingPage
// ---------------------------------------------------------------------------
describe('fetchTaskBillingPage', () => {
  const opts = { startTimeMs: 1000, endTimeMs: 2000 };

  // Guards the defect that made the whole reconciliation dead on arrival:
  // the request went out as GET with a query string, and the live API answers
  // that with HTTP 400 code 1201. Asserting the verb and the body is the only
  // thing an injected-fetch test can do to keep the call shape honest.
  it('issues POST /tasks with the window in the JSON body, not a query string', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 0, data: { result: [], has_more: false } }));
    await fetchTaskBillingPage(opts, {
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://api-singapore.klingai.com/tasks');
    expect(String(url)).not.toContain('?');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      start_time: 1000,
      end_time: 2000,
      limit: 100,
    });
  });

  it('parses tasks + billing into { taskId, actualUsd, entries }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          result: [{ id: 'task-1', billing: [{ charge_type: 'cash', amount: '3' }] }],
          count: 1,
          has_more: false,
        },
      }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.tasks).toEqual([
      { taskId: 'task-1', actualUsd: 3, entries: [{ charge_type: 'cash', amount: '3' }] },
    ]);
  });

  it('non-2xx throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(
      fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(ApiError);
  });

  // Kling reports application-level failures as HTTP 200 + non-zero `code`.
  // Trusting the status line alone would treat an auth/quota refusal as a
  // successful (empty) billing page and silently under-report spend.
  it('HTTP 200 with a NON-ZERO code throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 401, message: 'auth expired' }));
    await expect(
      fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/401/);
  });

  // One unknown charge kind must not block reconciling every other task in
  // the same page/window — it is skipped (with a warning) and the rest of the
  // page still comes back whole.
  it('a task with an UNINTERPRETABLE charge_type is SKIPPED; other tasks in the page still come back', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          result: [
            { id: 'task-bad', billing: [{ charge_type: 'mystery', amount: '5' }] },
            { id: 'task-good', billing: [{ charge_type: 'cash', amount: '2' }] },
          ],
          has_more: false,
        },
      }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.tasks.map((t) => t.taskId)).toEqual(['task-good']);
  });

  it('tasks with no billing array are skipped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          result: [
            { id: 'task-no-billing' },
            { id: 'task-empty-billing', billing: [] },
            { id: 'task-with-billing', billing: [{ charge_type: 'cash', amount: '1' }] },
          ],
          has_more: false,
        },
      }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.tasks.map((t) => t.taskId)).toEqual(['task-with-billing']);
  });

  // next_cursor and has_more live INSIDE data, alongside result — not at the
  // envelope root. Reading them at the root made every page look like the last
  // one, so a multi-page window settled page 1 and reported success.
  it('next_cursor / has_more surface correctly from inside data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: { result: [], count: 0, next_cursor: 'cur-next', has_more: true },
      }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.nextCursor).toBe('cur-next');
    expect(page.hasMore).toBe(true);
  });

  // The live API omits `result` entirely when the window is empty — verified
  // against the real account on 2026-07-30: `data` came back as
  // { count, has_more } with no result key at all.
  it('an empty window (data with no result key) yields no tasks and does not throw', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 0, data: { count: 0, has_more: false } }));
    const page = await fetchTaskBillingPage(opts, {
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(page.tasks).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('missing next_cursor / has_more default to absent-cursor and hasMore=false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: { result: [] } }));
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.nextCursor).toBeUndefined();
    expect(page.hasMore).toBe(false);
  });

  // The Authorization header is the only auth surface this call sends — an
  // extra/alternate scheme (query-string key, Basic auth) would either leak
  // the key somewhere unintended or get silently ignored by Kling.
  it('Authorization header is "Bearer <key>", and no other auth scheme is sent', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 0, data: { result: [], has_more: false } }));
    await fetchTaskBillingPage(opts, { apiKey: 'secret-key-123', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key-123');
    const headerValues = Object.entries(headers)
      .filter(([k]) => k.toLowerCase() !== 'content-type')
      .map(([, v]) => v);
    expect(headerValues).toEqual(['Bearer secret-key-123']);
  });
});

// ---------------------------------------------------------------------------
// fetchAccountCosts
// ---------------------------------------------------------------------------
describe('fetchAccountCosts', () => {
  const opts = { startTimeMs: 1000, endTimeMs: 2000 };

  it('parses resource packs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          resource_pack_subscribe_infos: [
            { resource_pack_name: 'starter', total_quantity: 100, remaining_quantity: 40, status: 'active' },
          ],
        },
      }),
    );
    const result = await fetchAccountCosts(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.packs).toEqual([
      { name: 'starter', totalQuantity: 100, remainingQuantity: 40, status: 'active' },
    ]);
  });

  it('non-2xx throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    await expect(
      fetchAccountCosts(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(ApiError);
  });

  it('non-zero code throws', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 7, message: 'rate limited' }));
    await expect(
      fetchAccountCosts(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/rate limited/);
  });

  // remainingIsDelayed is always true because the docs state remaining
  // quantity lags 12h. Settling an individual job against it would compare a
  // fresh charge to a stale balance and report drift that is not real — the
  // flag exists so no caller can forget that constraint and build a per-job
  // reconciliation on top of this endpoint by mistake.
  it('the return always carries remainingIsDelayed: true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: {} }));
    const result = await fetchAccountCosts(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.remainingIsDelayed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compareEstimateToActual
// ---------------------------------------------------------------------------
describe('compareEstimateToActual', () => {
  it('actual OVER estimate: positive delta, ratio > 1', () => {
    const { deltaUsd, ratio } = compareEstimateToActual({ estimateUsd: 10, actualUsd: 15 });
    expect(deltaUsd).toBe(5);
    expect(ratio).toBe(1.5);
  });

  it('actual UNDER estimate: negative delta, ratio < 1', () => {
    const { deltaUsd, ratio } = compareEstimateToActual({ estimateUsd: 10, actualUsd: 8 });
    expect(deltaUsd).toBe(-2);
    expect(ratio).toBe(0.8);
  });

  it('equal: zero delta, ratio 1', () => {
    const { deltaUsd, ratio } = compareEstimateToActual({ estimateUsd: 10, actualUsd: 10 });
    expect(deltaUsd).toBe(0);
    expect(ratio).toBe(1);
  });

  // A zero estimate would make the ratio (actual/estimate) infinite or NaN —
  // neither is a usable signal for a drift threshold comparison. Reporting 0
  // keeps the return type numeric and lets the delta (which is still correct
  // and non-zero) carry the actual information.
  it('a ZERO estimate yields ratio 0 (not Infinity/NaN); the delta still carries the signal', () => {
    const { deltaUsd, ratio } = compareEstimateToActual({ estimateUsd: 0, actualUsd: 5 });
    expect(ratio).toBe(0);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(Number.isNaN(ratio)).toBe(false);
    expect(deltaUsd).toBe(5);
  });
});
