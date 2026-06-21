// src/video/providers/higgsfield-webhook-handler.ts
// Minimal Higgsfield webhook handler — Codex P2 round 6 PR#10 fix.
//
// CONTEXT:
//   `HiggsfieldProvider.buildUrlWithWebhook()` advertises a callback URL of
//   `/webhooks/higgsfield/{jobId}` when BOTH `MEDIA_FORGE_HF_WEBHOOK_ENABLE=true`
//   AND `MEDIA_FORGE_WEBHOOK_PUBLIC_URL` are set. Without a registered handler
//   on the webhook router, Higgsfield's callback would 404 — leaving opt-in
//   webhook users to silently fall back to polling despite the URL being
//   advertised, exactly the failure mode P14 was designed to avoid.
//
//   P14 still ships polling-only as the primary completion mode; this handler
//   is a logging stub so the contract advertised by buildUrlWithWebhook holds.
//   P14.1+ can replace with a full payload parser + cost recorder once
//   Higgsfield publishes a stable webhook schema.
import type { WebhookHandler, WebhookContext } from './webhook-router.js';
import type { OutputStorageClient } from '../../output/storage.js';

export interface CreateHiggsfieldWebhookHandlerOpts {
  readonly dbPath: string;
  /**
   * F-B: accepted for signature symmetry with the Kling/Bytedance factories,
   * but this handler is a logging stub with NO asset buffer — it cannot upload
   * to MinIO. Higgsfield artifacts are delivered via the poll fallback
   * (assetUrls from the provider), not via MinIO signed URL, until the
   * Higgsfield webhook schema + asset download path lands (P14.1).
   */
  readonly storage?: OutputStorageClient;
}

export function createHiggsfieldWebhookHandler(
  _opts: CreateHiggsfieldWebhookHandlerOpts,
): WebhookHandler {
  return async (ctx: WebhookContext): Promise<void> => {
    // Log only — full payload parsing + asset download + cost reconciliation
    // is deferred to P14.1 when the Higgsfield webhook schema stabilizes.
    process.stderr.write(
      `[higgsfield-webhook] received callback for jobId='${ctx.jobId}' ` +
        `(payload keys: ${Object.keys((ctx.payload as object) ?? {}).join(', ') || 'none'})\n`,
    );
  };
}
