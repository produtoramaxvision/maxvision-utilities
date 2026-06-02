// credit-core/tests/http.test.ts
import { describe, it, expect } from 'vitest';
import { buildCreditApp } from '../src/http.js';
import { InsufficientBalanceError } from '../src/store.js';

const fakeSvc = {
  balance: async () => 0,
  reserve: async () => { throw new InsufficientBalanceError('t', 10); },
} as never;

describe('credit http', () => {
  it('health sem auth → 200', async () => {
    const app = buildCreditApp(fakeSvc, { apiKeys: ['k'] });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('sem auth → 401', async () => {
    const app = buildCreditApp(fakeSvc, { apiKeys: ['k'] });
    expect((await app.request('/balance/t')).status).toBe(401);
  });

  it('reserve sem saldo → 402', async () => {
    const app = buildCreditApp(fakeSvc, { apiKeys: ['k'] });
    const res = await app.request('/reserve', { method: 'POST', headers: { Authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 't', amount: 10, reservationId: 'R', ttlAt: '2030-01-01T00:00:00Z', externalId: 'e' }) });
    expect(res.status).toBe(402);
  });

  it('reserve com payload inválido → 400', async () => {
    const app = buildCreditApp(fakeSvc, { apiKeys: ['k'] });
    const res = await app.request('/reserve', { method: 'POST', headers: { Authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: 't', amount: -5 }) });
    expect(res.status).toBe(400);
  });
});
