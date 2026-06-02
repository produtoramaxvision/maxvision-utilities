// credit-core/tests/sweep.int.test.ts (gated por DATABASE_URL — roda via embedded-postgres)
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { CreditService } from '../src/service.js';
import { runSweep } from '../src/sweep.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

const PAST_TTL = '2026-06-02T00:00:00Z';
const NOW = '2026-06-02T01:00:00Z'; // depois do TTL → reserva vencida

d('runSweep (integração)', () => {
  let store: Store; let svc: CreditService; let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query(readFileSync('migrations/001_ledger.sql', 'utf8'));
    store = new Store(pool);
    svc = new CreditService(store);
  });

  it('reserva vencida com job failed → release; saldo volta ao grant', async () => {
    await svc.grant({ tenantId: 'sw1', amount: 100, externalId: 'g-sw1' });
    await svc.reserve({ tenantId: 'sw1', amount: 30, reservationId: 'RF', ttlAt: PAST_TTL, externalId: 'res-RF' });
    expect(await svc.balance('sw1')).toBe(70); // reserva ativa segura 30

    const res = await runSweep({
      store, service: svc, tenantId: 'sw1', nowIso: NOW,
      probe: async () => 'failed',
      reserveMeta: () => ({ amount: 30, externalSuffix: 'RF' }),
    });

    expect(res.released).toEqual(['RF']);
    expect(res.captured).toEqual([]);
    expect(await svc.balance('sw1')).toBe(100); // release devolveu o saldo
  });

  it('reserva vencida com job completed → capture; saldo = grant − capture', async () => {
    await svc.grant({ tenantId: 'sw2', amount: 100, externalId: 'g-sw2' });
    await svc.reserve({ tenantId: 'sw2', amount: 30, reservationId: 'RC', ttlAt: PAST_TTL, externalId: 'res-RC' });
    expect(await svc.balance('sw2')).toBe(70);

    const res = await runSweep({
      store, service: svc, tenantId: 'sw2', nowIso: NOW,
      probe: async () => 'completed',
      reserveMeta: () => ({ amount: 30, externalSuffix: 'RC' }),
    });

    expect(res.captured).toEqual(['RC']);
    expect(res.released).toEqual([]);
    expect(await svc.balance('sw2')).toBe(70); // capture tornou o gasto permanente
  });

  it('reserva ainda válida não é varrida', async () => {
    await svc.grant({ tenantId: 'sw3', amount: 100, externalId: 'g-sw3' });
    await svc.reserve({ tenantId: 'sw3', amount: 40, reservationId: 'RV', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-RV' });

    const res = await runSweep({
      store, service: svc, tenantId: 'sw3', nowIso: NOW,
      probe: async () => 'completed',
      reserveMeta: () => ({ amount: 40, externalSuffix: 'RV' }),
    });

    expect(res.captured).toEqual([]);
    expect(res.released).toEqual([]);
    expect(await svc.balance('sw3')).toBe(60); // reserva continua ativa
  });
});
