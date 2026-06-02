// credit-core/tests/store.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store, InsufficientBalanceError } from '../src/store.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('Store (integração)', () => {
  let pool: Pool; let store: Store;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query(readFileSync('migrations/001_ledger.sql', 'utf8'));
    store = new Store(pool);
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
});
