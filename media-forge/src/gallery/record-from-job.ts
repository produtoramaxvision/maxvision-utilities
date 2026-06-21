// src/gallery/record-from-job.ts
// Shared helper: record a completed video job in the gallery (async webhook path), tenant-attributed.
// Idempotent via insertGeneration's ON CONFLICT(generation_id) DO NOTHING.
// Never throws — a gallery failure must not fail the webhook; every non-write is logged (D4).
// CEO review D5: single DRY helper instead of 3 inline copies across webhook handlers.
import { getJobRecord } from '../core/cost-tracker.js';
import type { GalleryStore } from './gallery-store.js';

interface Logger {
  warn: (m: string, x?: Record<string, unknown>) => void;
}

/**
 * Record a completed video job in the gallery (async webhook path), tenant-attributed.
 *
 * - D3: populate `minioKey` so the gallery row links to the stored artifact (presign on read).
 * - D4: emit a structured `logger.warn('gallery skip', {reason})` for every non-write — no silent gaps.
 * - D5: single shared helper called by all three webhook handlers (DRY).
 *
 * SEAM F-D: `creditsDebited` and `creditValueUsd` are placeholder values (0 / 0.01) until
 * credit-core capture is wired (SE1). Same seam as the existing sync kling_download write.
 */
export async function recordGalleryFromJob(opts: {
  galleryStore?: GalleryStore;
  dbPath: string;
  jobId: string;
  minioKey?: string; // D3: stable storage key; gallery presigns on read (signed URLs expire)
  logger: Logger;
}): Promise<void> {
  if (!opts.galleryStore) return; // self-host / no DB — nothing to record

  const job = getJobRecord({ dbPath: opts.dbPath, jobId: opts.jobId });
  if (!job) {
    opts.logger.warn('gallery skip', { reason: 'no-job', jobId: opts.jobId });
    return;
  }
  if (typeof job.actualUsd !== 'number') {
    opts.logger.warn('gallery skip', { reason: 'no-cost', jobId: opts.jobId, provider: job.provider });
    return;
  }

  try {
    await opts.galleryStore.insertGeneration({
      generationId: opts.jobId,
      tenantId: job.tenantId ?? 'default',
      model: job.model,
      provider: job.provider,
      costUsd: job.actualUsd,
      creditsDebited: job.actualCredits ?? 0, // SEAM F-D: real credits when credit-core capture is wired (SE1)
      creditValueUsd: 0.01,                   // SEAM F-D
      ...(opts.minioKey ? { minioKey: opts.minioKey } : {}),
      status: 'completed',
    });
  } catch (err) {
    opts.logger.warn('gallery skip', {
      reason: 'insert-failed',
      jobId: opts.jobId,
      err: (err as Error).message,
    });
  }
}
