// src/billing/asaas-webhook.ts
// NOTA: Shapes a confirmar via asaas-mcp/sandbox. Asaas autentica por token estático
// no header asaas-access-token (NÃO HMAC). Idempotência por payment.id.
import { packForBrl } from './packs.js';
import type { PaymentsStore } from './payments-store.js';
import type { CreditClient } from './credit-client.js';

const GRANT_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);

export interface AsaasWebhookDeps {
  store: PaymentsStore;
  credit: CreditClient;
  webhookToken: string;
}
interface AsaasPayment { id: string; value: number; billingType?: string; subscription?: string; customer: string; }
interface AsaasEvent { event: string; payment: AsaasPayment; }

export async function handleAsaasWebhook(
  req: { token: string | undefined; body: unknown },
  deps: AsaasWebhookDeps,
): Promise<{ status: number; body: unknown }> {
  if (req.token !== deps.webhookToken) return { status: 401, body: { error: 'unauthorized' } };
  const ev = req.body as AsaasEvent;
  if (!ev?.event || !ev.payment?.id) return { status: 400, body: { error: 'bad_request' } };
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
  return { status: 200, body: { granted: pack.credits } };
}
