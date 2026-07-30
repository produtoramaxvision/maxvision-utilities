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
  buildBillingQuery,
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
// buildBillingQuery
// ---------------------------------------------------------------------------
describe('buildBillingQuery', () => {
  it('without cursor: includes start_time + end_time', () => {
    const q = buildBillingQuery({ startTimeMs: 1000, endTimeMs: 2000 });
    expect(q).toContain('start_time=1000');
    expect(q).toContain('end_time=2000');
  });

  // The docs state start_time/end_time are ignored once cursor is set. Sending
  // all three anyway would let a caller believe a window is still being
  // applied on page 2+ of a paginated pull when it is not — so the params must
  // be genuinely ABSENT, not just superseded server-side.
  it('with cursor: includes cursor and OMITS start_time/end_time entirely', () => {
    const q = buildBillingQuery({ startTimeMs: 1000, endTimeMs: 2000, cursor: 'cur-abc' });
    expect(q).toContain('cursor=cur-abc');
    expect(q).not.toContain('start_time');
    expect(q).not.toContain('end_time');
  });

  it('limit clamps at 500', () => {
    const q = buildBillingQuery({ startTimeMs: 0, endTimeMs: 1, limit: 10000 });
    expect(q).toContain('limit=500');
  });

  it('default limit is 100', () => {
    const q = buildBillingQuery({ startTimeMs: 0, endTimeMs: 1 });
    expect(q).toContain('limit=100');
  });
});

// ---------------------------------------------------------------------------
// fetchTaskBillingPage
// ---------------------------------------------------------------------------
describe('fetchTaskBillingPage', () => {
  const opts = { startTimeMs: 1000, endTimeMs: 2000 };

  it('parses tasks + billing into { taskId, actualUsd, entries }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: [
          { id: 'task-1', billing: [{ charge_type: 'cash', amount: '3' }] },
        ],
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
        data: [
          { id: 'task-bad', billing: [{ charge_type: 'mystery', amount: '5' }] },
          { id: 'task-good', billing: [{ charge_type: 'cash', amount: '2' }] },
        ],
      }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.tasks.map((t) => t.taskId)).toEqual(['task-good']);
  });

  it('tasks with no billing array are skipped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: [
          { id: 'task-no-billing' },
          { id: 'task-empty-billing', billing: [] },
          { id: 'task-with-billing', billing: [{ charge_type: 'cash', amount: '1' }] },
        ],
      }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.tasks.map((t) => t.taskId)).toEqual(['task-with-billing']);
  });

  it('next_cursor / has_more surface correctly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ code: 0, data: [], next_cursor: 'cur-next', has_more: true }),
    );
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.nextCursor).toBe('cur-next');
    expect(page.hasMore).toBe(true);
  });

  it('missing next_cursor / has_more default to absent-cursor and hasMore=false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: [] }));
    const page = await fetchTaskBillingPage(opts, { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(page.nextCursor).toBeUndefined();
    expect(page.hasMore).toBe(false);
  });

  // The Authorization header is the only auth surface this call sends — an
  // extra/alternate scheme (query-string key, Basic auth) would either leak
  // the key somewhere unintended or get silently ignored by Kling.
  it('Authorization header is "Bearer <key>", and no other auth scheme is sent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: [] }));
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
