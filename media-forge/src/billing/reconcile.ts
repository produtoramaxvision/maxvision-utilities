// src/billing/reconcile.ts
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

/** Re-tenta grants de pagamentos confirmados-mas-não-concedidos. Idempotente
 *  (external_grant_id já usado → credit-core faz ON CONFLICT DO NOTHING). */
export async function reconcilePendingGrants(deps: { store: PaymentsStore; credit: CreditClient }): Promise<{ reconciled: string[] }> {
  const pending = await deps.store.pendingGrants();
  const reconciled: string[] = [];
  for (const p of pending) {
    await deps.credit.grant({ tenantId: p.tenantId, amount: p.credits, externalId: p.externalGrantId });
    await deps.store.markGranted(p.provider, p.paymentId);
    reconciled.push(p.paymentId);
  }
  return { reconciled };
}

/** Loop de cron interno (chamado pelo entrypoint HTTP; intervalo via env). */
export function startReconcileLoop(deps: { store: PaymentsStore; credit: CreditClient }, intervalMs = 300_000): () => void {
  const t = setInterval(() => { void reconcilePendingGrants(deps).catch(() => {}); }, intervalMs);
  return () => clearInterval(t);
}
