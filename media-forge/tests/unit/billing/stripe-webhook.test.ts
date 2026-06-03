// tests/unit/billing/stripe-webhook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleStripeWebhook } from '../../../src/billing/stripe-webhook.js';

function deps(constructed: unknown, throws = false) {
  return {
    store: { tenantForCustomer: vi.fn(async () => 't1'), recordPaymentOnce: vi.fn(async () => true), markGranted: vi.fn(async () => {}), linkCustomer: vi.fn(async () => {}) },
    credit: { grant: vi.fn(async () => {}) },
    constructEvent: vi.fn(() => { if (throws) throw new Error('bad sig'); return constructed; }),
  };
}

const checkout = {
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', amount_total: 1990, currency: 'usd', customer: 'cus_1', metadata: { credits: '1500', creditValueUsd: '0.00239' } } },
};

describe('handleStripeWebhook', () => {
  it('assinatura inválida → 400, sem grant', async () => {
    const d = deps(checkout, true);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'x' }, d as never);
    expect(r.status).toBe(400);
    expect(d.credit.grant).not.toHaveBeenCalled();
  });

  it('checkout completo → grant idempotente por event.id', async () => {
    const d = deps(checkout);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(r.status).toBe(200);
    expect(d.credit.grant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', amount: 1500, externalId: 'grant-stripe-evt_1' }));
  });

  it('replay do mesmo event.id → não concede', async () => {
    const d = deps(checkout);
    d.store.recordPaymentOnce = vi.fn(async () => false);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(d.credit.grant).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });
});
