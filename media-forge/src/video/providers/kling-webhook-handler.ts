import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebhookHandler, WebhookContext } from './webhook-router.js';
import { recordActualCost } from '../../core/cost-tracker.js';
import { VIDEO_MODELS } from '../../core/models.js';
import { openDb, runMigrations } from '../../core/db.js';
import { getKlingAuthHeader, type KlingEnvSubset } from './auth/kling-jwt.js';
import type { OutputStorageClient } from '../../output/storage.js';
import { storeArtifact } from '../../output/output-storage.js';

export interface CreateKlingWebhookHandlerOpts {
  readonly dbPath: string;
  readonly outputsDir: string;
  readonly fetchImpl?: typeof fetch;
  /** Env subset for re-poll auth (TTL refresh path). Optional - if absent, no refresh attempted. */
  readonly env?: KlingEnvSubset;
  /**
   * F-B: when present, the completed asset is uploaded to MinIO under the
   * deterministic key `outputs/{jobId}.mp4` so the poll handler can presign it.
   * MULTI-SHOT LIMITATION: only the first shot (index 0) is uploaded under the
   * canonical key — multi-shot artifacts beyond shot 0 stay on local disk
   * (deferred to F-I where per-shot keys land).
   */
  readonly storage?: OutputStorageClient;
}

interface KlingWebhookPayload {
  readonly task_id?: string;
  readonly task_status?: 'succeed' | 'processing' | 'submitted' | 'failed';
  readonly task_status_msg?: string;
  readonly task_result?: {
    readonly videos?: ReadonlyArray<{
      readonly id?: string;
      readonly url?: string;
      readonly duration?: string;
    }>;
  };
}

const KLING_API_BASE = 'https://api-singapore.klingai.com';

export function createKlingWebhookHandler(opts: CreateKlingWebhookHandlerOpts): WebhookHandler {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (ctx: WebhookContext): Promise<void> => {
    const payload = ctx.payload as KlingWebhookPayload;

    // Identity resolution: P14 router extracts the trailing path segment of
    // /webhooks/kling/{jobId} into ctx.jobId. KlingProvider.generate() embeds our internal jobId
    // there. NO global request_id<->jobId map needed.
    const internalJobId = ctx.jobId;

    // Verify the jobId exists in the cost-tracker DB before doing any work.
    const db = openDb(opts.dbPath);
    runMigrations(db);
    const row = db
      .prepare('SELECT model, native_task_id, mode, est_usd FROM video_jobs WHERE id = ?')
      .get(internalJobId) as
      | { model?: string; native_task_id?: string; mode?: string; est_usd?: number }
      | undefined;
    if (!row?.model) {
      throw new Error(
        `kling-webhook-handler: no cost-tracker record for ctx.jobId='${internalJobId}' (orphan webhook? ` +
          `Possible causes: process restart cleared in-flight state, callback_url malformed, ` +
          `or jobId mismatch between submit + webhook). unknown jobId in video_jobs table.`,
      );
    }

    if (payload.task_status === 'failed') {
      process.stderr.write(
        `[kling-webhook] job ${internalJobId} failed: ${payload.task_status_msg ?? '(no message)'}\n`,
      );
      // FIX (Codex P2, PR#11): mark as terminal in cost-tracker so the row
      // doesn't dangle in 'pending' state forever — cost/status reports
      // must distinguish finished-failed from in-progress.
      db.prepare(
        "UPDATE video_jobs SET status = 'failed', actual_usd = COALESCE(actual_usd, 0), completed_at = ? WHERE id = ? AND status != 'completed'",
      ).run(new Date().toISOString(), internalJobId);
      return;
    }

    if (payload.task_status !== 'succeed') {
      return; // processing / submitted - nothing to do yet
    }

    const videos = payload.task_result?.videos ?? [];
    if (videos.length === 0) {
      process.stderr.write(
        `[kling-webhook] job ${internalJobId} succeeded but no video assets in payload — marking failed\n`,
      );
      // FIX (Codex P2 round 15, PR#11): persist a terminal state. The previous
      // log+return left the row stuck at 'pending' forever — symmetric with the
      // round 4 failed-status bug. A succeed envelope with no assets cannot
      // produce a downloadable artifact; treat it as failure so cost reports
      // distinguish it from in-progress work.
      db.prepare(
        "UPDATE video_jobs SET status = 'failed', actual_usd = COALESCE(actual_usd, 0), completed_at = ? WHERE id = ? AND status != 'completed'",
      ).run(new Date().toISOString(), internalJobId);
      return;
    }

    mkdirSync(opts.outputsDir, { recursive: true });

    // Parallelize downloads. .map(async (v, i) => ...) preserves shot index for deterministic
    // filenames even with out-of-order fetch completion.
    const results = await Promise.all(
      videos.map(async (video, i) => {
        if (!video.url) return { dur: 0 };
        const filename =
          videos.length === 1
            ? `${internalJobId}.mp4`
            : `${internalJobId}.shot-${i}.mp4`;
        let buf: Buffer;
        try {
          buf = await downloadAsset(fetchImpl, video.url);
        } catch (err) {
          // TTL-refresh fallback: Kling CDN URLs are ~3600s TTL; if download fails with 403/404
          // on a 'completed' URL, re-poll status to get a fresh URL.
          // Use persisted native_task_id from DB, with payload.task_id as fallback (Option A —
          // handles case where recordJob was called before native_task_id column existed, or
          // when the test does not seed native_task_id in recordJob).
          if (opts.env && isLikelyExpiredUrlError(err)) {
            const nativeTaskId = row.native_task_id ?? payload.task_id ?? '';
            const fresh = await refetchAssetUrl({
              fetchImpl,
              env: opts.env,
              nativeTaskId,
              mode: row.mode ?? 't2v',
              // Pass shot index when refreshing multi-shot assets so each
              // shot finds its correct videos[i].url (Codex P2 round 5).
              shotIndex: i,
            });
            if (!fresh) throw err;
            buf = await downloadAsset(fetchImpl, fresh);
          } else {
            throw err;
          }
        }
        writeFileSync(join(opts.outputsDir, filename), buf);
        // F-B: upload the canonical (single / first) shot to MinIO so the poll
        // handler can presign it. Best-effort — the row is already destined to be
        // marked completed; an upload failure must not throw.
        if (opts.storage && i === 0) {
          await storeArtifact({
            storage: opts.storage,
            jobId: internalJobId,
            bytes: buf,
            contentType: 'video/mp4',
          }).catch((err: unknown) => {
            process.stderr.write(
              `[kling-webhook] MinIO upload failed for ${internalJobId}: ${
                err instanceof Error ? err.message : String(err)
              }\n`,
            );
          });
        }
        const dur = parseFloat(video.duration ?? '0');
        return { dur: Number.isFinite(dur) && dur > 0 ? dur : 0 };
      }),
    );
    const totalDurationSec = results.reduce((sum, r) => sum + r.dur, 0);

    // FIX (Codex P2 round 6, PR#11): Kling may omit per-video `duration` on
    // success payloads (the payload type already marks it optional). Without
    // this fallback, totalDurationSec=0 skips recordActualCost() and the row
    // remains 'pending' forever despite assets being downloaded. Use the
    // recorded estimate as actual when duration is missing, falling back to
    // zero so the terminal status flips no matter what.
    const spec = VIDEO_MODELS[row.model];
    let actualUsd = 0;
    if (spec && spec.pricing.unit === 'usd-per-second' && totalDurationSec > 0) {
      actualUsd = spec.pricing.rate * totalDurationSec;
    } else if (typeof row.est_usd === 'number' && Number.isFinite(row.est_usd)) {
      actualUsd = row.est_usd;
    }
    recordActualCost({ dbPath: opts.dbPath, jobId: internalJobId, actualUsd });
  };
}

async function downloadAsset(fetchImpl: typeof fetch, url: string): Promise<Buffer> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`kling-webhook-handler: asset download failed (${res.status}) for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function isLikelyExpiredUrlError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('403') || msg.includes('404') || msg.includes('expired');
}

interface RefetchArgs {
  readonly fetchImpl: typeof fetch;
  readonly env: KlingEnvSubset;
  readonly nativeTaskId: string;
  readonly mode: string;
  /** Zero-based shot index to extract from videos[] when refreshing multi-shot job. */
  readonly shotIndex?: number;
}

// FIX (Codex P2 round 5, PR#11): per-mode poll URL. The previous collapse to
// text2video meant i2v / motion-brush / elements / lip-sync / extend jobs all
// hit the wrong REST endpoint on TTL refresh and got 404 forever.
function refreshPollPathFor(mode: string): string {
  switch (mode) {
    case 'i2v':
      return '/v1/videos/image2video';
    case 'motion-brush':
    case 'elements':
      return '/v1/motion';
    case 'lip-sync':
      return '/v1/videos/advanced-lip-sync';
    case 'extend':
      return '/v1/videos/video-extend';
    case 'multi-shot':
      return '/v1/videos/omni-video';
    case 't2v':
    default:
      return '/v1/videos/text2video';
  }
}

async function refetchAssetUrl(args: RefetchArgs): Promise<string | undefined> {
  if (!args.nativeTaskId) return undefined;
  const auth = getKlingAuthHeader(args.env);
  const pollPath = refreshPollPathFor(args.mode);
  const url = `${KLING_API_BASE}${pollPath}/${args.nativeTaskId}`;
  const res = await args.fetchImpl(url, { method: 'GET', headers: { ...auth } });
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    data?: { task_result?: { videos?: Array<{ url?: string }> } };
  };
  // FIX (Codex P2 round 5, PR#11): use shotIndex for multi-shot so each shot
  // download finds its correct asset instead of all collapsing to videos[0].
  const idx = args.shotIndex ?? 0;
  return data.data?.task_result?.videos?.[idx]?.url;
}
