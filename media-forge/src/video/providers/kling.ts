import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  JobState,
  DownloadedAsset,
  KlingExtras,
  ProviderExtras,
} from './base.js';
import { VIDEO_MODELS, type Provider, type VideoModelSpec } from '../../core/models.js';
import { recordJob, recordActualCost } from '../../core/cost-tracker.js';
import { getKlingAuthHeader, type KlingEnvSubset } from './auth/kling-jwt.js';

const KLING_API_BASE = 'https://api-singapore.klingai.com';

export interface KlingEnv extends KlingEnvSubset {
  readonly MEDIA_FORGE_WEBHOOK_PUBLIC_URL?: string;
}

export interface KlingProviderOptions {
  readonly dbPath: string;
  readonly env: KlingEnv;
  /** Inject for tests. Defaults to globalThis.fetch at call time (Node 18+). */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Identifies which Kling REST capability the request maps to. Used both to pick the
 * POST endpoint (via `endpointPathFor`) and to derive the GET poll path
 * (`pollPathFor`, since some endpoints live OUTSIDE the `/v1/videos/` tree
 * — notably motion brush at `/v1/motion/generate` per A8 amendment).
 */
type KlingEndpointKind =
  | 'text2video'
  | 'image2video'
  | 'omni-video'
  | 'motion-brush'
  | 'lip-sync'
  | 'video-extend';

interface JobTypeRecord {
  readonly endpointKind: KlingEndpointKind;
  readonly nativeTaskId: string;
}

interface KlingErrorBody {
  readonly code?: number;
  readonly message?: string;
}

interface KlingGenerateResponseBody {
  readonly code?: number;
  readonly message?: string;
  readonly data?: { readonly task_id?: string };
}

interface KlingPollResponseBody {
  readonly code?: number;
  readonly message?: string;
  readonly data?: {
    readonly task_status?: string;
    readonly task_status_msg?: string;
    readonly task_result?: {
      readonly videos?: ReadonlyArray<{ readonly url?: string; readonly duration?: string }>;
    };
  };
}

export class KlingProvider implements VideoProvider {
  readonly name: Provider = 'kling';
  readonly models: VideoModelSpec[];
  private readonly dbPath: string;
  private readonly env: KlingEnv;
  // Stored as optional and resolved at call time so tests that override
  // `global.fetch` after construction still intercept network I/O. Capturing
  // `globalThis.fetch.bind(...)` at construction time freezes the reference
  // and would let real api-singapore.klingai.com calls leak through the mock.
  // (P14 hit this bug; HiggsfieldProvider uses the same lazy pattern.)
  private readonly fetchImpl?: typeof fetch;
  /** Per-process map: internal jobId -> endpoint kind + native Kling task_id. Used by pollStatus + download. */
  private readonly jobTypeMap = new Map<string, JobTypeRecord>();

  constructor(opts: KlingProviderOptions) {
    this.dbPath = opts.dbPath;
    this.env = opts.env;
    this.fetchImpl = opts.fetchImpl;
    this.models = [
      VIDEO_MODELS['kling-v3-standard'],
      VIDEO_MODELS['kling-v3-pro'],
      VIDEO_MODELS['kling-v3-master'],
      VIDEO_MODELS['kling-v3-omni'],
    ].filter((m): m is VideoModelSpec => Boolean(m));
  }

  /** Resolves the active fetch impl at call time so test fetch overrides work. */
  private readonly doFetch: typeof fetch = (input, init) => {
    const f = this.fetchImpl ?? globalThis.fetch;
    return f(input, init);
  };

  /** Test hook — seeds the jobType map without going through generate(). */
  _rememberJobType(jobId: string, endpointKind: KlingEndpointKind, nativeTaskId: string): void {
    this.jobTypeMap.set(jobId, { endpointKind, nativeTaskId });
  }

  estimateCostUSD(req: VideoGenerationRequest): number {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'kling') {
      throw new Error(`model ${req.modelId} is not a kling provider model`);
    }
    if (spec.pricing.unit !== 'usd-per-second') {
      throw new Error(`Kling pricing unit expected usd-per-second, got ${spec.pricing.unit}`);
    }
    return spec.pricing.rate * req.durationSec;
  }

  async generate(req: VideoGenerationRequest): Promise<JobHandle> {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'kling') {
      throw new Error(`model ${req.modelId} is not a kling provider model`);
    }

    const klingExtras = isKlingExtras(req.extras) ? req.extras : undefined;
    const jobId = `kling-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const endpointKind = pickEndpoint(req.mode, klingExtras);
    const endpointPath = endpointPathFor(endpointKind);
    const body = buildRequestBody({ req, spec, jobId, extras: klingExtras, env: this.env });

    const watermarkOn = klingExtras?.watermarkEnabled === true;
    if (watermarkOn) {
      process.stderr.write(
        `[kling] WARNING: explicit watermark_info.enabled=true on paid key — likely misconfig. ` +
          `Default policy is watermark off on paid tier. Set extras.watermarkEnabled=false to suppress this warning.\n`,
      );
    }

    const auth = getKlingAuthHeader(this.env);
    const url = `${KLING_API_BASE}${endpointPath}`;
    const res = await this.doFetch(url, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as KlingErrorBody;
      throw new Error(
        `Kling API ${res.status} ${errBody.code ?? 'unknown'}: ${errBody.message ?? '(no message)'}`,
      );
    }
    const payload = (await res.json()) as KlingGenerateResponseBody;
    if (payload.code !== 0 || !payload.data?.task_id) {
      throw new Error(
        `Kling API returned non-zero code ${payload.code ?? 'unknown'} ${payload.message ?? ''}`.trim(),
      );
    }
    const nativeTaskId = payload.data.task_id;

    // Remember the endpoint kind so pollStatus knows which GET path to use
    this.jobTypeMap.set(jobId, { endpointKind, nativeTaskId });

    // Cost-tracker entry (estimate, status=pending)
    const estUsd = this.estimateCostUSD(req);
    recordJob({
      dbPath: this.dbPath,
      jobId,
      provider: 'kling',
      model: req.modelId,
      mode: req.mode,
      paramsHash: hashParams(req),
      estUsd,
      nativeTaskId,
    });

    // NOTE: no global request_id<->jobId map needed. The webhook handler resolves identity from
    // the URL path `/webhooks/kling/{jobId}` (P14 router extracts as `ctx.jobId`). The native
    // Kling task_id is preserved in this provider's per-process `jobTypeMap` (above) for polling.

    return {
      jobId,
      provider: 'kling',
      model: req.modelId,
      mode: req.mode,
      createdAt: new Date().toISOString(),
      providerNativeId: nativeTaskId,
    };
  }

  async pollStatus(jobId: string): Promise<JobStatus> {
    const rec = this.jobTypeMap.get(jobId);
    if (!rec) {
      throw new Error(
        `pollStatus: unknown jobId ${jobId} — either generate() was not called in this process or the job predates webhook restart`,
      );
    }
    const auth = getKlingAuthHeader(this.env);
    const url = `${KLING_API_BASE}${pollPathFor(rec.endpointKind, rec.nativeTaskId)}`;
    const res = await this.doFetch(url, {
      method: 'GET',
      headers: { ...auth },
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as KlingErrorBody;
      throw new Error(`Kling poll API ${res.status}: ${errBody.message ?? '(no message)'}`);
    }
    const payload = (await res.json()) as KlingPollResponseBody;
    const klingState = payload.data?.task_status ?? 'processing';
    const state = mapKlingState(klingState);
    const assetUrls = (payload.data?.task_result?.videos ?? [])
      .map((v) => v.url)
      .filter((u): u is string => typeof u === 'string');
    return {
      jobId,
      state,
      assetUrls: assetUrls.length > 0 ? assetUrls : undefined,
      errorMessage: state === 'failed' ? payload.data?.task_status_msg : undefined,
      progress: state === 'completed' ? 1 : undefined,
    };
  }

  async download(jobIdOrUrl: string): Promise<DownloadedAsset> {
    // If it looks like a URL, fetch it directly. Otherwise, look up jobId -> URL via pollStatus.
    let assetUrl: string;
    if (jobIdOrUrl.startsWith('http://') || jobIdOrUrl.startsWith('https://')) {
      assetUrl = jobIdOrUrl;
    } else {
      const status = await this.pollStatus(jobIdOrUrl);
      const url = status.assetUrls?.[0];
      if (!url) {
        throw new Error(
          `download: jobId ${jobIdOrUrl} has no asset URL (state=${status.state}). Asset URLs from Kling are temporary — download immediately after webhook fires.`,
        );
      }
      assetUrl = url;
    }
    const res = await this.doFetch(assetUrl);
    if (!res.ok) {
      throw new Error(`Kling asset download failed: ${res.status} ${res.statusText}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      buffer: buf,
      metadata: {
        contentType: res.headers.get('content-type') ?? 'video/mp4',
        sizeBytes: buf.length,
        cdnUrl: assetUrl,
      },
    };
  }

  async recordActualCostUSD(jobId: string, usd: number): Promise<void> {
    recordActualCost({ dbPath: this.dbPath, jobId, actualUsd: usd });
  }
}

function isKlingExtras(extras: ProviderExtras | undefined): extras is KlingExtras {
  return extras?.providerKind === 'kling';
}

function pickEndpoint(mode: string, extras: KlingExtras | undefined): KlingEndpointKind {
  if (mode === 'multi-shot' || extras?.omniMultiShot) return 'omni-video';
  if (mode === 'motion-brush' || extras?.motionBrushRegions) return 'motion-brush';
  // elements composition uses motion-brush endpoint per Kling motion API docs (context7) — element_list serialization shared
  if (mode === 'elements' || (extras?.elementIds && extras.elementIds.length > 0)) return 'motion-brush';
  if (mode === 'lip-sync' || extras?.lipSync) return 'lip-sync';
  if (mode === 'extend') return 'video-extend';
  if (mode === 'i2v') return 'image2video';
  return 'text2video';
}

/**
 * Maps an endpoint kind to its full POST path on api-singapore.klingai.com.
 *
 * A8 corrections (intel: 2026-05-27-kling-verified-endpoints.md):
 *  - motion-brush -> /v1/motion/generate (NOT /v1/videos/motion/generate; different REST tree)
 *  - lip-sync     -> /v1/videos/advanced-lip-sync (NOT /v1/videos/lip-sync)
 *  - omni-video   -> /v1/videos/omni-video/ (trailing slash required)
 */
function endpointPathFor(kind: KlingEndpointKind): string {
  switch (kind) {
    case 'text2video':
      return '/v1/videos/text2video';
    case 'image2video':
      return '/v1/videos/image2video';
    case 'omni-video':
      return '/v1/videos/omni-video/';
    case 'motion-brush':
      return '/v1/motion/generate';
    case 'lip-sync':
      return '/v1/videos/advanced-lip-sync';
    case 'video-extend':
      return '/v1/videos/video-extend';
  }
}

/**
 * Maps an endpoint kind + native Kling task id to the GET status poll path.
 * Most endpoints follow `/v1/videos/{type}/{task_id}` but motion-brush lives
 * under `/v1/motion/{task_id}` (different REST tree).
 */
function pollPathFor(kind: KlingEndpointKind, taskId: string): string {
  switch (kind) {
    case 'text2video':
      return `/v1/videos/text2video/${taskId}`;
    case 'image2video':
      return `/v1/videos/image2video/${taskId}`;
    case 'omni-video':
      return `/v1/videos/omni-video/${taskId}`;
    case 'motion-brush':
      return `/v1/motion/${taskId}`;
    case 'lip-sync':
      return `/v1/videos/advanced-lip-sync/${taskId}`;
    case 'video-extend':
      return `/v1/videos/video-extend/${taskId}`;
  }
}

interface BuildBodyArgs {
  readonly req: VideoGenerationRequest;
  readonly spec: VideoModelSpec;
  readonly jobId: string;
  readonly extras: KlingExtras | undefined;
  readonly env: KlingEnv;
}

function buildRequestBody(args: BuildBodyArgs): Record<string, unknown> {
  const { req, spec, jobId, extras, env } = args;
  const klingMode =
    extras?.klingMode ?? (spec.id.includes('-pro') || spec.id.includes('-master') ? 'pro' : 'std');
  const watermarkEnabled = extras?.watermarkEnabled ?? false;

  const callbackUrl =
    extras?.callbackUrl ??
    (env.MEDIA_FORGE_WEBHOOK_PUBLIC_URL
      ? `${env.MEDIA_FORGE_WEBHOOK_PUBLIC_URL}/webhooks/kling/${encodeURIComponent(jobId)}`
      : undefined);
  const externalTaskId = extras?.externalTaskId ?? jobId;

  const modelName = spec.id === 'kling-v3-omni' ? 'kling-v3-omni' : 'kling-v3';

  // Omni multi-shot has a distinct body shape — handle explicitly
  if (req.mode === 'multi-shot' || extras?.omniMultiShot) {
    if (!extras?.omniMultiShot) {
      throw new Error('multi-shot mode requires extras.omniMultiShot');
    }
    return {
      model_name: modelName,
      multi_shot: true,
      shot_type: 'customize',
      multi_prompt: extras.omniMultiShot.multiPrompt.map((s) => ({
        index: s.index,
        prompt: s.prompt,
        duration: s.duration,
      })),
      image_list: extras.omniMultiShot.imageList.map((img) => ({ image_url: img.imageUrl })),
      ...(extras.omniMultiShot.videoList
        ? { video_list: extras.omniMultiShot.videoList.map((v) => ({ video_url: v.videoUrl })) }
        : {}),
      mode: 'pro',
      sound: 'on',
      aspect_ratio: req.aspectRatio ?? '16:9',
      duration: String(req.durationSec),
      watermark_info: { enabled: watermarkEnabled },
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      external_task_id: externalTaskId,
    };
  }

  // Motion brush + elements — A8 endpoint /v1/motion/generate
  // elements mode shares the same body shape: element_list is serialized from extras.elementIds
  if (req.mode === 'motion-brush' || req.mode === 'elements' || extras?.motionBrushRegions) {
    return {
      model_name: modelName,
      prompt: req.prompt,
      image_url: req.firstFrameImagePath,
      video_url: extras?.motionReferenceVideoUrl,
      character_orientation: extras?.characterOrientation ?? 'image',
      ...(extras?.elementIds
        ? { element_list: extras.elementIds.map((id) => ({ element_id: id })) }
        : {}),
      keep_original_sound: 'no',
      mode: klingMode,
      watermark_info: { enabled: watermarkEnabled },
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      external_task_id: externalTaskId,
    };
  }

  // i2v
  if (req.mode === 'i2v') {
    return {
      model_name: modelName,
      prompt: req.prompt,
      image_url: req.firstFrameImagePath,
      duration: String(req.durationSec),
      mode: klingMode,
      sound: 'on',
      aspect_ratio: req.aspectRatio ?? '16:9',
      watermark_info: { enabled: watermarkEnabled },
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      external_task_id: externalTaskId,
    };
  }

  // Default: t2v
  return {
    model_name: modelName,
    prompt: req.prompt,
    duration: String(req.durationSec),
    mode: klingMode,
    sound: 'on',
    aspect_ratio: req.aspectRatio ?? '16:9',
    watermark_info: { enabled: watermarkEnabled },
    ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    external_task_id: externalTaskId,
  };
}

function mapKlingState(klingState: string): JobState {
  switch (klingState) {
    case 'succeed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'processing':
    case 'submitted':
      return 'in_progress';
    default:
      return 'pending';
  }
}

function hashParams(req: VideoGenerationRequest): string {
  const json = JSON.stringify({
    modelId: req.modelId,
    mode: req.mode,
    prompt: req.prompt,
    durationSec: req.durationSec,
    resolution: req.resolution,
    aspectRatio: req.aspectRatio,
  });
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}
