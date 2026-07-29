// tests/unit/billing/preflight-video-credit.test.ts
// TDD for preflightVideoCredit (media-forge cost guards, Step 4 — video credit
// preflight). Style mirrors tests/unit/billing/debit-wiring.test.ts: exercise
// the exported function directly rather than driving a full JSON-RPC call.
import { describe, it, expect, vi } from 'vitest';
import { preflightVideoCredit, type HandlersDeps } from '../../../src/mcp/handlers.js';
import { InsufficientCreditError, type CreditClient } from '../../../src/billing/credit-client.js';
import { priceCredits, VIDEO_MARKUP, DEFAULT_CREDIT_VALUE_USD } from '../../../src/billing/pricing.js';

function spyClient(balance: number) {
  const balanceFn = vi.fn(async () => balance);
  const client = {
    balance: balanceFn,
    reserve: vi.fn(async () => {}),
    capture: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    grant: vi.fn(async () => {}),
  };
  return { client: client as unknown as CreditClient, balanceFn };
}

describe('preflightVideoCredit', () => {
  it('passes (resolves, no throw) when balance is sufficient', async () => {
    // estimate $0.20 -> credits via VIDEO_MARKUP/DEFAULT_CREDIT_VALUE_USD; give a huge balance.
    const spy = spyClient(1_000_000);
    const deps = { creditClient: spy.client, tenantId: 't1' } as unknown as HandlersDeps;
    await expect(preflightVideoCredit(deps, 0.2)).resolves.toBeUndefined();
    expect(spy.balanceFn).toHaveBeenCalledWith('t1');
  });

  it('throws InsufficientCreditError when balance is below the estimate', async () => {
    const spy = spyClient(1); // far below what a $0.20 estimate costs in credits
    const deps = { creditClient: spy.client, tenantId: 't1' } as unknown as HandlersDeps;
    await expect(preflightVideoCredit(deps, 0.2)).rejects.toBeInstanceOf(InsufficientCreditError);
  });

  it('the thrown error carries the actual balance (actionable message)', async () => {
    const spy = spyClient(5);
    const deps = { creditClient: spy.client, tenantId: 't1' } as unknown as HandlersDeps;
    try {
      await preflightVideoCredit(deps, 0.2);
      expect.unreachable('expected preflightVideoCredit to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientCreditError);
      const e = err as InsufficientCreditError;
      expect(e.balance).toBe(5);
      expect(e.tenantId).toBe('t1');
      const expectedCredits = priceCredits({ costUsd: 0.2, markup: VIDEO_MARKUP, creditValueUsd: DEFAULT_CREDIT_VALUE_USD });
      expect(e.amount).toBe(expectedCredits);
      expect(e.message).toContain('5');
      expect(e.message).toContain('top up');
    }
  });

  it('is a no-op when creditClient is absent (billing off / self-host)', async () => {
    const deps = { tenantId: 't1' } as unknown as HandlersDeps;
    await expect(preflightVideoCredit(deps, 0.2)).resolves.toBeUndefined();
  });

  it('is a no-op when tenantId is absent (both required, same guard as siblings)', async () => {
    const spy = spyClient(0);
    const deps = { creditClient: spy.client } as unknown as HandlersDeps;
    await expect(preflightVideoCredit(deps, 0.2)).resolves.toBeUndefined();
    expect(spy.balanceFn).not.toHaveBeenCalled();
  });
});
