// credit-core/tests/sweep.int.test.ts (gated por DATABASE_URL — roda via embedded-postgres)
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { CreditService } from '../src/service.js';
import { runSweep, runSweepAllTenants } from '../src/sweep.js';

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
    await pool.query(readFileSync('migrations/002_sweep_oracle.sql', 'utf8'));
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
      reserveMeta: () => ({ amount: 30 }),
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
      reserveMeta: () => ({ amount: 30 }),
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
      reserveMeta: () => ({ amount: 40 }),
    });

    expect(res.captured).toEqual([]);
    expect(res.released).toEqual([]);
    expect(await svc.balance('sw3')).toBe(60); // reserva continua ativa
  });

  // EXT1 (gate de dinheiro): sweep e callback "live" podem settlar a MESMA reserva.
  // Com external_id determinístico cap-{rid} nos DOIS, o segundo settle é no-op
  // (ON CONFLICT) → 1 débito só. Sem o fix (sweep-cap-{suffix}) seria cobrança em dobro.
  it('EXT1: sweep captura, callback tardio captura a mesma reserva → 1 débito (idempotente)', async () => {
    await svc.grant({ tenantId: 'sw4', amount: 100, externalId: 'g-sw4' });
    await svc.reserve({ tenantId: 'sw4', amount: 30, reservationId: 'J4', ttlAt: PAST_TTL, externalId: 'res-J4' });

    // (1) Sweep roda antes do callback (reserva vencida) → captura com cap-J4.
    const res = await runSweep({
      store, service: svc, tenantId: 'sw4', nowIso: NOW,
      probe: async () => 'completed',
      reserveMeta: () => ({ amount: 30 }),
    });
    expect(res.captured).toEqual(['J4']);
    expect(await svc.balance('sw4')).toBe(70); // 1 capture aplicado

    // (2) Callback tardio: caminho live captura o custo real com o MESMO external_id.
    await svc.capture({ tenantId: 'sw4', reservationId: 'J4', amount: 30, externalId: 'cap-J4' });
    expect(await svc.balance('sw4')).toBe(70); // INALTERADO — sem débito dobrado
  });

  it('runSweepAllTenants: completed→capture(actualCredits), failed→release, across tenants', async () => {
    await svc.grant({ tenantId: 'm1', amount: 100, externalId: 'g-m1' });
    await svc.reserve({ tenantId: 'm1', amount: 30, reservationId: 'A', ttlAt: PAST_TTL, externalId: 'res-A' });
    await svc.grant({ tenantId: 'm2', amount: 100, externalId: 'g-m2' });
    await svc.reserve({ tenantId: 'm2', amount: 40, reservationId: 'B', ttlAt: PAST_TTL, externalId: 'res-B' });
    const probe = async (_t: string, rid: string) => rid === 'A' ? { status: 'completed' as const, actualCredits: 25 } : { status: 'failed' as const };
    const out = await runSweepAllTenants({ store, service: svc, nowIso: NOW, probe });
    expect(out.captured).toContain('A');
    expect(out.released).toContain('B');
    expect(await svc.balance('m1')).toBe(75);
    expect(await svc.balance('m2')).toBe(100);
  });
});
