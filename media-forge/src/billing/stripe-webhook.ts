// src/billing/stripe-webhook.ts
// NOTA: Shapes a confirmar via stripe-mcp/sandbox. constructEvent é injetado (tipo
// (rawBody,sig)=>Event) p/ testar sem cripto real; o caller liga em
// stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET).
// Idempotência por event.id. Créditos/creditValueUsd vêm do metadata do price
// (definido na criação do produto — gate do usuário).
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

const GRANT_TYPES = new Set(['checkout.session.completed', 'invoice.payment_succeeded']);

/** Resolve the `subscriptions` PK sub_id consistently across grant + cancel so
 *  the 'canceled' upsert hits the same row the 'active' grant created. On an
 *  invoice the id is `obj.subscription`; on `customer.subscription.deleted` the
 *  subscription object's own `id` (sub_...) is the key. NEVER fall back to event.id. */
function stripeSubId(obj: { subscription?: string; id?: string }): string | undefined {
  if (typeof obj.subscription === 'string') return obj.subscription;
  return typeof obj.id === 'string' && obj.id.startsWith('sub_') ? obj.id : undefined;
}

export interface StripeWebhookDeps {
  store: PaymentsStore;
  credit: CreditClient;
  constructEvent: (rawBody: string, signature: string) => { id: string; type: string; data: { object: Record<string, unknown> } };
}

export async function handleStripeWebhook(
  req: { rawBody: string; signature: string | undefined },
  deps: StripeWebhookDeps,
): Promise<{ status: number; body: unknown }> {
  let event;
  try {
    event = deps.constructEvent(req.rawBody, req.signature ?? '');
  } catch {
    return { status: 400, body: { error: 'invalid_signature' } };
  }
  // Subscription cancellation → demote to free. Not a credit grant, and the
  // event object is subscription-shaped (no credits metadata), so handle it
  // BEFORE the GRANT_TYPES gate and the 422 credits guard.
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as { id?: string; customer?: string };
    if (!sub.customer) return { status: 202, body: { note: 'no customer on event' } };
    const tenant = await deps.store.tenantForCustomer('stripe', sub.customer);
    if (!tenant) return { status: 202, body: { note: 'unmapped customer; reconcile later' } };
    const sid = stripeSubId(sub);
    if (sid) await deps.store.upsertSubscriptionTier(tenant, 'stripe', sid, 'canceled', 'creator');
    await deps.store.setTenantTier(tenant, 'free', 'stripe:customer.subscription.deleted');
    return { status: 200, body: { canceled: true } };
  }

  if (!GRANT_TYPES.has(event.type)) return { status: 200, body: { ignored: event.type } };

  const obj = event.data.object as {
    customer?: string; metadata?: Record<string, string>; amount_total?: number;
    subscription?: string; id?: string; subscription_details?: { metadata?: Record<string, string> };
  };
  const customerId = obj.customer;
  if (!customerId) return { status: 202, body: { note: 'no customer on event' } };
  const tenantId = await deps.store.tenantForCustomer('stripe', customerId);
  if (!tenantId) return { status: 202, body: { note: 'unmapped customer; reconcile later' } };

  const credits = Number(obj.metadata?.credits);
  const creditValueUsd = Number(obj.metadata?.creditValueUsd);
  if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(creditValueUsd)) {
    return { status: 422, body: { error: 'missing credits/creditValueUsd metadata' } };
  }

  const externalGrantId = `grant-stripe-${event.id}`;
  const kind = event.type === 'invoice.payment_succeeded' ? 'subscription' : 'pack';
  const fresh = await deps.store.recordPaymentOnce({
    paymentId: event.id, provider: 'stripe', tenantId, kind, brl: null,
    credits, creditValueUsd, creditKind: 'paid', status: 'confirmed', externalGrantId, rawEvent: event,
  });
  if (!fresh) return { status: 200, body: { replay: true } };

  await deps.credit.grant({ tenantId, amount: credits, externalId: externalGrantId });
  await deps.store.markGranted('stripe', event.id);

  // Subscription invoice → bind tier from the subscription/price metadata snapshot
  // (subscription_details.metadata, NOT the top-level invoice metadata). `pro` is
  // reachable only when the pro price sets metadata.tier='pro' (ties to D3 provisioning).
  if (kind === 'subscription') {
    const tier = obj.subscription_details?.metadata?.tier === 'pro' ? 'pro' : 'creator';
    const sid = stripeSubId(obj);
    if (sid) await deps.store.upsertSubscriptionTier(tenantId, 'stripe', sid, 'active', tier);
    await deps.store.setTenantTier(tenantId, tier, 'stripe:invoice.payment_succeeded');
  }
  return { status: 200, body: { granted: credits } };
}
