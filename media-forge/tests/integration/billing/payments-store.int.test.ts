// tests/integration/billing/payments-store.int.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PaymentsStore } from '../../../src/billing/payments-store.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
// Schema isolado por arquivo: arquivos int rodam em forks paralelos no MESMO db
// embedded-postgres; namespaces distintos evitam race de DDL em pg_type.
const SCHEMA = 'billing_paystore_it';

d('PaymentsStore', () => {
  let store: PaymentsStore; let pool: Pool;
  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.end();
    pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
    await pool.query(readFileSync('migrations/003_payments.sql', 'utf8'));
    store = new PaymentsStore(pool);
  });
  afterAll(async () => { await pool.end(); });

  it('recordPaymentOnce é idempotente por payment_id', async () => {
    const row = { paymentId: 'pay_1', provider: 'asaas' as const, tenantId: 't1', kind: 'pack' as const, brl: 19.9, credits: 1500, creditValueUsd: 0.00239, creditKind: 'paid' as const, status: 'confirmed', externalGrantId: 'grant-pay_1', rawEvent: {} };
    expect(await store.recordPaymentOnce(row)).toBe(true);
    expect(await store.recordPaymentOnce(row)).toBe(false); // replay
  });

  it('tenantForCustomer resolve o mapeamento', async () => {
    await store.linkCustomer({ tenantId: 't9', provider: 'stripe', customerId: 'cus_x', subscriptionId: 'sub_x' });
    expect(await store.tenantForCustomer('stripe', 'cus_x')).toBe('t9');
  });

  it('paidCreditValuesFor retorna os lotes pagos', async () => {
    const vals = await store.paidCreditValuesFor('t1');
    expect(vals).toContain(0.00239);
  });
});
