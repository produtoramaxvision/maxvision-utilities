// credit-core/tests/store.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store, InsufficientBalanceError } from '../src/store.js';
import { CreditService } from '../src/service.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('Store (integração)', () => {
  let pool: Pool; let store: Store; let svc: CreditService;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query(readFileSync('migrations/001_ledger.sql', 'utf8'));
    await pool.query(readFileSync('migrations/002_sweep_oracle.sql', 'utf8'));
    store = new Store(pool);
    svc = new CreditService(store);
  });

  it('idempotência: mesmo external_id não duplica grant', async () => {
    await store.append({ tenantId: 'a', kind: 'grant', amount: 100, externalId: 'g1' });
    await store.append({ tenantId: 'a', kind: 'grant', amount: 100, externalId: 'g1' }); // replay
    const es = await store.entriesFor('a');
    expect(es.filter((e) => e.kind === 'grant')).toHaveLength(1);
  });

  it('concorrência: 5 reservas de 30 contra saldo 100 → só 3 passam, saldo nunca negativo', async () => {
    await store.append({ tenantId: 'b', kind: 'grant', amount: 100, externalId: 'gb' });
    const tries = Array.from({ length: 5 }, (_, i) =>
      store.reserveAtomic({ tenantId: 'b', amount: 30, reservationId: `R${i}`, ttlAt: '2030-01-01T00:00:00Z', externalId: `r${i}` })
        .then(() => true).catch((e) => { if (e instanceof InsufficientBalanceError) return false; throw e; }),
    );
    const oks = (await Promise.all(tries)).filter(Boolean).length;
    expect(oks).toBe(3); // 3×30=90 ≤ 100; o 4º (120) falha
    const { rows } = await pool.query('SELECT amount FROM ledger_entries WHERE tenant_id=$1', ['b']);
    void rows;
    // saldo disponível nunca negativo
    const { availableBalance } = await import('../src/accounting.js');
    const es = await store.entriesFor('b');
    expect(availableBalance(es)).toBeGreaterThanOrEqual(0);
  });

  it('reserve persists status_url; statusUrlFor returns it', async () => {
    await svc.grant({ tenantId: 's1', amount: 100, externalId: 'g-s1' });
    await store.reserveAtomic({ tenantId: 's1', amount: 10, reservationId: 'U1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-U1', statusUrl: 'http://mcp-server:3000/job-status/U1' });
    expect(await store.statusUrlFor('s1', 'U1')).toBe('http://mcp-server:3000/job-status/U1');
    expect(await store.statusUrlFor('s1', 'NOPE')).toBeNull();
  });

  it('tenantsWithExpiredReservations returns only tenants with an unsettled expired reserve', async () => {
    await svc.grant({ tenantId: 't-exp', amount: 100, externalId: 'g-te' });
    await svc.reserve({ tenantId: 't-exp', amount: 10, reservationId: 'E1', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-E1' });
    await svc.grant({ tenantId: 't-valid', amount: 100, externalId: 'g-tv' });
    await svc.reserve({ tenantId: 't-valid', amount: 10, reservationId: 'V1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res-V1' });
    await svc.grant({ tenantId: 't-settled', amount: 100, externalId: 'g-ts' });
    await svc.reserve({ tenantId: 't-settled', amount: 10, reservationId: 'S1', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-S1' });
    await svc.release({ tenantId: 't-settled', reservationId: 'S1', amount: 10, externalId: 'rel-S1' });
    const tenants = await store.tenantsWithExpiredReservations('2026-06-02T01:00:00Z');
    expect(tenants).toContain('t-exp');
    expect(tenants).not.toContain('t-valid');
    expect(tenants).not.toContain('t-settled');
  });

  it('cross-kind: release then late capture stays RELEASED (no overdraft)', async () => {
    await svc.grant({ tenantId: 'x1', amount: 100, externalId: 'g-x1' });
    await svc.reserve({ tenantId: 'x1', amount: 30, reservationId: 'K1', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-K1' });
    await svc.release({ tenantId: 'x1', reservationId: 'K1', amount: 30, externalId: 'rel-K1' });
    expect(await svc.balance('x1')).toBe(100);
    await svc.capture({ tenantId: 'x1', reservationId: 'K1', amount: 30, externalId: 'cap-K1' });
    expect(await svc.balance('x1')).toBe(100);
  });

  it('cross-kind: capture then late release stays CAPTURED', async () => {
    await svc.grant({ tenantId: 'x2', amount: 100, externalId: 'g-x2' });
    await svc.reserve({ tenantId: 'x2', amount: 30, reservationId: 'K2', ttlAt: '2026-06-02T00:00:00Z', externalId: 'res-K2' });
    await svc.capture({ tenantId: 'x2', reservationId: 'K2', amount: 30, externalId: 'cap-K2' });
    expect(await svc.balance('x2')).toBe(70);
    await svc.release({ tenantId: 'x2', reservationId: 'K2', amount: 30, externalId: 'rel-K2' });
    expect(await svc.balance('x2')).toBe(70);
  });
});
