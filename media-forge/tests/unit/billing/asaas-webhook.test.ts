// tests/unit/billing/asaas-webhook.test.ts
import { describe, it, expect, vi } from 'vitest';
import { handleAsaasWebhook } from '../../../src/billing/asaas-webhook.js';

function deps() {
  return {
    store: {
      tenantForCustomer: vi.fn(async () => 't1'),
      recordPaymentOnce: vi.fn(async () => true),
      markGranted: vi.fn(async () => {}),
    },
    credit: { grant: vi.fn(async () => {}) },
    webhookToken: 'secret-token',
  };
}

const packEvent = {
  event: 'PAYMENT_CONFIRMED',
  payment: { id: 'pay_1', value: 19.9, billingType: 'PIX', customer: 'cus_1' },
};

describe('handleAsaasWebhook', () => {
  it('token inválido → 401, sem grant', async () => {
    const d = deps();
    const r = await handleAsaasWebhook({ token: 'wrong', body: packEvent }, d as never);
    expect(r.status).toBe(401);
    expect(d.credit.grant).not.toHaveBeenCalled();
  });

  it('pack confirmado → grant idempotente + markGranted', async () => {
    const d = deps();
    const r = await handleAsaasWebhook({ token: 'secret-token', body: packEvent }, d as never);
    expect(r.status).toBe(200);
    expect(d.credit.grant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', amount: 1500, externalId: 'grant-asaas-pay_1' }));
    expect(d.store.markGranted).toHaveBeenCalled();
  });

  it('replay do mesmo payment.id → NÃO concede de novo', async () => {
    const d = deps();
    d.store.recordPaymentOnce = vi.fn(async () => false); // já visto
    const r = await handleAsaasWebhook({ token: 'secret-token', body: packEvent }, d as never);
    expect(r.status).toBe(200);
    expect(d.credit.grant).not.toHaveBeenCalled();
  });

  it('evento não-pagamento → 200 ignorado', async () => {
    const d = deps();
    const r = await handleAsaasWebhook({ token: 'secret-token', body: { event: 'PAYMENT_CREATED', payment: { id: 'x', value: 19.9, customer: 'c' } } }, d as never);
    expect(d.credit.grant).not.toHaveBeenCalled();
    expect(r.status).toBe(200);
  });
});
