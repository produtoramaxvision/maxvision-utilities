// tests/unit/billing/stripe-webhook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleStripeWebhook } from '../../../src/billing/stripe-webhook.js';

function deps(constructed: unknown, throws = false) {
  return {
    store: {
      tenantForCustomer: vi.fn(async () => 't1'),
      recordPaymentOnce: vi.fn(async () => true),
      markGranted: vi.fn(async () => {}),
      linkCustomer: vi.fn(async () => {}),
      upsertSubscriptionTier: vi.fn(async () => {}),
      setTenantTier: vi.fn(async () => {}),
    },
    credit: { grant: vi.fn(async () => {}) },
    constructEvent: vi.fn(() => { if (throws) throw new Error('bad sig'); return constructed; }),
  };
}

const checkout = {
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', amount_total: 1990, currency: 'usd', customer: 'cus_1', metadata: { credits: '1500', creditValueUsd: '0.00239' } } },
};

const invoice = (tier: string) => ({
  id: 'evt_inv_1', type: 'invoice.payment_succeeded',
  data: { object: {
    id: 'in_1', customer: 'cus_1', subscription: 'sub_1',
    metadata: { credits: '2500', creditValueUsd: '0.01' },
    subscription_details: { metadata: { tier } },
  } },
});

const subDeleted = {
  id: 'evt_del_1', type: 'customer.subscription.deleted',
  data: { object: { id: 'sub_1', customer: 'cus_1' } },
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

  it('invoice de assinatura (tier=creator) → upsert active + setTenantTier creator', async () => {
    const d = deps(invoice('creator'));
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(r.status).toBe(200);
    expect(d.store.upsertSubscriptionTier).toHaveBeenCalledWith('t1', 'stripe', 'sub_1', 'active', 'creator');
    expect(d.store.setTenantTier).toHaveBeenCalledWith('t1', 'creator', 'stripe:invoice.payment_succeeded');
  });

  it('invoice de assinatura (tier=pro) → resolve pro (não colapsa pra creator)', async () => {
    const d = deps(invoice('pro'));
    await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(d.store.upsertSubscriptionTier).toHaveBeenCalledWith('t1', 'stripe', 'sub_1', 'active', 'pro');
    expect(d.store.setTenantTier).toHaveBeenCalledWith('t1', 'pro', 'stripe:invoice.payment_succeeded');
  });

  it('customer.subscription.deleted → upsert canceled + setTenantTier free, sem grant', async () => {
    const d = deps(subDeleted);
    const r = await handleStripeWebhook({ rawBody: '{}', signature: 'sig' }, d as never);
    expect(r.status).toBe(200);
    expect(d.store.upsertSubscriptionTier).toHaveBeenCalledWith('t1', 'stripe', 'sub_1', 'canceled', 'creator');
    expect(d.store.setTenantTier).toHaveBeenCalledWith('t1', 'free', 'stripe:customer.subscription.deleted');
    expect(d.credit.grant).not.toHaveBeenCalled();
  });
});
