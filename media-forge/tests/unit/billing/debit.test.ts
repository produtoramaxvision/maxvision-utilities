// tests/unit/billing/debit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runWithDebit, reserveForJob, captureJob } from '../../../src/billing/debit.js';

function fakeClient() {
  return {
    reserve: vi.fn(async () => {}),
    capture: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    balance: vi.fn(async () => 1000),
    grant: vi.fn(async () => {}),
  };
}

describe('debit', () => {
  it('sucesso: reserve(estimativa) → executa → capture(custo real)', async () => {
    const client = fakeClient();
    const out = await runWithDebit(
      { client: client as never, tenantId: 't1', jobId: 'J1', estimateCredits: 30, ttlAt: '2030-01-01T00:00:00Z' },
      async () => ({ result: 'img', actualCredits: 20 }),
    );
    expect(out.result).toBe('img');
    expect(client.reserve).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'J1', externalId: 'res-J1', amount: 30 }));
    expect(client.capture).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'J1', externalId: 'cap-J1', amount: 20 }));
    expect(client.release).not.toHaveBeenCalled();
  });

  it('falha na execução: release(estimativa) e re-lança o erro', async () => {
    const client = fakeClient();
    await expect(
      runWithDebit(
        { client: client as never, tenantId: 't1', jobId: 'J2', estimateCredits: 30, ttlAt: '2030-01-01T00:00:00Z' },
        async () => { throw new Error('provider down'); },
      ),
    ).rejects.toThrow('provider down');
    expect(client.release).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'J2', externalId: 'rel-J2', amount: 30 }));
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('reserveForJob/captureJob/releaseJob usam external_id determinístico', async () => {
    const client = fakeClient();
    await reserveForJob({ client: client as never, tenantId: 't', jobId: 'J3', estimateCredits: 5, ttlAt: '2030-01-01T00:00:00Z' });
    await captureJob({ client: client as never, tenantId: 't', jobId: 'J3', actualCredits: 4 });
    expect(client.reserve).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'res-J3' }));
    expect(client.capture).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'cap-J3', amount: 4 }));
  });

  it('reserveForJob forwards statusUrl to the credit client', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = { reserve: async (a: Record<string, unknown>) => { calls.push(a); } } as never;
    await reserveForJob({ client, tenantId: 't', jobId: 'J', estimateCredits: 10, ttlAt: '2030-01-01T00:00:00Z', statusUrl: 'http://mcp-server:3000/job-status/J' });
    expect(calls[0]['statusUrl']).toBe('http://mcp-server:3000/job-status/J');
    expect(calls[0]['externalId']).toBe('res-J');
  });
});
