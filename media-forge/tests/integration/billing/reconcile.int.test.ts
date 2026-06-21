// tests/integration/billing/reconcile.int.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { PaymentsStore } from '../../../src/billing/payments-store.js';
import type { CreditClient } from '../../../src/billing/credit-client.js';
import { reconcilePendingGrants } from '../../../src/billing/reconcile.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
// Schema isolado por arquivo (ver payments-store.int): evita race de DDL paralelo.
const SCHEMA = 'billing_recon_it';

d('reconcilePendingGrants', () => {
  let store: PaymentsStore;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.end();
    pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
    await pool.query(readFileSync('migrations/003_payments.sql', 'utf8'));
    store = new PaymentsStore(pool);
  });
  afterAll(async () => { await pool.end(); });

  it('chama grant 1× e marca status=granted', async () => {
    // Seed: inserir pagamento status='confirmed' via recordPaymentOnce
    await store.recordPaymentOnce({
      paymentId: 'pay_rec_1',
      provider: 'asaas',
      tenantId: 'tenant_rec',
      kind: 'pack',
      brl: 29.9,
      credits: 2000,
      creditValueUsd: 0.00299,
      creditKind: 'paid',
      status: 'confirmed',
      externalGrantId: 'grant-pay_rec_1',
      rawEvent: {},
    });

    const grantFn = vi.fn(async (_args: Parameters<CreditClient['grant']>[0]) => {});
    const fakeCreditClient = { grant: grantFn } as unknown as CreditClient;

    const result = await reconcilePendingGrants({ store, credit: fakeCreditClient });

    // grant deve ter sido chamado exatamente 1 vez com os dados corretos
    expect(grantFn).toHaveBeenCalledTimes(1);
    expect(grantFn).toHaveBeenCalledWith({
      tenantId: 'tenant_rec',
      amount: 2000,
      externalId: 'grant-pay_rec_1',
    });

    // resultado deve conter o paymentId reconciliado
    expect(result.reconciled).toEqual(['pay_rec_1']);

    // status deve ter virado 'granted' no banco
    const row = await pool.query(
      `SELECT status FROM payments WHERE provider='asaas' AND payment_id='pay_rec_1'`,
    );
    expect(row.rows[0].status).toBe('granted');
  });

  it('idempotência: 2ª execução não chama grant (pendingGrants vazio)', async () => {
    const grantFn = vi.fn(async (_args: Parameters<CreditClient['grant']>[0]) => {});
    const fakeCreditClient = { grant: grantFn } as unknown as CreditClient;

    // pay_rec_1 já está 'granted' da iteração anterior — pendingGrants() deve retornar []
    const result = await reconcilePendingGrants({ store, credit: fakeCreditClient });

    expect(grantFn).not.toHaveBeenCalled();
    expect(result.reconciled).toHaveLength(0);
  });
});
