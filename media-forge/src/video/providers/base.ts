import type { Provider, VideoMode, VideoModelSpec } from '../../core/models.js';

/**
 * Provider-specific extras union — each provider extends with its own typed extras
 * object. P13 shipped `GoogleVeoExtras`. `HiggsfieldExtras` covers Soul ID, DoP
 * camera verbs, Speak audio, the CLI job-type parameter passthrough and the
 * aggregator proxy. P15 adds KlingExtras, P16 adds BytedanceSeedanceExtras.
 *
 * Discriminated by `providerKind`; never collapse to Record<string, unknown>.
 */
export interface GoogleVeoExtras {
  readonly providerKind: 'google';
  // Veo-specific extras are absent in P13/P14 — Veo controls live on base request fields.
}

export interface HiggsfieldExtras {
  readonly providerKind: 'higgsfield';

  /** Soul ID handle from createSoulId — reused across generations for character consistency. */
  readonly soulId?: string;

  /** DoP / WAN Camera Control verbs prepended to the prompt (dolly_in, crash_zoom, ...). */
  readonly dopCameraVerbs?: ReadonlyArray<string>;

  /** Speak lip-sync source audio (local path resolved to data URL or Higgsfield upload). */
  readonly speakAudioPath?: string;

  /**
   * Job-type-specific parameters passed straight through to the CLI as
   * `--name value`, repeating the flag for each element of an array.
   *
   * Replaces `cinemaStudioParams`, `marketingStudioTemplate`,
   * `marketingStudioProductUrl`, `multiReferenceImages` and
   * `recastTargetCharacterPath`. Those five modelled a Cloud API that answers 404
   * for the products they belonged to, and every field they carried
   * (focal_length_mm, aperture_fstop, sensor_size, lens_id, template,
   * product_url, multi_reference_urls, target_character_url) was probed against
   * every endpoint that DOES answer and named by none of them — they were being
   * serialised into request bodies and silently discarded.
   *
   * The real products live on the CLI transport, where each job type publishes
   * its own parameter list (`higgsfield model get <job_type>`). Rather than grow
   * a typed field per job type — which is how the last set drifted out of
   * existence unnoticed — the caller passes the platform's own parameter names
   * and the schema layer validates them against the enums the platform reports.
   */
  readonly cliParams?: Readonly<Record<string, string | number | boolean | ReadonlyArray<string>>>;

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
  /**
   * Mode selection within Kling. Per Kling API docs (`api/video/2-6`), a
   * three-value enum that also determines output resolution:
   *   'std' — Standard Mode, output resolution 720P.
   *   'pro' — Professional Mode, output resolution 1080P.
   *   '4k'  — 4K Mode, output resolution 4K.
   * Defaults align with model id (see KlingProvider's buildRequestBody).
   */
  readonly klingMode?: 'std' | 'pro' | '4k';
  /** Video reference URL for motion control mode (3-30s reference video). */
  readonly motionReferenceVideoUrl?: string;
}

/**
 * Seedance 2.0 (ByteDance) extras. Covers the full provider surface:
 *   - functionMode: 'omni_reference' enables up to 12-reference fusion via @-mention
 *     syntax in prompt (`@image_file_1`, `@video_file_1`, `@audio_file_1`).
 *   - referenceImageUrls / referenceVideoUrls / referenceAudioUrls: signed URLs the
 *     adapter uploads BEFORE submit; max 9 images + 3 videos + 3 audios per spec.
 *   - multiShotTimestamps: hard-cut timestamps for multi-shot mode; serialized into
 *     prompt as `[00:00-00:05] Shot 1: ... [00:05-00:10] Shot 2: ...`.
 *   - targetedEditShotIndex: 1-based shot ordinal to regenerate inside a prior
 *     multi-shot output (cost-saver vs full regen). Implemented as i2v with
 *     end_image_url frame-anchor transition (no native targeted-edit endpoint on fal.ai).
 *   - lipSyncEnabled: when true + referenceAudioUrls present, the model auto-locks
 *     phoneme-level lip-sync against the audio track.
 *   - cameraFixed: pass-through to fal.ai `camera_fixed` input — disables camera
 *     motion when scene must hold static.
 *   - seed: optional deterministic seed for reproducibility.
 *
 * Tiers (Fast / Standard) are encoded in modelId ('seedance-2.0-fast' | 'seedance-2.0-standard')
 * per A0.1 — NOT a field on extras. No Pro tier exists in Seedance 2.0.
 *
 * Endpoint selection (t2v / i2v / r2v) is derived at dispatch time from VideoGenerationRequest.mode
 * per A0.4 — NOT a field on extras.
 *
 * P16 ships ONLY this extras shape. No other provider may add fields to it; this is
 * the discriminated arm for `providerKind === 'bytedance'`. Per P13 type contract.
 */
export interface BytedanceSeedanceExtras {
  readonly providerKind: 'bytedance';
  /** Enables omni-reference fusion with @-mention syntax in prompt (up to 12 references). */
  readonly functionMode?: 'omni_reference';
  /** Reference image URLs — @Image1, @Image2, … in prompt; max 9 per fal.ai r2v spec. */
  readonly referenceImageUrls?: ReadonlyArray<string>;
  /** Reference video URLs — @Video1, … in prompt; max 3 per fal.ai r2v spec. */
  readonly referenceVideoUrls?: ReadonlyArray<string>;
  /** Reference audio URLs — @Audio1, … in prompt; max 3 per fal.ai r2v spec. */
  readonly referenceAudioUrls?: ReadonlyArray<string>;
  /**
   * Hard-cut timestamps for multi-shot mode. Serialized into prompt by the provider as
   * `[00:00-00:05] Shot 1: <prompt> [00:05-00:10] Shot 2: <prompt>`.
   * Validation: shot.end > shot.start; sum(durations) <= 15s. Dispatched via t2v endpoint.
   */
  readonly multiShotTimestamps?: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly prompt: string;
  }>;
  /**
   * 1-based shot ordinal to regenerate inside a prior multi-shot output. Implemented
   * as i2v with end_image_url frame-anchor transition (no native targeted-edit endpoint).
   */
  readonly targetedEditShotIndex?: number;
  /** When true + referenceAudioUrls present, locks phoneme-level lip-sync to audio track. */
  readonly lipSyncEnabled?: boolean;
  /** Disables camera motion — pass-through to fal.ai `camera_fixed` input. */
  readonly cameraFixed?: boolean;
  /** Optional deterministic seed for reproducible generation. */
  readonly seed?: number;
  /** Honor explicit caller choice for native audio. Default true (fal.ai default). */
  readonly generateAudio?: boolean;
  /** Optional end-user id passed to fal.ai (compliance/billing attribution). */
  readonly endUserId?: string;
  /**
   * FIX (Codex P2 round 13, PR#12): when the caller omits `durationSec` on a
   * Seedance MCP tool, the schema's optional-no-default contract is supposed
   * to fall through to fal.ai's `duration: "auto"` default. Setting this flag
   * tells `buildFalInput` to omit `duration` from the fal payload so the
   * upstream contract is honored (fal picks the duration, typically 4-6s).
   * The cost preview (`estimateCostUSD`) still uses the handler-supplied
   * fallback (5s) because we cannot predict what fal will choose;
   * `recordActualCost` on poll completion uses the same fallback for now
   * (follow-up: probe actual duration from completed asset metadata).
   */
  readonly durationAutoMode?: boolean;
}

// Expand the union — post-P16 has four arms.
export type ProviderExtras = GoogleVeoExtras | HiggsfieldExtras | KlingExtras | BytedanceSeedanceExtras;

export interface VideoGenerationRequest {
  readonly modelId: string;
  readonly mode: VideoMode;
  readonly prompt: string;
  readonly durationSec: number;
  /**
   * '480p' added 2026-08-01. It was already in the registry — seedance_2_0,
   * seedance_2_0_mini and both Higgsfield Studio job types list it, and
   * seedance_2_0_mini serves ONLY 480p/720p — but the request type stopped at
   * 720p, so the cheapest tier of those models was unreachable through this
   * interface while the router happily offered it.
   */
  readonly resolution: '480p' | '720p' | '1080p' | '2k' | '4k';
  readonly aspectRatio?: '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' | 'auto';
  readonly fps?: number;
  readonly referenceImagePaths?: ReadonlyArray<string>;
  readonly firstFrameImagePath?: string;
  readonly lastFrameImagePath?: string;
  readonly personGeneration?: 'allow_all' | 'allow_adult';
  readonly extras?: ProviderExtras;
}

/**
 * A5 (2026-07-30) — reserve-BEFORE-submit ledger hooks for Kling, Higgsfield,
 * and Seedance, closing C8 for the three providers where it was still open
 * (Veo already reserves before submit — see submitVeoWithLedger in
 * register.ts). Passed as an explicit, per-call parameter to
 * `VideoProvider.generate()` rather than stored on the provider instance:
 * HiggsfieldProvider and BytedanceSeedanceProvider are per-PROCESS
 * singletons (see higgsfieldProvider() / getBytedanceSeedanceProvider()),
 * while `src/http/app-internal.ts`'s `handleMcpRequest` builds a fresh
 * `HandlersDeps` (distinct tenantId + creditClient) on EVERY HTTP request in
 * hosted multi-tenant mode. Storing hooks as mutable instance/constructor
 * state on those singletons would let one tenant's request overwrite the
 * hooks a concurrent request from a DIFFERENT tenant is about to reserve
 * against — a cross-tenant billing leak, not just a race. Threading hooks
 * as a plain function argument, captured in the callee's local scope, makes
 * that structurally impossible: each call gets exactly the hooks its own
 * caller passed, regardless of what else runs concurrently on the same
 * singleton. KlingProvider is constructed fresh per call and would be safe
 * either way; the parameter is used there too for one consistent shape
 * across all three providers.
 *
 * Asymmetric error contract — implementations MUST honor this:
 *   - `beforeSubmit` is allowed to throw (e.g. InsufficientCreditError from
 *     credit-core) — that is how insufficient credit blocks the network
 *     call before it ever reaches the provider.
 *   - `onSubmitFailed` and `onPostSubmitError` must NEVER throw. They run
 *     during cleanup after a failure the caller already needs to see; if a
 *     cleanup call itself fails (credit-core down), the implementation must
 *     swallow that secondary error internally (log it, do not propagate) so
 *     the ORIGINAL error — the one the caller can actually act on — is what
 *     comes out of `generate()`. See register.ts's `videoLedgerHooks` for
 *     the implementation and `veo-cleanup-failure-surfaces-original-error.test.ts`
 *     for the precedent this mirrors on the Veo path.
 */
export interface VideoLedgerHooks {
  /** Called with the provider's own minted jobId + pure cost estimate,
   *  immediately BEFORE the network submit. May throw to block the call. */
  beforeSubmit(jobId: string, estimateUsd: number): Promise<void>;
  /** The provider's submit never succeeded (network error, non-2xx, or a
   *  malformed success envelope) — release the reservation `beforeSubmit`
   *  opened. Must not throw (see the asymmetric contract above). */
  onSubmitFailed(jobId: string, estimateUsd: number): Promise<void>;
  /**
   * The submit SUCCEEDED (the provider accepted the job) but bookkeeping
   * AFTER that point threw (e.g. `recordJob` hitting a locked SQLite file).
   * The reservation must NOT be released here — the generation is actually
   * running on the provider's side, and releasing would let it complete for
   * free. Log at warn with the jobId (and the provider's native task id
   * when the call site has it) so an operator can reconcile by hand; the
   * reservation still expires by its TTL and credit-core's sweep releases
   * it, so the bounded outcome is an unbilled generation, not a stuck lock.
   * The real fix — Kling's deduction/usage API (TODOS.md P1, "APIs de
   * dedução e uso do Kling não são usadas") — would let the reservation be
   * settled from the provider's own record of the charge instead of relying
   * on `recordJob` succeeding locally; until that lands this is a known,
   * bounded loss requiring manual reconciliation. Synchronous — must not
   * throw (see the asymmetric contract above).
   */
  onPostSubmitError(jobId: string, estimateUsd: number, err: unknown): void;
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
  /**
   * `ledgerHooks` is optional and, when passed, MUST be invoked by the
   * implementation per the `VideoLedgerHooks` contract above (A5). Omitting
   * it (existing callers, direct-provider tests) preserves byte-identical
   * behavior to before A5 — no reserve, no release, no post-submit warning.
   */
  generate(req: VideoGenerationRequest, ledgerHooks?: VideoLedgerHooks): Promise<JobHandle>;
  pollStatus(jobId: string): Promise<JobStatus>;
  /**
   * Fetches an asset by job id (P14+ providers resolve job → signed CDN url internally)
   * OR by local path (P13 Veo passthrough). Returns buffer + metadata so callers can
   * persist content-type, detect TTL expiry, and surface CDN URLs for upstream reuse.
   */
  download(jobIdOrPath: string): Promise<DownloadedAsset>;
  estimateCostUSD(req: VideoGenerationRequest): number;

  /**
   * Settles a job at the amount the PROVIDER reported, when the provider reports
   * one. Optional, and that is the honest shape.
   *
   * It was required, which advertised a settlement capability four of the five
   * providers never exercise. Their real settlement runs through
   * `recordActualCost` called directly from a webhook handler, a poll path or a
   * download handler — never through this method. Only MuAPI settles this way,
   * because MuAPI is the one provider that returns the charge it actually made
   * (`cost.amount_usd`); everywhere else the figure is derived from
   * `rate x duration` at whichever call site owns the completion.
   *
   * Optional means a provider that does not settle from a reported figure simply
   * does not declare it. That is a stronger signal than a method present and
   * doing nothing: `HiggsfieldCliProvider` used to carry an implementation whose
   * whole body was `logger.debug('… is a documented no-op')`, which reads as
   * "settled" to anything holding the interface.
   */
  recordActualCostUSD?(jobId: string, usd: number): Promise<void>;
}
