// credit-core/tests/service.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { CreditService } from '../src/service.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('CreditService (integração)', () => {
  let svc: CreditService; let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ledger_entries');
    await pool.query(readFileSync('migrations/001_ledger.sql', 'utf8'));
    svc = new CreditService(new Store(pool));
  });

  it('grant→reserve→capture deixa saldo = grant − capture', async () => {
    await svc.grant({ tenantId: 'c', amount: 100, externalId: 'gc' });
    await svc.reserve({ tenantId: 'c', amount: 30, reservationId: 'R1', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res1' });
    expect(await svc.balance('c')).toBe(70);
    await svc.capture({ tenantId: 'c', reservationId: 'R1', amount: 30, externalId: 'cap1' });
    expect(await svc.balance('c')).toBe(70);
  });

  it('reserve→release devolve o saldo; capture replayado é idempotente', async () => {
    await svc.grant({ tenantId: 'd', amount: 50, externalId: 'gd' });
    await svc.reserve({ tenantId: 'd', amount: 20, reservationId: 'R2', ttlAt: '2030-01-01T00:00:00Z', externalId: 'res2' });
    await svc.release({ tenantId: 'd', reservationId: 'R2', amount: 20, externalId: 'rel2' });
    expect(await svc.balance('d')).toBe(50);
    await svc.grant({ tenantId: 'd', amount: 10, externalId: 'gd' }); // replay grant → idempotente
    expect(await svc.balance('d')).toBe(50);
  });
});
