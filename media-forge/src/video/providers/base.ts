import type { Provider, VideoMode, VideoModelSpec } from '../../core/models.js';

/**
 * Provider-specific extras union — each provider extends with its own typed extras
 * object. P13 shipped `GoogleVeoExtras`. P14 adds `HiggsfieldExtras` covering Soul ID,
 * DoP camera verbs, Cinema Studio lens params, Speak audio, Marketing Studio template,
 * multi-reference images, Recast target character, Virality Predictor toggle, and the
 * aggregator proxy (Higgsfield-as-proxy-to-Veo/Kling/Seedance/Sora). P15 adds
 * KlingExtras, P16 adds BytedanceSeedanceExtras.
 *
 * Discriminated by `providerKind`; never collapse to Record<string, unknown>.
 */
export interface GoogleVeoExtras {
  readonly providerKind: 'google';
  // Veo-specific extras are absent in P13/P14 — Veo controls live on base request fields.
}

export interface HiggsfieldCinemaStudioParams {
  readonly focalLengthMm?: number;
  readonly apertureFStop?: number;
  readonly sensorSize?: 'full-frame' | 'super35' | 'apsc' | 'm43' | 'imax';
  readonly colorGrading?: 'teal-orange' | 'bleach-bypass' | 'noir' | 'pastel' | 'vibrant' | string;
  readonly lensId?: string;
}

export interface HiggsfieldExtras {
  readonly providerKind: 'higgsfield';

  /** Soul ID handle from createSoulId — reused across generations for character consistency. */
  readonly soulId?: string;

  /** DoP / WAN Camera Control verbs prepended to the prompt (dolly_in, crash_zoom, ...). */
  readonly dopCameraVerbs?: ReadonlyArray<string>;

  /** Cinema Studio 3.5 lens / focal length / aperture / sensor / grading dictionary. */
  readonly cinemaStudioParams?: HiggsfieldCinemaStudioParams;

  /** Speak lip-sync source audio (local path resolved to data URL or Higgsfield upload). */
  readonly speakAudioPath?: string;

  /** Marketing Studio template id — one of the 9 UGC templates. */
  readonly marketingStudioTemplate?:
    | 'ugc'
    | 'unboxing'
    | 'tv-spot'
    | 'hyper-motion'
    | 'product-review'
    | 'asmr'
    | 'lifestyle'
    | 'testimonial'
    | 'reel';

  /** Marketing Studio product reference URL. */
  readonly marketingStudioProductUrl?: string;

  /** Multi-Reference composition for style consistency (Soul 2.0 + Cinema Studio). */
  readonly multiReferenceImages?: ReadonlyArray<string>;

  /** Recast Studio — character to swap into existing video. */
  readonly recastTargetCharacterPath?: string;

  /** Score the asset for predicted virality before approval (returns score on completion). */
  readonly viralityPredictor?: boolean;

  /**
   * Aggregator proxy — Higgsfield can invoke Veo / Kling / Seedance / Sora on the caller's
   * behalf. Specifying this routes the request through Higgsfield's catalog endpoint.
   */
  readonly aggregatorProxyModel?: string;

  /**
   * Webhook URL the platform should POST completion events to. When absent, the provider
   * falls back to polling. Constructed by HiggsfieldProvider.generate as
   * `${MEDIA_FORGE_WEBHOOK_PUBLIC_URL}/webhooks/higgsfield/${jobId}` so the path segment
   * already equals our internal jobId for webhook routing.
   */
  readonly webhookUrl?: string;
}

/**
 * Kling V3 provider-specific extras. Covers all Kling production modes added in P15:
 * motion brush regions, elements multi-reference, lip-sync (text or audio + emotion),
 * Omni multi-shot orchestration (up to 6 cuts with per-shot prompt + duration),
 * watermark policy, character orientation for motion control, optional callback URL.
 *
 * All fields optional — only those relevant to the active mode are populated. Validators
 * in `KlingProvider.generate()` cross-check mode → required-extras compatibility.
 */
export interface KlingMotionBrushRegion {
  readonly id: string;
  /** Polygon points in image-space pixel coordinates. */
  readonly polygon: ReadonlyArray<readonly [number, number]>;
  /** Motion vector [dx, dy] per second in image-space pixels. */
  readonly motionVector: readonly [number, number];
}

export interface KlingLipSyncSpec {
  readonly mode: 'text' | 'audio';
  readonly text?: string;
  readonly audioUrl?: string;
  readonly emotion?: 'happy' | 'angry' | 'sad' | 'neutral';
}

export interface KlingOmniShot {
  readonly index: number;
  readonly prompt: string;
  /** Per-shot duration in seconds. Sum across shots ≤ Omni maxDurationSec. */
  readonly duration: number;
}

export interface KlingOmniSpec {
  readonly multiPrompt: ReadonlyArray<KlingOmniShot>;
  readonly imageList: ReadonlyArray<{ readonly imageUrl: string }>;
  readonly videoList?: ReadonlyArray<{ readonly videoUrl: string }>;
}

export interface KlingExtras {
  readonly providerKind: 'kling';
  /** Motion brush — region paint with motion vectors (Kling V3 Pro only). */
  readonly motionBrushRegions?: ReadonlyArray<KlingMotionBrushRegion>;
  /** Elements — up to 4 frame-locked reference images by element id. */
  readonly elementIds?: ReadonlyArray<string>;
  /** Lip-sync — text or audio driven, with optional emotion picker. */
  readonly lipSync?: KlingLipSyncSpec;
  /** Omni multi-shot — up to 6 cuts with per-shot prompt + duration. */
  readonly omniMultiShot?: KlingOmniSpec;
  /** Watermark policy. Default false on paid keys (enforced by KlingProvider). */
  readonly watermarkEnabled?: boolean;
  /** Character orientation for motion control: follow image or video reference. */
  readonly characterOrientation?: 'image' | 'video';
  /** Optional explicit callback URL — overrides webhook-router default. */
  readonly callbackUrl?: string;
  /** Optional external task id passed back in webhook payload — auto-set to internal jobId. */
  readonly externalTaskId?: string;
  /** Mode selection within Kling: 'std' (Standard) or 'pro'. Defaults align with model id. */
  readonly klingMode?: 'std' | 'pro';
  /** Video reference URL for motion control mode (3-30s reference video). */
  readonly motionReferenceVideoUrl?: string;
}

// Expand the union — post-P15 has three arms.
export type ProviderExtras = GoogleVeoExtras | HiggsfieldExtras | KlingExtras;

export interface VideoGenerationRequest {
  readonly modelId: string;
  readonly mode: VideoMode;
  readonly prompt: string;
  readonly durationSec: number;
  readonly resolution: '720p' | '1080p' | '2k' | '4k';
  readonly aspectRatio?: '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4';
  readonly fps?: number;
  readonly referenceImagePaths?: ReadonlyArray<string>;
  readonly firstFrameImagePath?: string;
  readonly lastFrameImagePath?: string;
  readonly personGeneration?: 'allow_all' | 'allow_adult';
  readonly extras?: ProviderExtras;
}

export type JobState = 'pending' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';

export interface JobHandle {
  readonly jobId: string;
  readonly provider: Provider;
  readonly model: string;
  readonly mode: VideoMode;
  readonly createdAt: string;
  readonly providerNativeId?: string;
}

export interface JobStatus {
  readonly jobId: string;
  readonly state: JobState;
  readonly progress?: number;
  readonly assetUrls?: ReadonlyArray<string>;
  readonly errorMessage?: string;
}

export interface AssetMetadata {
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly expiresAt?: string;
  readonly cdnUrl?: string;
}

export interface DownloadedAsset {
  readonly buffer: Buffer;
  readonly metadata: AssetMetadata;
}

export interface VideoProvider {
  readonly name: Provider;
  readonly models: VideoModelSpec[];
  generate(req: VideoGenerationRequest): Promise<JobHandle>;
  pollStatus(jobId: string): Promise<JobStatus>;
  /**
   * Fetches an asset by job id (P14+ providers resolve job → signed CDN url internally)
   * OR by local path (P13 Veo passthrough). Returns buffer + metadata so callers can
   * persist content-type, detect TTL expiry, and surface CDN URLs for upstream reuse.
   */
  download(jobIdOrPath: string): Promise<DownloadedAsset>;
  estimateCostUSD(req: VideoGenerationRequest): number;
  recordActualCostUSD(jobId: string, usd: number): Promise<void>;
}
