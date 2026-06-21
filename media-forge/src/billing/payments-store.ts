// src/billing/payments-store.ts
import type { Pool } from 'pg';
import type { Tier } from '../http/auth.js';

const VALID_TIERS: ReadonlySet<string> = new Set(['free', 'creator', 'pro']);

export interface PaymentRow {
  paymentId: string; provider: 'asaas' | 'stripe'; tenantId: string;
  kind: 'subscription' | 'pack'; brl: number | null; credits: number;
  creditValueUsd: number; creditKind: 'paid' | 'promo'; status: string;
}

export class PaymentsStore {
  constructor(private pool: Pool) {}

  async tenantForCustomer(provider: string, customerId: string): Promise<string | undefined> {
    const r = await this.pool.query(
      'SELECT tenant_id FROM billing_customers WHERE provider=$1 AND customer_id=$2',
      [provider, customerId],
    );
    return r.rows[0]?.tenant_id;
  }

  async linkCustomer(a: { tenantId: string; provider: string; customerId: string; subscriptionId?: string }): Promise<void> {
    await this.pool.query(
      `INSERT INTO billing_customers (tenant_id, provider, customer_id, subscription_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (provider, customer_id) DO UPDATE SET subscription_id = COALESCE(EXCLUDED.subscription_id, billing_customers.subscription_id)`,
      [a.tenantId, a.provider, a.customerId, a.subscriptionId ?? null],
    );
  }

  /** Insere o pagamento (idempotente por payment_id). Retorna false se já existia
   *  (replay) → o caller NÃO concede crédito de novo. */
  async recordPaymentOnce(p: PaymentRow & { externalGrantId: string; rawEvent: unknown }): Promise<boolean> {
    const r = await this.pool.query(
      `INSERT INTO payments
         (payment_id, provider, tenant_id, kind, brl, credits, credit_value_usd, credit_kind, status, external_grant_id, raw_event)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',$9,$10)
       ON CONFLICT (provider, payment_id) DO NOTHING
       RETURNING id`,
      [p.paymentId, p.provider, p.tenantId, p.kind, p.brl, p.credits, p.creditValueUsd, p.creditKind, p.externalGrantId, p.rawEvent],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async markGranted(provider: string, paymentId: string): Promise<void> {
    await this.pool.query(
      `UPDATE payments SET status='granted', granted_at=now() WHERE provider=$1 AND payment_id=$2`,
      [provider, paymentId],
    );
  }

  /** Lotes pagos ativos do tenant — base do creditValueUsd conservador (regra #3). */
  async paidCreditValuesFor(tenantId: string): Promise<number[]> {
    const r = await this.pool.query(
      `SELECT credit_value_usd FROM payments
        WHERE tenant_id=$1 AND credit_kind='paid' AND status IN ('confirmed','granted')`,
      [tenantId],
    );
    return r.rows.map((x) => Number(x.credit_value_usd));
  }

  /** Pagamentos confirmados mas ainda não concedidos (reconciliação F1 de pagamento). */
  async pendingGrants(): Promise<Array<{ provider: string; paymentId: string; tenantId: string; credits: number; externalGrantId: string }>> {
    const r = await this.pool.query(
      `SELECT provider, payment_id, tenant_id, credits, external_grant_id FROM payments WHERE status='confirmed'`,
    );
    return r.rows.map((x) => ({ provider: x.provider, paymentId: x.payment_id, tenantId: x.tenant_id, credits: Number(x.credits), externalGrantId: x.external_grant_id }));
  }

  /** Sets tenants.tier and writes an audit row, atomically in one tx.
   *  No-op (no audit row) when the tenant is already at the target tier. */
  async setTenantTier(tenantId: string, tier: Tier, reason: string): Promise<void> {
    if (!VALID_TIERS.has(tier)) throw new Error(`invalid tier: ${tier}`);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const cur = await c.query(`SELECT tier FROM tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
      const from = cur.rows[0]?.tier as string | undefined;
      if (from === undefined) { await c.query('ROLLBACK'); throw new Error(`unknown tenant: ${tenantId}`); }
      if (from === tier) { await c.query('COMMIT'); return; } // no-op, no audit
      await c.query(`UPDATE tenants SET tier=$1 WHERE id=$2`, [tier, tenantId]);
      await c.query(
        `INSERT INTO tier_changes (tenant_id, from_tier, to_tier, reason) VALUES ($1,$2,$3,$4)`,
        [tenantId, from, tier, reason],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Upserts the local subscription source of truth (keyed by provider+sub_id). */
  async upsertSubscriptionTier(
    tenantId: string,
    provider: string,
    subId: string,
    status: 'active' | 'canceled',
    tier: 'creator' | 'pro',
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO subscriptions (tenant_id, provider, sub_id, status, tier) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider, sub_id) DO UPDATE SET status=EXCLUDED.status, tier=EXCLUDED.tier, updated_at=now()`,
      [tenantId, provider, subId, status, tier],
    );
  }

  /** Re-derive tenants.tier from the local subscription source of truth. Heals
   *  partial-write drift (a tenants update missed after a subscription write).
   *  Returns the number of tenants corrected. NOTE: this does NOT recover a fully
   *  missed webhook — that needs provider polling (Phase 2). */
  async reconcileTiers(): Promise<number> {
    const rows = (await this.pool.query(`
      SELECT t.id, t.tier AS current,
        COALESCE((SELECT s.tier FROM subscriptions s
                   WHERE s.tenant_id=t.id AND s.status='active'
                   ORDER BY CASE s.tier WHEN 'pro' THEN 2 ELSE 1 END DESC LIMIT 1), 'free') AS derived
      FROM tenants t`)).rows as Array<{ id: string; current: string; derived: string }>;
    let fixed = 0;
    for (const r of rows) {
      if (r.current !== r.derived) {
        await this.setTenantTier(r.id, r.derived as Tier, 'reconcile');
        fixed++;
      }
    }
    return fixed;
  }
}
