import type { Provider, VideoMode, VideoModelSpec } from '../../core/models.js';

/**
 * Provider-specific extras union — each provider extends with its own typed extras
 * object. P13 ships only `GoogleVeoExtras` (currently empty — Veo uses the base
 * request fields directly). P14 adds `HiggsfieldExtras` (Soul ID, DoP camera verbs,
 * Cinema Studio params). P15 adds `KlingExtras` (lip-sync emotion, motion brush
 * regions, elements references). P16 adds `BytedanceSeedanceExtras` (multi-shot
 * timestamps, @-mention references, targeted-edit shot index).
 *
 * Using a discriminated union by provider keeps each adapter type-safe and prevents
 * Kling-only fields from leaking into a Seedance request at compile time. The
 * `extras` field on VideoGenerationRequest is typed as a union, never as a generic
 * Record<string, unknown> — the latter was the pattern Codex flagged as guaranteed
 * to break P14-P16.
 */
export interface GoogleVeoExtras {
  readonly providerKind: 'google';
  // No Google-specific extras in P13 — Veo controls live on base request fields.
}

// P14-P16 will append HiggsfieldExtras | KlingExtras | BytedanceSeedanceExtras.
// Until then, the union has a single arm. The shape is intentionally locked so
// P14+ extensions land as type-additive PRs with full backwards compatibility.
export type ProviderExtras = GoogleVeoExtras;

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
