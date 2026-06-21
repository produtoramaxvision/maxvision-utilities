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
import type { GalleryStore } from '../../gallery/gallery-store.js';
import { recordGalleryFromJob } from '../../gallery/record-from-job.js';
import { logger } from '../../core/logger.js';

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
  /**
   * SE2: when present, a completed job is written to the gallery (tenant-attributed).
   * NOTE: Higgsfield webhook is a logging stub — no cost is recorded here (no recordActualCost),
   * so recordGalleryFromJob will always emit a 'no-cost' skip-log and return. Gallery write
   * for Higgsfield requires the polling path (P14.1) to land cost data first.
   * Wired here for factory-signature parity; harmless (graceful skip).
   */
  readonly galleryStore?: GalleryStore;
  /** SE2: logger for gallery skip events. Defaults to module logger. */
  readonly logger?: typeof logger;
}

export function createHiggsfieldWebhookHandler(
  opts: CreateHiggsfieldWebhookHandlerOpts,
): WebhookHandler {
  return async (ctx: WebhookContext): Promise<void> => {
    // Log only — full payload parsing + asset download + cost reconciliation
    // is deferred to P14.1 when the Higgsfield webhook schema stabilizes.
    process.stderr.write(
      `[higgsfield-webhook] received callback for jobId='${ctx.jobId}' ` +
        `(payload keys: ${Object.keys((ctx.payload as object) ?? {}).join(', ') || 'none'})\n`,
    );

    // SE2: attempt gallery write. Higgsfield webhook is a stub — no cost is recorded here,
    // so this will always emit 'no-cost' skip-log. Harmless; wired for parity.
    await recordGalleryFromJob({
      galleryStore: opts.galleryStore,
      dbPath: opts.dbPath,
      jobId: ctx.jobId,
      // No minioKey — Higgsfield has no asset buffer in this stub path.
      logger: opts.logger ?? logger,
    });
  };
}
