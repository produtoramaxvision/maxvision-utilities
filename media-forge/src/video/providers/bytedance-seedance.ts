import { fal } from '@fal-ai/client';
import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  JobState,
  DownloadedAsset,
  BytedanceSeedanceExtras,
} from './base.js';
import { VIDEO_MODELS, type Provider, type VideoModelSpec } from '../../core/models.js';
import { recordJob, recordActualCost, getJobRecord } from '../../core/cost-tracker.js';
import { getFalApiKey, type FalEnvSubset } from './auth/fal-key.js';
import {
  submitArkTask,
  pollArkTask,
  ArkAuthConfigError,
  ArkHttpError,
  type ArkStatus,
} from './byteplus-ark.js';

// ---------------------------------------------------------------------------
// Slug + mode helpers (per Amendment A0.2 / A0.4 / A0.6)
// ---------------------------------------------------------------------------

type SeedanceTier = 'fast' | 'standard';

/** Internal Seedance model ids registered in `src/core/models.ts`. NO Pro tier in v2 (A0.1). */
const SEEDANCE_MODEL_IDS = ['seedance-2.0-fast', 'seedance-2.0-standard'] as const;
type SeedanceModelId = (typeof SEEDANCE_MODEL_IDS)[number];

function isSeedanceModel(id: string): id is SeedanceModelId {
  return (SEEDANCE_MODEL_IDS as readonly string[]).includes(id);
}

function tierOf(modelId: SeedanceModelId): SeedanceTier {
  return modelId === 'seedance-2.0-fast' ? 'fast' : 'standard';
}

/**
 * Maps internal mode → fal.ai endpoint segment. A0.4: modes are endpoint selection,
 * NOT in-prompt parameters. `multi-shot` is achieved via prompt structuring on t2v.
 * `targeted-edit` is achieved via i2v + end_image_url frame-anchor transition.
 */
type SeedanceMode = 't2v' | 'i2v' | 'with-refs' | 'multi-shot' | 'targeted-edit';

function modeToEndpointSegment(mode: SeedanceMode): 'text-to-video' | 'image-to-video' | 'reference-to-video' {
  switch (mode) {
    case 't2v':
    case 'multi-shot':
      return 'text-to-video';
    case 'i2v':
    case 'targeted-edit':
      return 'image-to-video';
    case 'with-refs':
      return 'reference-to-video';
  }
}

/**
 * Builds the fal.ai SDK app-id slug per A0.2:
 *   Standard: `bytedance/seedance-2.0/{mode}`
 *   Fast:     `bytedance/seedance-2.0/fast/{mode}`
 *
 * FIX (Codex P1, PR#12): fal.ai docs use the SAME slug for both the
 * @fal-ai/client SDK (fal.queue.submit) and the raw fal.run REST endpoint —
 * NO `fal-ai/` prefix. Earlier intel was wrong on this point. Verified at
 * https://fal.ai/models/bytedance/seedance-2.0/text-to-video/playground.
 *
 * NOTE: `fast` is a path segment BEFORE the mode (not after). Version is in the
 * product name `seedance-2.0` — there is NO `/v2/` infix.
 */
export function falEndpointFor(args: {
  readonly tier: SeedanceTier;
  readonly mode: SeedanceMode;
}): string {
  const seg = modeToEndpointSegment(args.mode);
  if (args.tier === 'fast') {
    return `bytedance/seedance-2.0/fast/${seg}`;
  }
  return `bytedance/seedance-2.0/${seg}`;
}

// ---------------------------------------------------------------------------
// Defensive first-404 logger (debug aid). Mirrors byteplus-ark pattern.
// ---------------------------------------------------------------------------

let _loggedFirst404 = false;
function maybeLog404(endpoint: string, msg: string): void {
  if (_loggedFirst404) return;
  _loggedFirst404 = true;
  process.stderr.write(
    `[bytedance-seedance] WARN: first 404 from fal.ai endpoint — check slug or auth scope.\n` +
      `  endpoint: ${endpoint}\n` +
      `  message: ${msg.slice(0, 400)}\n`,
  );
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function arkStatusToJobState(status: ArkStatus | string): JobState {
  switch (status) {
    case 'queued':
      return 'pending';
    case 'running':
      return 'in_progress';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return 'pending';
  }
}

function falQueueStatusToJobState(s: string): JobState {
  switch (s.toUpperCase()) {
    case 'IN_QUEUE':
      return 'pending';
    case 'IN_PROGRESS':
      return 'in_progress';
    case 'COMPLETED':
    case 'OK':
      return 'completed';
    case 'FAILED':
    case 'ERROR':
      return 'failed';
    case 'CANCELED':
    case 'CANCELLED':
      return 'canceled';
    default:
      return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface JobRoute {
  readonly path: 'fal' | 'ark';
  readonly nativeId: string;
  readonly endpoint?: string; // fal slug, used for status/result calls
  readonly mode: SeedanceMode;
  readonly tier: SeedanceTier;
  readonly durationSec: number; // needed for per-second cost calculation
  // FIX (Codex P2 round 15, PR#12): resolution carried so the completion path
  // can multiply rate × resolutionMultipliers[resolution] × duration. Without
  // it, 1080p / 480p clips record at 720p baseline cost.
  readonly resolution: '480p' | '720p' | '1080p';
}

export interface BytedanceSeedanceEnv extends FalEnvSubset {
  readonly BYTEPLUS_ARK_API_KEY?: string;
  /** Public base URL — webhook URL is built as `${base}/webhooks/bytedance/<jobId>` (A0.7). */
  readonly MEDIA_FORGE_WEBHOOK_PUBLIC_URL?: string;
}

export interface BytedanceSeedanceProviderOptions {
  readonly dbPath: string;
  /** Defaults to `process.env`. Injected by tests. */
  readonly env?: BytedanceSeedanceEnv;
  /**
   * Override fetch (for download() and ARK fallback paths). Resolved at call time
   * via `opts.fetchImpl ?? globalThis.fetch` so per-test injection still intercepts
   * after construction. fal.ai SDK calls bypass this — they are mocked at the
   * `@fal-ai/client` module boundary instead.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * When true, ALWAYS use BytePlus ARK direct REST and bypass fal.ai entirely.
   * Useful for ops that want CN-region routing without changing env wiring. When
   * false (default), fal.ai is primary and ARK is the 5xx/408/429 failover path.
   */
  readonly useArkDirect?: boolean;
}

export class BytedanceSeedanceProvider implements VideoProvider {
  readonly name: Provider = 'bytedance';
  readonly models: VideoModelSpec[];
  private readonly dbPath: string;
  private readonly env: BytedanceSeedanceEnv;
  private readonly fetchImpl?: typeof fetch;
  private readonly useArkDirect: boolean;
  /**
   * In-memory job → route map. Process-bound by design — a server restart
   * loses routing context, in which case pollStatus returns state='failed'
   * with explicit resubmit guidance. Acceptable trade-off for P16 (single-
   * process MCP server). P17 may persist routing alongside cost rows in SQLite.
   */
  private readonly routeByJobId = new Map<string, JobRoute>();
  /** Set once per process so fal.config is not re-invoked on every call. */
  private falConfigured = false;

  constructor(opts: BytedanceSeedanceProviderOptions) {
    this.dbPath = opts.dbPath;
    this.env = opts.env ?? (process.env as unknown as BytedanceSeedanceEnv);
    this.fetchImpl = opts.fetchImpl;
    this.useArkDirect = opts.useArkDirect === true;
    this.models = SEEDANCE_MODEL_IDS.map((id) => {
      const spec = VIDEO_MODELS[id];
      if (!spec) {
        throw new Error(`Seedance model ${id} not registered in VIDEO_MODELS`);
      }
      return spec;
    });
  }

  /** Resolves the active fetch impl at call time so test fetch overrides work. */
  private readonly doFetch: typeof fetch = (input, init) => {
    const f = this.fetchImpl ?? globalThis.fetch;
    return f(input, init);
  };

  /**
   * Configure fal SDK lazily on first use. Throws clearly if FAL_KEY missing —
   * caller can fall back to useArkDirect via opts if they only have ARK creds.
   */
  private ensureFalConfigured(): void {
    if (this.falConfigured) return;
    fal.config({ credentials: getFalApiKey(this.env) });
    this.falConfigured = true;
  }

  // -------------------------------------------------------------------------
  // VideoProvider interface
  // -------------------------------------------------------------------------

  estimateCostUSD(req: VideoGenerationRequest): number {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'bytedance') {
      throw new Error(`model ${req.modelId} is not a bytedance provider model`);
    }
    if (spec.pricing.unit !== 'per-second') {
      throw new Error(
        `Seedance pricing unit expected per-second, got ${spec.pricing.unit} for ${spec.id}`,
      );
    }
    // FIX (Codex P2 round 15, PR#12): apply resolution multiplier — fal.ai
    // Seedance billing scales with the token formula (h × w × dur × 24 / 1024
    // @ $0.014/1k), so 1080p costs ~2.25× the 720p baseline and 480p ~0.4448×.
    // Without this, every estimate / actual was 720p-priced regardless of res.
    const multiplier = spec.pricing.resolutionMultipliers?.[req.resolution] ?? 1;
    return spec.pricing.rate * multiplier * req.durationSec;
  }

  async generate(req: VideoGenerationRequest): Promise<JobHandle> {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'bytedance') {
      throw new Error(`model ${req.modelId} is not a bytedance provider model`);
    }
    if (!isSeedanceModel(req.modelId)) {
      throw new Error(`model ${req.modelId} not a Seedance variant`);
    }

    const mode = req.mode as SeedanceMode;
    const tier = tierOf(req.modelId);
    const jobId = `seedance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // FIX (Codex P2 round 15, PR#12): defer recordJob until AFTER upstream
    // accepts the submit. Previously, failed submits (auth missing, fal 4xx
    // non-retriable, ARK fallback also failing) left a permanent 'pending'
    // row in the cost ledger that no completion path could ever close.
    // estUsd is still computed here for early validation; we pass it down.
    const estUsd = this.estimateCostUSD(req);

    const extras: BytedanceSeedanceExtras | undefined =
      req.extras?.providerKind === 'bytedance' ? (req.extras as BytedanceSeedanceExtras) : undefined;
    const finalPrompt = serializePromptWithExtras(req, extras);

    // FIX (Codex P2 round 20, PR#12): persist native_task_id (fal request_id
    // or ARK task_id) so the webhook handler can bind callbacks to the
    // specific request this process submitted. Without it, ANY ED25519-signed
    // fal.ai callback (JWKS is shared across all fal users) to a known
    // /webhooks/bytedance/<jobId> could mutate that job. The handler validates
    // payload.request_id === row.native_task_id before any state change.
    const recordOnSuccess = (nativeTaskId: string): void => {
      recordJob({
        dbPath: this.dbPath,
        jobId,
        provider: 'bytedance',
        model: req.modelId,
        mode: req.mode,
        paramsHash: hashParams(req),
        estUsd,
        nativeTaskId,
      });
    };

    // Explicit ARK-direct path (A0.8): skip fal.ai entirely.
    if (this.useArkDirect) {
      return this.submitViaArk({ jobId, req, tier, mode, finalPrompt, extras, recordOnSuccess });
    }

    // Primary path: fal.ai SDK.
    const endpoint = falEndpointFor({ tier, mode });
    try {
      this.ensureFalConfigured();
      const input = this.buildFalInput({ req, mode, finalPrompt, extras });
      const submitOpts: Record<string, unknown> = { input };
      const webhookUrl = this.buildWebhookUrl(jobId);
      if (webhookUrl) submitOpts.webhookUrl = webhookUrl;

      const submitRes = (await fal.queue.submit(endpoint, submitOpts as never)) as
        | { request_id?: string; requestId?: string };
      const nativeId = submitRes.request_id ?? submitRes.requestId;
      if (typeof nativeId !== 'string' || nativeId.length === 0) {
        throw new Error('fal.queue.submit returned no request_id');
      }

      // Submit accepted — safe to record the ledger row + route.
      recordOnSuccess(nativeId);
      this.routeByJobId.set(jobId, {
        path: 'fal',
        nativeId,
        endpoint,
        mode,
        tier,
        durationSec: req.durationSec,
        resolution: req.resolution as '480p' | '720p' | '1080p',
      });
      return {
        jobId,
        provider: 'bytedance',
        model: req.modelId,
        mode: req.mode,
        createdAt: new Date().toISOString(),
        providerNativeId: nativeId,
      };
    } catch (falErr) {
      const status = extractHttpStatus(falErr);
      if (status === 404) {
        maybeLog404(endpoint, (falErr as Error).message ?? '(no message)');
      }

      // Only fall back on transient (5xx/408/429) or network errors. 4xx (other
      // than 408/429) means the request is malformed and ARK will fail identically.
      const isTransient =
        typeof status !== 'number' ||
        (status >= 500 && status < 600) ||
        status === 408 ||
        status === 429;
      if (!isTransient) throw falErr;

      process.stderr.write(
        `[bytedance-seedance] fal.ai ${status ?? 'network'} error, falling back to BytePlus ARK: ${
          (falErr as Error).message
        }\n`,
      );

      try {
        return await this.submitViaArk({ jobId, req, tier, mode, finalPrompt, extras, recordOnSuccess });
      } catch (arkErr) {
        if (arkErr instanceof ArkAuthConfigError) {
          throw new Error(
            `Seedance generation failed: fal.ai unavailable AND BYTEPLUS_ARK_API_KEY not set. ` +
              `Set the fallback key or wait for fal.ai recovery. Original fal.ai error: ${
                (falErr as Error).message
              }`,
          );
        }
        throw new Error(
          `Seedance generation failed on both paths. fal.ai: ${(falErr as Error).message}. ` +
            `ARK fallback: ${(arkErr as Error).message}`,
        );
      }
    }
  }

  async pollStatus(jobId: string): Promise<JobStatus> {
    const route = this.routeByJobId.get(jobId);
    if (!route) {
      // RESTART-LOSS: routeByJobId is in-memory. If the process restarted,
      // surface a clear failure so callers can resubmit. P17 persists routing.
      return {
        jobId,
        state: 'failed',
        errorMessage:
          'route for job not found (server may have restarted); resubmit the generation request',
      };
    }

    let state: JobState;
    let assetUrls: string[] | undefined;
    let errorMessage: string | undefined;

    if (route.path === 'fal') {
      this.ensureFalConfigured();
      const ep = route.endpoint ?? falEndpointFor({ tier: route.tier, mode: route.mode });
      let statusRes: { status?: string };
      try {
        statusRes = (await fal.queue.status(ep, {
          requestId: route.nativeId,
          logs: true,
        } as never)) as { status?: string };
      } catch (err) {
        if (extractHttpStatus(err) === 404) maybeLog404(ep, (err as Error).message ?? '');
        throw err;
      }
      state = falQueueStatusToJobState(statusRes.status ?? 'IN_QUEUE');
      if (state === 'completed') {
        const resultRes = (await fal.queue.result(ep, {
          requestId: route.nativeId,
        } as never)) as { data?: { video?: { url?: string } } };
        const url = resultRes.data?.video?.url;
        assetUrls = url ? [url] : [];
      }
    } else {
      // ARK fallback path
      const arkRes = await pollArkTask({
        taskId: route.nativeId,
        fetchImpl: this.fetchImpl,
        ...(this.env.BYTEPLUS_ARK_API_KEY ? { apiKey: this.env.BYTEPLUS_ARK_API_KEY } : {}),
      });
      state = arkStatusToJobState(arkRes.status);
      assetUrls = arkRes.videoUrl ? [arkRes.videoUrl] : undefined;
      errorMessage = arkRes.errorMessage;
    }

    // COST RECORDING (A0.3 + invariants):
    // On transition TO 'completed', persist `pricing.rate × durationSec` using
    // the per-tier rate from VIDEO_MODELS[row.model]. NEVER hardcode a tier.
    // recordActualCost's `WHERE actual_usd IS NULL` guard makes re-poll a no-op.
    // FIX (Codex P2 round 15, PR#12): apply resolution multiplier so 1080p /
    // 480p clips record at the correct fal.ai token-formula price (was always
    // recording 720p baseline regardless of resolution).
    if (state === 'completed') {
      const row = getJobRecord({ dbPath: this.dbPath, jobId });
      if (row?.model) {
        const spec = VIDEO_MODELS[row.model];
        if (spec?.pricing.unit === 'per-second') {
          const multiplier = spec.pricing.resolutionMultipliers?.[route.resolution] ?? 1;
          recordActualCost({
            dbPath: this.dbPath,
            jobId,
            actualUsd: spec.pricing.rate * multiplier * route.durationSec,
          });
        }
      }
    } else if (state === 'failed' || state === 'canceled' || state === 'nsfw') {
      // FIX (Codex P2 round 16, PR#12): persist terminal Seedance failures.
      // Previously these poll results bubbled up to the caller but the row
      // stayed at 'pending' forever — symmetric with the round 13/15 Kling
      // poll/webhook failed-state bugs. Idempotent via the existing
      // `WHERE actual_usd IS NULL` guard in recordActualCost.
      recordActualCost({
        dbPath: this.dbPath,
        jobId,
        actualUsd: 0,
        finalStatus: state,
      });
    }

    if (state !== 'completed') {
      return { jobId, state, errorMessage };
    }
    return {
      jobId,
      state: 'completed',
      progress: 1,
      assetUrls,
      errorMessage,
    };
  }

  async download(jobIdOrUrl: string): Promise<DownloadedAsset> {
    // Seedance assets live on remote CDNs (fal.cdn or ark.cdn). Signed URLs may
    // expire (~1h per fal.ai docs). On 403/404 for a previously-completed URL,
    // re-poll once to fetch a fresh URL and retry. Bounded to one refresh attempt.
    const isUrl = /^https?:\/\//.test(jobIdOrUrl);
    const initialUrl = isUrl ? jobIdOrUrl : await this.resolveAssetUrl(jobIdOrUrl);

    let attemptUrl = initialUrl;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.doFetch(attemptUrl, { method: 'GET' });
      if (res.ok) {
        const arr = await res.arrayBuffer();
        const buf = Buffer.from(arr);
        return {
          buffer: buf,
          metadata: {
            contentType: res.headers.get('content-type') ?? 'video/mp4',
            sizeBytes: buf.length,
            cdnUrl: attemptUrl,
          },
        };
      }
      const isStaleSignal = res.status === 403 || res.status === 404;
      if (!isStaleSignal || attempt === 1 || isUrl) {
        throw new Error(`download: HTTP ${res.status} fetching ${attemptUrl}`);
      }
      // Refresh once via re-poll.
      attemptUrl = await this.resolveAssetUrl(jobIdOrUrl);
    }
    throw new Error(`download: failed after refresh-retry for ${jobIdOrUrl}`);
  }

  async recordActualCostUSD(jobId: string, usd: number): Promise<void> {
    recordActualCost({ dbPath: this.dbPath, jobId, actualUsd: usd });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async resolveAssetUrl(jobId: string): Promise<string> {
    const status = await this.pollStatus(jobId);
    if (status.state !== 'completed' || !status.assetUrls?.[0]) {
      throw new Error(`download: job ${jobId} not completed (state=${status.state})`);
    }
    return status.assetUrls[0];
  }

  /** Builds the fal.ai input body per A0.6 — verified shape per mode. */
  private buildFalInput(args: {
    readonly req: VideoGenerationRequest;
    readonly mode: SeedanceMode;
    readonly finalPrompt: string;
    readonly extras: BytedanceSeedanceExtras | undefined;
  }): Record<string, unknown> {
    const { req, mode, finalPrompt, extras } = args;

    const input: Record<string, unknown> = {
      prompt: finalPrompt,
      resolution: req.resolution,
      aspect_ratio: req.aspectRatio ?? 'auto',
      // FIX (Codex P2, PR#12): honor extras.generateAudio when caller explicitly
      // sets it via schema. Default true matches fal.ai default behavior.
      generate_audio: extras?.generateAudio ?? true,
    };
    // FIX (Codex P2 round 13, PR#12): omit `duration` entirely when the caller
    // left it unset (extras.durationAutoMode === true). Sending an explicit
    // numeric duration here defeats fal.ai's `"auto"` default and forces a
    // fixed-length clip even when the user explicitly opted in to auto-mode.
    if (extras?.durationAutoMode !== true) {
      input.duration = String(req.durationSec);
    }
    if (extras?.cameraFixed === true) input.camera_fixed = true;
    if (typeof extras?.seed === 'number') input.seed = extras.seed;
    if (extras?.endUserId) input.end_user_id = extras.endUserId;

    if (mode === 'i2v' || mode === 'targeted-edit') {
      const imageUrl = req.firstFrameImagePath ?? extras?.referenceImageUrls?.[0];
      if (!imageUrl) {
        throw new Error(`mode=${mode} requires firstFrameImagePath or extras.referenceImageUrls[0]`);
      }
      input.image_url = imageUrl;
      const endFrame = req.lastFrameImagePath;
      if (endFrame) input.end_image_url = endFrame;
    }
    if (mode === 'with-refs') {
      if (extras?.referenceImageUrls && extras.referenceImageUrls.length > 0) {
        input.image_urls = [...extras.referenceImageUrls];
      }
      if (extras?.referenceVideoUrls && extras.referenceVideoUrls.length > 0) {
        input.video_urls = [...extras.referenceVideoUrls];
      }
      if (extras?.referenceAudioUrls && extras.referenceAudioUrls.length > 0) {
        input.audio_urls = [...extras.referenceAudioUrls];
      }
    }
    return input;
  }

  /**
   * A0.7 webhook URL convention — jobId embedded in path so the router extracts it.
   *
   * P16.W FASE 3 (PR#12): removed the MEDIA_FORGE_SEEDANCE_WEBHOOK_INSECURE
   * opt-in gate. The router now supports fal.ai's native ED25519+JWKS signature
   * scheme (see ./auth/fal-ed25519.ts + webhook-router.ts:registerAuthValidator),
   * so callbacks no longer 401. Earlier comment claiming "fal.ai cannot sign"
   * was based on a misread — fal.ai signs with ED25519 (verified via context7
   * → /websites/fal_ai docs/inference/webhooks), our router was just HMAC-only.
   *
   * Returns the webhook URL when MEDIA_FORGE_WEBHOOK_PUBLIC_URL is set,
   * undefined otherwise (polling-only fallback for local dev / restricted
   * deployments).
   */
  private buildWebhookUrl(jobId: string): string | undefined {
    const base = this.env.MEDIA_FORGE_WEBHOOK_PUBLIC_URL;
    if (!base) return undefined;
    return `${base.replace(/\/$/, '')}/webhooks/bytedance/${encodeURIComponent(jobId)}`;
  }

  private async submitViaArk(args: {
    readonly jobId: string;
    readonly req: VideoGenerationRequest;
    readonly tier: SeedanceTier;
    readonly mode: SeedanceMode;
    readonly finalPrompt: string;
    readonly extras: BytedanceSeedanceExtras | undefined;
    readonly recordOnSuccess: (nativeTaskId: string) => void;
  }): Promise<JobHandle> {
    const { jobId, req, tier, mode, finalPrompt, extras, recordOnSuccess } = args;
    try {
      const arkRes = await submitArkTask({
        model: req.modelId,
        prompt: finalPrompt,
        durationSec: req.durationSec,
        resolution: req.resolution as '480p' | '720p' | '1080p',
        aspectRatio: req.aspectRatio as
          | '21:9'
          | '16:9'
          | '4:3'
          | '1:1'
          | '3:4'
          | '9:16'
          | undefined,
        // FIX (Codex P1, PR#12): preserve frame images on ARK fallback.
        // handleSeedanceImageToVideo stores start/end frames in
        // req.firstFrameImagePath/req.lastFrameImagePath, NOT in
        // extras.referenceImageUrls. Without this merge, i2v jobs
        // silently become text-only when ARK path is taken.
        imageUrls: [
          ...(req.firstFrameImagePath ? [req.firstFrameImagePath] : []),
          ...(req.lastFrameImagePath ? [req.lastFrameImagePath] : []),
          ...(extras?.referenceImageUrls ?? []),
        ].filter((url): url is string => Boolean(url)),
        videoUrls: extras?.referenceVideoUrls,
        audioUrls: extras?.referenceAudioUrls,
        seed: extras?.seed,
        // FIX (Codex P2, PR#12): forward endUserId on ARK path so attribution
        // is preserved when fal.ai fails over OR useArkDirect=true.
        ...(extras?.endUserId ? { endUserId: extras.endUserId } : {}),
        fetchImpl: this.fetchImpl,
        // FIX (Codex P2, PR#12): pass injected ARK key so providers with
        // constructor-injected env (tests + runtime) authenticate correctly
        // instead of falling back to process.env.
        ...(this.env.BYTEPLUS_ARK_API_KEY ? { apiKey: this.env.BYTEPLUS_ARK_API_KEY } : {}),
      });
      // ARK submit accepted — safe to record the ledger row + route.
      recordOnSuccess(arkRes.taskId);
      this.routeByJobId.set(jobId, {
        path: 'ark',
        nativeId: arkRes.taskId,
        mode,
        tier,
        durationSec: req.durationSec,
        resolution: req.resolution as '480p' | '720p' | '1080p',
      });
      return {
        jobId,
        provider: 'bytedance',
        model: req.modelId,
        mode: req.mode,
        createdAt: new Date().toISOString(),
        providerNativeId: arkRes.taskId,
      };
    } catch (arkErr) {
      if (arkErr instanceof ArkHttpError && arkErr.status === 404) {
        maybeLog404('ark', arkErr.message);
      }
      throw arkErr;
    }
  }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/**
 * Serializes multiShotTimestamps into the prompt as hard-cut markers per Seedance
 * docs: `[00:00-00:05] Shot 1: ... [00:05-00:10] Shot 2: ...`. Passes through
 * unchanged when no timestamps present.
 */
function serializePromptWithExtras(
  req: VideoGenerationRequest,
  extras: BytedanceSeedanceExtras | undefined,
): string {
  if (!extras?.multiShotTimestamps || extras.multiShotTimestamps.length === 0) {
    return req.prompt;
  }
  const shots = extras.multiShotTimestamps
    .map((s, i) => `[${fmtSec(s.start)}-${fmtSec(s.end)}] Shot ${i + 1}: ${s.prompt}`)
    .join(' ');
  return `${req.prompt}\n\n${shots}`;
}

function fmtSec(s: number): string {
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function hashParams(req: VideoGenerationRequest): string {
  const json = JSON.stringify({
    modelId: req.modelId,
    mode: req.mode,
    prompt: req.prompt,
    durationSec: req.durationSec,
    resolution: req.resolution,
    aspectRatio: req.aspectRatio,
    extras: req.extras,
  });
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

function extractHttpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.response?.status === 'number') return e.response.status;
  return undefined;
}

// ---------------------------------------------------------------------------
// Lazy singleton — handlers.ts (Task 7) reuses one instance per process.
// Mirrors the pattern Kling/Higgsfield handlers will adopt; safe because
// providers are stateful only via in-memory routeByJobId + falConfigured flag.
// ---------------------------------------------------------------------------

let _singleton: BytedanceSeedanceProvider | undefined;

export function getBytedanceSeedanceProvider(
  opts: BytedanceSeedanceProviderOptions,
): BytedanceSeedanceProvider {
  if (!_singleton) {
    _singleton = new BytedanceSeedanceProvider(opts);
  }
  return _singleton;
}

/** Test hook: reset the lazy singleton so each test gets a fresh instance. */
export function __resetBytedanceSeedanceSingleton(): void {
  _singleton = undefined;
}
