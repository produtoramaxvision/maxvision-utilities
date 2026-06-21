// src/billing/stripe-webhook.ts
// NOTA: Shapes a confirmar via stripe-mcp/sandbox. constructEvent é injetado (tipo
// (rawBody,sig)=>Event) p/ testar sem cripto real; o caller liga em
// stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET).
// Idempotência por event.id. Créditos/creditValueUsd vêm do metadata do price
// (definido na criação do produto — gate do usuário).
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

const GRANT_TYPES = new Set(['checkout.session.completed', 'invoice.payment_succeeded']);

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
  if (!GRANT_TYPES.has(event.type)) return { status: 200, body: { ignored: event.type } };

  const obj = event.data.object as { customer?: string; metadata?: Record<string, string>; amount_total?: number };
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
  return { status: 200, body: { granted: credits } };
}
