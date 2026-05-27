import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebhookHandler, WebhookContext } from './webhook-router.js';
import { recordActualCost } from '../../core/cost-tracker.js';
import { VIDEO_MODELS } from '../../core/models.js';
import { openDb, runMigrations } from '../../core/db.js';
import { getKlingAuthHeader, type KlingEnvSubset } from './auth/kling-jwt.js';

export interface CreateKlingWebhookHandlerOpts {
  readonly dbPath: string;
  readonly outputsDir: string;
  readonly fetchImpl?: typeof fetch;
  /** Env subset for re-poll auth (TTL refresh path). Optional - if absent, no refresh attempted. */
  readonly env?: KlingEnvSubset;
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
      .prepare('SELECT model, native_task_id, mode FROM video_jobs WHERE id = ?')
      .get(internalJobId) as { model?: string; native_task_id?: string; mode?: string } | undefined;
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
      return;
    }

    if (payload.task_status !== 'succeed') {
      return; // processing / submitted - nothing to do yet
    }

    const videos = payload.task_result?.videos ?? [];
    if (videos.length === 0) {
      process.stderr.write(
        `[kling-webhook] job ${internalJobId} succeeded but no video assets in payload\n`,
      );
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
            });
            if (!fresh) throw err;
            buf = await downloadAsset(fetchImpl, fresh);
          } else {
            throw err;
          }
        }
        writeFileSync(join(opts.outputsDir, filename), buf);
        const dur = parseFloat(video.duration ?? '0');
        return { dur: Number.isFinite(dur) && dur > 0 ? dur : 0 };
      }),
    );
    const totalDurationSec = results.reduce((sum, r) => sum + r.dur, 0);

    const spec = VIDEO_MODELS[row.model];
    if (spec && spec.pricing.unit === 'usd-per-second' && totalDurationSec > 0) {
      const actualUsd = spec.pricing.rate * totalDurationSec;
      recordActualCost({ dbPath: opts.dbPath, jobId: internalJobId, actualUsd });
    }
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
}

async function refetchAssetUrl(args: RefetchArgs): Promise<string | undefined> {
  if (!args.nativeTaskId) return undefined;
  const auth = getKlingAuthHeader(args.env);
  const pollType = args.mode === 'multi-shot' ? 'omni-video' : 'text2video';
  const url = `${KLING_API_BASE}/v1/videos/${pollType}/${args.nativeTaskId}`;
  const res = await args.fetchImpl(url, { method: 'GET', headers: { ...auth } });
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    data?: { task_result?: { videos?: Array<{ url?: string }> } };
  };
  return data.data?.task_result?.videos?.[0]?.url;
}
