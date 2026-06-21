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

/** Loop de cron interno (chamado pelo entrypoint HTTP; intervalo via env).
 *  Hardened (eng E1+E2): falhas de tick são logadas com contexto estruturado em
 *  vez de engolidas (`.catch(()=>{})`), e um guard `running` evita sobreposição —
 *  `reconcileTiers` é um full-table scan que pode estourar o intervalo. */
export function startReconcileLoop(
  deps: {
    store: PaymentsStore;
    credit: CreditClient;
    logger: {
      warn: (m: string, x?: Record<string, unknown>) => void;
      error: (m: string, x?: Record<string, unknown>) => void;
    };
  },
  intervalMs = 300_000,
): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) {
      deps.logger.warn('reconcile tick skipped (previous still running)');
      return;
    }
    running = true;
    try {
      await reconcilePendingGrants(deps);
      const fixed = await deps.store.reconcileTiers();
      // Observability of the accepted missed-webhook gap (Phase 1 heals drift only).
      if (fixed > 0) deps.logger.warn('tier reconcile corrected drift', { fixed });
    } catch (err) {
      deps.logger.error('reconcile loop tick failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };
  const t = setInterval(() => { void tick(); }, intervalMs);
  return () => clearInterval(t);
}
