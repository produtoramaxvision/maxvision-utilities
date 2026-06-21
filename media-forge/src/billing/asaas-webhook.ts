// src/billing/asaas-webhook.ts
// NOTA: Shapes a confirmar via asaas-mcp/sandbox. Asaas autentica por token estático
// no header asaas-access-token (NÃO HMAC). Idempotência por payment.id.
import { packForBrl } from './packs.js';
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

const GRANT_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
// Subscription cancellation events (confirmed against Asaas docs "Eventos para
// assinaturas"): both signal the recurring plan is no longer active → drop to free.
const CANCEL_EVENTS = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

export interface AsaasWebhookDeps {
  store: PaymentsStore;
  credit: CreditClient;
  webhookToken: string;
}
interface AsaasPayment { id: string; value: number; billingType?: string; subscription?: string; customer: string; }
interface AsaasEvent { event: string; payment: AsaasPayment; }
// Subscription-cancel events carry a `subscription` object, NOT a `payment`.
interface AsaasSubscription { id: string; customer: string; status?: string; }

export async function handleAsaasWebhook(
  req: { token: string | undefined; body: unknown },
  deps: AsaasWebhookDeps,
): Promise<{ status: number; body: unknown }> {
  if (req.token !== deps.webhookToken) return { status: 401, body: { error: 'unauthorized' } };
  const raw = req.body as { event?: string; payment?: AsaasPayment; subscription?: AsaasSubscription };
  if (!raw?.event) return { status: 400, body: { error: 'bad_request' } };

  // Subscription cancellation → demote to free. The payload is subscription-shaped
  // (no `payment`), so handle it BEFORE the payment-shaped validation below.
  if (CANCEL_EVENTS.has(raw.event)) {
    const sub = raw.subscription;
    if (!sub?.id || !sub.customer) return { status: 400, body: { error: 'bad_request' } };
    const tenantId = await deps.store.tenantForCustomer('asaas', sub.customer);
    if (!tenantId) return { status: 202, body: { note: 'unmapped customer; reconcile later' } };
    await deps.store.upsertSubscriptionTier(tenantId, 'asaas', sub.id, 'canceled', 'creator');
    await deps.store.setTenantTier(tenantId, 'free', `asaas:${raw.event}`);
    return { status: 200, body: { canceled: true } };
  }

  const ev = raw as AsaasEvent;
  if (!ev.payment?.id) return { status: 400, body: { error: 'bad_request' } };
  if (!GRANT_EVENTS.has(ev.event)) return { status: 200, body: { ignored: ev.event } };

  const tenantId = await deps.store.tenantForCustomer('asaas', ev.payment.customer);
  if (!tenantId) return { status: 202, body: { note: 'unmapped customer; reconcile later' } };

  const pack = packForBrl(ev.payment.value);
  if (!pack) return { status: 422, body: { error: 'unknown amount', value: ev.payment.value } };

  const kind = ev.payment.subscription ? 'subscription' : 'pack';
  const externalGrantId = `grant-asaas-${ev.payment.id}`;
  const fresh = await deps.store.recordPaymentOnce({
    paymentId: ev.payment.id, provider: 'asaas', tenantId, kind, brl: ev.payment.value,
    credits: pack.credits, creditValueUsd: pack.creditValueUsd, creditKind: 'paid', status: 'confirmed',
    externalGrantId, rawEvent: ev,
  });
  if (!fresh) return { status: 200, body: { replay: true } }; // idempotente

  await deps.credit.grant({ tenantId, amount: pack.credits, externalId: externalGrantId });
  await deps.store.markGranted('asaas', ev.payment.id);

  // Subscription payment → bind creator tier. Asaas has no per-price tier metadata,
  // so the recurring plan maps to creator; pro-tier Asaas is out of scope (see plan).
  if (kind === 'subscription' && ev.payment.subscription) {
    await deps.store.upsertSubscriptionTier(tenantId, 'asaas', ev.payment.subscription, 'active', 'creator');
    await deps.store.setTenantTier(tenantId, 'creator', `asaas:${ev.event}`);
  }
  return { status: 200, body: { granted: pack.credits } };
}
