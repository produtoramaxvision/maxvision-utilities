// src/video/providers/bytedance-webhook-handler.ts
// fal.ai Seedance webhook handler — non-blocking asset ingestion.
//
// P16.W FASE 3 (PR#12): expanded from round-2 stub-only logger.
// Codex R20 P2 fixes:
//   #1 — Bind callback to submitted request via native_task_id match. fal.ai's
//        JWKS is shared across all users, so a valid ED25519 signature is
//        necessary but not sufficient — without this check, ANY fal user
//        could spoof callbacks for our jobId paths. Match payload.request_id
//        (set by fal.ai to the submitter's request_id) against the
//        native_task_id we persisted on submit.
//   #2 — Non-blocking ACK. fal.ai webhook delivery timeout is 15s. Awaiting
//        CDN MP4 download (potentially 30MB+ for 1080p 15s) inside the
//        handler made callbacks miss the timeout → retry storm + duplicate
//        downloads. Now: validate + persist status synchronously, fire asset
//        download in background, return immediately so the router 200s fast.
//
// fal.ai webhook contract (verified via context7 → docs/inference/webhooks):
//   - POST body = { request_id, gateway_request_id, status: 'OK'|'ERROR',
//                   payload, error? }
//   - status='OK' → payload.video.url is the asset
//   - status='ERROR' → payload.error describes the failure
//   - 15s ACK timeout, 10 retries over 2h
//   - request_id is the idempotency + binding key
//
// COST RECORDING — single source of truth:
//   Cost is recorded EXCLUSIVELY by BytedanceSeedanceProvider.pollStatus()
//   because it holds the route-map (tier, resolution, duration) in memory.
//   The webhook handler does NOT call recordActualCost — it just signals
//   terminal status. Next media_video_poll reconciles cost via pollStatus +
//   the existing `WHERE actual_usd IS NULL` idempotency guard.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebhookHandler, WebhookContext } from './webhook-router.js';
import { openDb, runMigrations } from '../../core/db.js';
import type { OutputStorageClient } from '../../output/storage.js';
import { storeArtifact } from '../../output/output-storage.js';
import type { GalleryStore } from '../../gallery/gallery-store.js';
import { recordGalleryFromJob } from '../../gallery/record-from-job.js';
import { logger } from '../../core/logger.js';

export interface CreateBytedanceWebhookHandlerOpts {
  readonly dbPath: string;
  readonly outputsDir: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * When provided, awaited inside the handler instead of fire-and-forget.
   * Test seam — production callers omit, so asset download stays
   * non-blocking and the router can ACK within fal.ai's 15s window.
   */
  readonly awaitBackgroundDownload?: boolean;
  /**
   * F-B: when present, the downloaded asset is uploaded to MinIO under the
   * deterministic key `outputs/{jobId}.{ext}` so the poll path can presign it.
   * Best-effort inside the (already non-blocking) background download.
   */
  readonly storage?: OutputStorageClient;
  /**
   * SE2: when present, a completed job is written to the gallery (tenant-attributed).
   * NOTE: bytedance cost is reconciled via pollStatus, NOT in the webhook. At webhook time
   * actual_usd is always NULL → recordGalleryFromJob emits a 'no-cost' skip-log and returns.
   * Gallery write for bytedance happens only AFTER the first media_video_poll that calls
   * pollStatus and sets actual_usd. This is a deliberate out-of-scope seam for SE2 — wiring
   * it here is harmless (graceful skip) and makes the factory signature consistent.
   */
  readonly galleryStore?: GalleryStore;
  /** SE2: logger for gallery skip events. Defaults to module logger. */
  readonly logger?: typeof logger;
}

interface FalSeedanceVideo {
  readonly url?: string;
  readonly content_type?: string;
  readonly duration?: number;
}

interface FalSeedanceSuccessPayload {
  readonly video?: FalSeedanceVideo;
  readonly seed?: number;
}

interface FalWebhookPayload {
  readonly request_id?: string;
  readonly gateway_request_id?: string;
  readonly status?: 'OK' | 'ERROR' | string;
  readonly payload?: FalSeedanceSuccessPayload | unknown;
  readonly error?: string;
}

interface DbJobRow {
  readonly model?: string;
  readonly status?: string;
  readonly native_task_id?: string;
}

export function createBytedanceWebhookHandler(
  opts: CreateBytedanceWebhookHandlerOpts,
): WebhookHandler {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const awaitBackground = opts.awaitBackgroundDownload ?? false;
  return async (ctx: WebhookContext): Promise<void> => {
    const payload = ctx.payload as FalWebhookPayload;
    const internalJobId = ctx.jobId;

    const db = openDb(opts.dbPath);
    runMigrations(db);
    const row = db
      .prepare('SELECT model, status, native_task_id FROM video_jobs WHERE id = ?')
      .get(internalJobId) as DbJobRow | undefined;
    if (!row?.model) {
      throw new Error(
        `bytedance-webhook-handler: no cost-tracker record for ctx.jobId='${internalJobId}' ` +
          `(orphan webhook? possible causes: process restart cleared in-flight state, ` +
          `callback_url malformed, or jobId mismatch between submit + webhook). ` +
          `unknown jobId in video_jobs table.`,
      );
    }

    // FIX (Codex P2 #1 round 20, PR#12): bind callback to the request this
    // process submitted. fal.ai's JWKS is shared across all users; ED25519
    // verifies the signer IS fal.ai but does NOT verify the signer ASKED to
    // sign THIS request. Require payload.request_id (or gateway_request_id)
    // to match the native_task_id we persisted on submit. Reject mismatches
    // loudly (throw → 500 → fal retries on the wrong delivery path which is
    // harmless).
    //
    // R22 (CodeRabbit R21 informational): accept if EITHER request_id OR
    // gateway_request_id matches. Earlier `??` would reject a legitimate
    // callback when request_id is present but != native_task_id even if
    // gateway_request_id matched. fal.ai's docs show both fields populated;
    // the binding check is "we asked for this work", which either field
    // can prove.
    if (!row.native_task_id) {
      throw new Error(
        `bytedance-webhook-handler: row.native_task_id missing for jobId='${internalJobId}' ` +
          `(submitted before R21 persistence fix?). Reject callback for safety; ` +
          `caller must re-poll via media_video_poll to finalize.`,
      );
    }
    const claimedIds = [payload.request_id, payload.gateway_request_id].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const matched = claimedIds.some((id) => id === row.native_task_id);
    if (!matched) {
      throw new Error(
        `bytedance-webhook-handler: request_id mismatch for jobId='${internalJobId}' ` +
          `(claimed=[${claimedIds.join(',') || '(none)'}], expected='${row.native_task_id}'). ` +
          `Rejecting — likely cross-account callback or stale routing.`,
      );
    }

    // Terminal ERROR — flag status only. pollStatus owns cost ledger.
    if (payload.status === 'ERROR') {
      const errMsg = typeof payload.error === 'string' ? payload.error : '(no error message)';
      process.stderr.write(
        `[bytedance-webhook] job ${internalJobId} ERROR: ${errMsg} — pollStatus will finalize cost row\n`,
      );
      db.prepare(
        "UPDATE video_jobs SET status = 'failed' WHERE id = ? AND status IN ('pending', 'in_progress')",
      ).run(internalJobId);
      return;
    }

    if (payload.status !== 'OK') {
      process.stderr.write(
        `[bytedance-webhook] job ${internalJobId} non-terminal status='${payload.status ?? 'unknown'}' — convergence via pollStatus\n`,
      );
      return;
    }

    const success = payload.payload as FalSeedanceSuccessPayload | undefined;
    const videoUrl = success?.video?.url;
    if (!videoUrl) {
      process.stderr.write(
        `[bytedance-webhook] job ${internalJobId} status=OK but no video.url in payload — pollStatus will resolve asset URL\n`,
      );
      return;
    }

    // FIX (Codex P2 #2 round 20, PR#12): synchronous persist + async download.
    // Mark status='completed' BEFORE starting the (potentially long) download
    // so the router ACKs fal.ai inside the 15s window. media_video_poll's
    // first read sees terminal state immediately; pollStatus reconciles cost
    // via the route-map.
    db.prepare(
      "UPDATE video_jobs SET status = 'completed' WHERE id = ? AND status != 'completed'",
    ).run(internalJobId);

    // SE2: attempt gallery write. bytedance cost is reconciled by pollStatus (not the webhook),
    // so actual_usd is NULL here → recordGalleryFromJob emits 'no-cost' skip-log and returns.
    // This is a documented seam: the gallery row is written only after the first pollStatus
    // settles actual_usd. Wired here for factory-signature parity; harmless (graceful skip).
    await recordGalleryFromJob({
      galleryStore: opts.galleryStore,
      dbPath: opts.dbPath,
      jobId: internalJobId,
      minioKey: `outputs/${internalJobId}.mp4`,
      logger: opts.logger ?? logger,
    });

    const contentType = success?.video?.content_type ?? 'video/mp4';
    const downloadPromise = downloadAndPersistAsset(
      fetchImpl,
      videoUrl,
      opts.outputsDir,
      internalJobId,
      contentType,
      opts.storage,
    );
    if (awaitBackground) {
      await downloadPromise;
    } else {
      // Fire-and-forget — errors logged, not thrown (already ACK'd).
      void downloadPromise.catch((err: unknown) => {
        process.stderr.write(
          `[bytedance-webhook] background download failed for jobId='${internalJobId}': ${
            err instanceof Error ? err.message : String(err)
          } — pollStatus + download() will retry via fal.queue.result\n`,
        );
      });
    }
  };
}

async function downloadAndPersistAsset(
  fetchImpl: typeof fetch,
  url: string,
  outputsDir: string,
  jobId: string,
  contentType: string,
  storage?: OutputStorageClient,
): Promise<void> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`asset download failed (${res.status}) for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(outputsDir, { recursive: true });
  writeFileSync(join(outputsDir, `${jobId}.mp4`), buf);
  process.stderr.write(
    `[bytedance-webhook] job ${jobId} asset downloaded (${buf.length} bytes), status=completed; cost via next pollStatus\n`,
  );
  // F-B: upload to MinIO under outputs/{jobId}.{ext} so the poll path can presign.
  // Best-effort — local disk write above is the durable fallback.
  if (storage) {
    await storeArtifact({ storage, jobId, bytes: buf, contentType }).catch((err: unknown) => {
      process.stderr.write(
        `[bytedance-webhook] MinIO upload failed for ${jobId}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    });
  }
}
