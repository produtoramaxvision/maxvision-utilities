// tests/unit/billing/credit-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CreditClient, InsufficientCreditError } from '../../../src/billing/credit-client.js';

const base = { baseUrl: 'http://credit-core:8080', apiKey: 'ck' };

function fetchReturning(status: number, body: unknown, calls: number[] = []) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    calls.push(status);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}

describe('CreditClient', () => {
  it('balance() faz GET /balance/:tenantId com Bearer', async () => {
    const fetchImpl = fetchReturning(200, { balance: 2500 });
    const c = new CreditClient({ ...base, fetchImpl });
    expect(await c.balance('t1')).toBe(2500);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ck' });
  });

  it('reserve() 402 → InsufficientCreditError (sem retry)', async () => {
    const calls: number[] = [];
    const fetchImpl = fetchReturning(402, { error: 'insufficient_balance' }, calls);
    const c = new CreditClient({ ...base, fetchImpl });
    await expect(
      c.reserve({ tenantId: 't1', amount: 100, reservationId: 'R1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-R1' }),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(calls).toEqual([402]); // 402 é determinístico → não retenta
  });

  it('capture() retenta em 5xx e tem sucesso na 2ª tentativa', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n += 1;
      return n === 1
        ? new Response('boom', { status: 503 })
        : new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const c = new CreditClient({ ...base, fetchImpl, retry: { retries: 2, baseDelayMs: 0 } });
    await c.capture({ tenantId: 't1', reservationId: 'R1', amount: 80, externalId: 'cap-R1' });
    expect(n).toBe(2);
  });

  it('externalId idempotente: mesma reserva → mesmo external_id é responsabilidade do caller (client só repassa)', async () => {
    const fetchImpl = fetchReturning(200, { ok: true });
    const c = new CreditClient({ ...base, fetchImpl });
    await c.release({ tenantId: 't1', reservationId: 'R1', amount: 80, externalId: 'rel-R1' });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ externalId: 'rel-R1' });
  });
});
