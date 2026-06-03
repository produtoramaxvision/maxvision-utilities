// tests/unit/billing/debit-wiring.test.ts
// Wiring test for the F-E debit integration in the MCP handlers (Task 5 Step 5).
//
// We exercise `withImageDebit` directly (exported from handlers.ts) rather than
// driving a full JSON-RPC tool call. Reason: `GenerateImageResult` has no
// `actualCostUSD` field, so a real image tool always captures at the ESTIMATE
// (which is exact — image cost is deterministic per size). To prove assertion
// (b) — capture uses the REAL cost, not the estimate — we need an `exec` that
// returns a DISTINCT `actualCostUSD`. Driving withImageDebit directly is the
// only way that branch is observable. The contract wiring (buildServer →
// registerAllTools → creditClient) is covered by typecheck + the no-op suite.
import { describe, it, expect, vi } from 'vitest';
import { withImageDebit, type HandlersDeps } from '../../../src/mcp/handlers.js';
import type { CreditClient } from '../../../src/billing/credit-client.js';

/** Spy CreditClient — records call ORDER across reserve/capture/release so we can
 *  assert reserve fires BEFORE the generation and capture AFTER. */
function spyClient() {
  const calls: string[] = [];
  const reserve = vi.fn(async () => {
    calls.push('reserve');
  });
  const capture = vi.fn(async () => {
    calls.push('capture');
  });
  const release = vi.fn(async () => {
    calls.push('release');
  });
  const client = { reserve, capture, release, balance: vi.fn(async () => 1000), grant: vi.fn(async () => {}) };
  return { client: client as unknown as CreditClient, calls, reserve, capture, release };
}

describe('debit wiring — withImageDebit', () => {
  it('(a) reserve fires BEFORE the generation; (b) capture fires with the REAL cost (not the estimate)', async () => {
    const spy = spyClient();
    const deps = { creditClient: spy.client, tenantId: 't1' } as unknown as HandlersDeps;

    // estimate $0.20 → 200 credits (markup 10 / creditValue 0.01).
    // REAL cost $0.134 (returned by exec via actualCostUSD) → 134 credits.
    // `spy.calls` records reserve/capture order; `order` interleaves the exec marker.
    const order: string[] = [];
    spy.reserve.mockImplementation(async () => {
      spy.calls.push('reserve');
      order.push('reserve');
    });

    const result = await withImageDebit(deps, 'JOB-IMG-1', 0.2, async () => {
      // The generation itself — must run AFTER reserve.
      order.push('exec');
      return { base64: 'data', actualCostUSD: 0.134 };
    });

    // result passes through unchanged
    expect(result).toEqual({ base64: 'data', actualCostUSD: 0.134 });

    // (a) reserve BEFORE the generation
    expect(order).toEqual(['reserve', 'exec']);
    expect(spy.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', reservationId: 'JOB-IMG-1', externalId: 'res-JOB-IMG-1', amount: 200 }),
    );

    // (b) capture with the REAL cost (134), NOT the estimate (200)
    expect(spy.capture).toHaveBeenCalledTimes(1);
    expect(spy.capture).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', reservationId: 'JOB-IMG-1', externalId: 'cap-JOB-IMG-1', amount: 134 }),
    );
    // capture amount must differ from the estimate-derived credits (200)
    const captureArg = spy.capture.mock.calls[0]![0] as { amount: number };
    expect(captureArg.amount).not.toBe(200);

    // and capture came AFTER the generation
    expect(spy.calls).toEqual(['reserve', 'capture']);
  });

  it('(c) NO creditClient => zero billing calls (self-host no-op passthrough)', async () => {
    const spy = spyClient();
    // deps WITHOUT creditClient — the no-op invariant (first line of withImageDebit).
    const deps = { tenantId: 't1' } as unknown as HandlersDeps;

    let execRan = false;
    const result = await withImageDebit(deps, 'JOB-IMG-2', 0.2, async () => {
      execRan = true;
      return { base64: 'data', actualCostUSD: 0.134 };
    });

    expect(execRan).toBe(true);
    expect(result).toEqual({ base64: 'data', actualCostUSD: 0.134 });
    // zero billing calls
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
    expect(spy.release).not.toHaveBeenCalled();
  });

  it('(c2) creditClient present but NO tenantId => still no-op (both required)', async () => {
    const spy = spyClient();
    const deps = { creditClient: spy.client } as unknown as HandlersDeps;

    const result = await withImageDebit(deps, 'JOB-IMG-3', 0.2, async () => ({
      base64: 'data',
      actualCostUSD: 0.134,
    }));

    expect(result).toEqual({ base64: 'data', actualCostUSD: 0.134 });
    expect(spy.reserve).not.toHaveBeenCalled();
    expect(spy.capture).not.toHaveBeenCalled();
  });
});
