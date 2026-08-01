// LOCKED — top-tier only. No mid/low tier exposed.
export const IMAGE_MODEL_NANO_BANANA_PRO = 'gemini-3-pro-image-preview' as const;
export const IMAGE_MODEL_IMAGEN_4_ULTRA = 'imagen-4.0-ultra-generate-001' as const;
export const VIDEO_MODEL_VEO_3_1_PRO = 'veo-3.1-generate-preview' as const;

export const ALL_IMAGE_MODELS = [IMAGE_MODEL_NANO_BANANA_PRO, IMAGE_MODEL_IMAGEN_4_ULTRA] as const;
export const ALL_VIDEO_MODELS = [VIDEO_MODEL_VEO_3_1_PRO] as const;

export type ImageModel = (typeof ALL_IMAGE_MODELS)[number];
export type VideoModel = (typeof ALL_VIDEO_MODELS)[number];
export type AnyModel = ImageModel | VideoModel;

export const THINKING_LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'] as const; // UPPERCASE
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const PERSON_GENERATION_IMAGE = ['ALLOW_ALL', 'ALLOW_ADULT', 'ALLOW_NONE'] as const; // UPPERCASE
export type PersonGenerationImage = (typeof PERSON_GENERATION_IMAGE)[number];

export const PERSON_GENERATION_VIDEO = ['allow_all', 'allow_adult'] as const; // lowercase
export type PersonGenerationVideo = (typeof PERSON_GENERATION_VIDEO)[number];

export const REFERENCE_TYPE_VIDEO = ['ASSET'] as const;
export type ReferenceTypeVideo = (typeof REFERENCE_TYPE_VIDEO)[number];

export const VIDEO_RESOLUTION = ['720p', '1080p', '4k'] as const; // '4k' lowercase
export type VideoResolution = (typeof VIDEO_RESOLUTION)[number];

export const IMAGE_SIZE = ['1K', '2K', '4K'] as const; // 'K' UPPERCASE
export type ImageSize = (typeof IMAGE_SIZE)[number];

export const ASPECT_RATIO_NANO_BANANA = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;
export type AspectRatioNanoBanana = (typeof ASPECT_RATIO_NANO_BANANA)[number];

export const ASPECT_RATIO_IMAGEN = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
export type AspectRatioImagen = (typeof ASPECT_RATIO_IMAGEN)[number];

export const ASPECT_RATIO_VIDEO = ['16:9', '9:16'] as const;
export type AspectRatioVideo = (typeof ASPECT_RATIO_VIDEO)[number];

export const VIDEO_DURATION_SECONDS = [4, 6, 8] as const;
export type VideoDurationSeconds = (typeof VIDEO_DURATION_SECONDS)[number];

// ---------------------------------------------------------------------------
// Multi-provider registry (P13 — Provider Abstraction Foundation)
// ---------------------------------------------------------------------------

// PROVIDERS grows incrementally as adapters land. P13 ships with `google` only.
// P14 appends `higgsfield`, P15 appends `kling`, P16 appends `bytedance`. The type
// must NEVER promise providers without backing adapters — otherwise downstream code
// type-checks against names that throw at runtime.
export const PROVIDERS = [
  'google',
  'higgsfield',
  'kling',
  'bytedance',
  'higgsfield-cli',
  'muapi',
  'wan2gp',
] as const;
export type Provider = (typeof PROVIDERS)[number];
// ^ Provider type derives from the runtime array. bytedance is now a shipped adapter (P16).
//
// T5: 'higgsfield-cli' is a SEPARATE provider from 'higgsfield', not a transport
// flag on it. They authenticate differently and therefore bill differently — the
// API adapter draws on API credits, the CLI on the logged-in user's workspace.
// PROVIDERS is what the router and the cost report key on, so collapsing two
// billing surfaces into one entry would make spend unattributable between them.
// Registration is gated by MEDIA_FORGE_HF_CLI_ENABLED (default false); the CLI
// holds one OAuth session per machine and so cannot serve multi-tenant hosting.
//
// PR7: 'muapi' is an AGGREGATOR — it resells Kling, Veo and others under its own
// endpoints with its own markup. It therefore has NO entry in VIDEO_MODELS and no
// rate in this file, deliberately: its catalogue and prices come from its own
// /api/v1/models endpoint at runtime. Pricing a MuAPI job from the direct-vendor
// rates below would under-report spend by the margin, which is the same
// "aggregator blindness" already filed as P1 for Higgsfield.
//
// NOT gated by an enable flag, unlike higgsfield-cli and wan2gp. This comment
// used to claim `MEDIA_FORGE_MUAPI_ENABLED (default false)`; that string was read
// nowhere in src/ and the tools always registered, so the comment described a
// gate that did not exist. The flag is not the right shape here either: the other
// two guard a MACHINE-level resource (one OAuth session, one local GPU server)
// that cannot be shared between tenants. MuAPI is an ordinary hosted API keyed by
// MUAPI_API_KEY — its tools register for everyone and refuse, by name, when the
// key is absent. An extra flag would only add a second way to be switched off.

export const VIDEO_MODES = [
  't2v',
  'i2v',
  'interpolate',
  'extend',
  'with-refs',
  'multi-shot',
  'lip-sync',
  'motion-brush',
  'elements',
  'targeted-edit',
] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const IP_RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type IpRiskLevel = (typeof IP_RISK_LEVELS)[number];

export const PRICING_UNITS = [
  'usd-per-second',
  'usd-per-video',
  'credits-per-video',
  'per-second',
  /**
   * Credits that scale with duration, unlike `credits-per-video` which is flat.
   *
   * Added for the Higgsfield CLI catalogue, where every model was measured and
   * came back exactly linear in duration (see aggregator-routes.ts). Pricing
   * those as `credits-per-video` would have ignored duration entirely and
   * reported a 10-second render at the 5-second price.
   */
  'credits-per-second',
] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const PRICING_SOURCES = ['fixed-public-rate', 'volatile-by-tier', 'user-override'] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

/**
 * What the endpoint actually returns.
 *
 * Not derivable from `modes`. Higgsfield's Soul family accepts a prompt and an
 * aspect ratio exactly like a t2v model does, and the registry duly described it
 * as `modes: ['t2v','i2v']` — but the platform serves it as `text2image` and
 * hands back an image. `GET /models` says so in its own words, and the live gate
 * prints it every run:
 *
 *   higgsfield-ai/soul/standard    text2image  image  1.0000
 *
 * `handleVideoRoute` filtered on mode, provider, duration and resolution and had
 * no way to see that, so a video request could be answered with an image
 * endpoint. Only the default cost sort hid it: at USD_PER_CREDIT=0.0625 the flat
 * 25-credit Soul price loses to kling-v3-standard at every duration Soul allows.
 * Name the provider and it wins; align its price with the 1.0 base_credits the
 * catalogue reports and it wins EVERYWHERE, by roughly 16x.
 *
 * REQUIRED, not defaulted. A spec that forgets to declare this would inherit
 * whichever default the field carried, and a wrong inherited value is exactly
 * the failure being fixed — silently in one direction, and silently dropping a
 * working model out of routing in the other.
 */
export type ModelOutputType = 'video' | 'image';

export interface VideoModelSpec {
  readonly id: string;
  readonly provider: Provider;
  readonly outputType: ModelOutputType;
  readonly modes: ReadonlyArray<VideoMode>;
  readonly maxDurationSec: number;
  readonly resolutions: ReadonlyArray<'480p' | '720p' | '1080p' | '2k' | '4k'>;
  readonly fps: ReadonlyArray<number>;
  readonly audioNative: boolean;
  readonly pricing: {
    readonly unit: PricingUnit;
    readonly rate: number;
    readonly source: PricingSource;
    readonly updatedAt: string; // ISO date — flag stale in cost report
    readonly notes?: string;    // e.g. "fal.ai tier; official Kuaishou differs"
    /**
     * FIX (Codex P2 round 15, PR#12): optional per-resolution multipliers applied
     * to `rate × durationSec` when the provider's pricing scales with frame area
     * (e.g. fal.ai Seedance token-formula billing). Missing key falls back to 1.0
     * (the rate's baseline resolution). Providers that bill at a flat rate
     * regardless of resolution omit this field entirely.
     */
    readonly resolutionMultipliers?: Partial<
      Record<'480p' | '720p' | '1080p' | '2k' | '4k', number>
    >;
  };
  readonly ipRiskLevel: IpRiskLevel;
  /**
   * Present when the provider does not actually serve this model.
   *
   * The truth used to live in a KNOWN_ABSENT table inside
   * tests/video/providers/higgsfield-endpoints-live.test.ts. That made the live
   * gate correct and the ROUTER blind: six of the ten mapped Higgsfield
   * endpoints answer `404 model_not_found`, yet handleVideoRoute happily ranked
   * them and could return one as the cheapest route. A test file is the wrong
   * home for a fact the runtime has to act on, and two copies of it drift.
   *
   * Concrete case this closes: higgsfield-marketing-studio is a live t2v
   * candidate at $3.125. Once the Soul specs left the pool via outputType, it
   * became the cheapest Higgsfield t2v — so `preferProvider: 'higgsfield'` would
   * have started routing to a 404.
   *
   * `verifiedAt` is the date the probe ran, not the date someone believed it.
   * The live gate re-asks the platform every run and fails if any entry here is
   * now served (remove it and wire the tool) or if anything NOT listed here has
   * stopped being served.
   */
  readonly unavailable?: {
    readonly reason: string;
    readonly verifiedAt: string;
  };
  /**
   * Optional per-model capability caps. When present, downstream schemas + handlers MUST
   * read from here rather than hardcoding constants. Currently used by:
   *   - kling-v3-omni: maxShots / maxDurationSec / per-shot bounds (Task 9 Zod schema)
   * Add new sub-fields as new providers / modes need explicit caps.
   */
  readonly limits?: {
    readonly maxShots?: number;
    readonly maxDurationSec?: number;
    readonly minDurationPerShotSec?: number;
    readonly maxDurationPerShotSec?: number;
    readonly maxImageRefs?: number;
    readonly maxVideoRefs?: number;
    readonly maxAudioRefs?: number;
  };
  /**
   * How the `higgsfield-cli` transport expresses resolution for this job type.
   *
   * `buildCliArgs` emits `--resolution <value>` by default, which is right for
   * every job type that declares a `resolution` param. `kling3_0` does not: it
   * declares `mode` with `std | pro | 4k` and rejects the other flag outright —
   *
   *     $ higgsfield generate cost kling3_0 --prompt p --resolution 1080p
   *     Error: Unknown params: resolution
   *
   * so every non-default-resolution request through that job type failed, at
   * cost estimation and at generation. Found by running `higgsfield generate
   * cost` (a read, 0 credits) against all four CLI specs on 2026-08-01.
   *
   * The prices reached through `--mode` match this spec's multipliers exactly
   * (std 10, pro 12.5, 4k 30 credits for 5s), so only the flag was wrong.
   */
  readonly cliResolutionParam?: {
    readonly flag: string;
    readonly values: Partial<Record<'480p' | '720p' | '1080p' | '2k' | '4k', string>>;
  };
}

export const VIDEO_MODELS: Readonly<Record<string, VideoModelSpec>> = {
  [VIDEO_MODEL_VEO_3_1_PRO]: {
    id: VIDEO_MODEL_VEO_3_1_PRO,
    provider: 'google',
    outputType: 'video',
    modes: ['t2v', 'i2v', 'interpolate', 'extend', 'with-refs'],
    maxDurationSec: 148,
    resolutions: ['720p', '1080p', '4k'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.5,
      source: 'fixed-public-rate',
      updatedAt: '2026-05-26',
      notes: 'Veo 3.1 preview pricing per GCP Vertex AI docs',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-soul-standard': {
    id: 'higgsfield-soul-standard',
    provider: 'higgsfield',
    outputType: 'image',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 8,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 25,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Higgsfield Soul standard — 50+ aesthetic presets. Plus plan: ~$0.039/credit.',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-soul-pro': {
    id: 'higgsfield-soul-pro',
    provider: 'higgsfield',
    outputType: 'image',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 8,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 60,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Higgsfield Soul pro tier — higher quality, slower.',
    },
    unavailable: {
      reason:
        'not a tier — /higgsfield-ai/soul/{mode} takes reference|character|standard, so "pro" is an invalid path segment (422 loc:["path","mode"])',
      verifiedAt: '2026-08-01',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-soul2': {
    id: 'higgsfield-soul2',
    provider: 'higgsfield',
    outputType: 'image',
    modes: ['t2v', 'i2v', 'with-refs'],
    maxDurationSec: 8,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 70,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Higgsfield Soul 2.0 — improved coherence, character consistency via multi-ref.',
    },
    unavailable: {
      reason:
        '404 model_not_found at /higgsfield-ai/soul2/standard; the real slug is /higgsfield-ai/soul/v2/standard, and it is text2image',
      verifiedAt: '2026-08-01',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-dop': {
    id: 'higgsfield-dop',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['i2v', 'with-refs'],
    maxDurationSec: 6,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 40,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Director of Photography — 20+ WAN Camera Control presets as verbs in prompt.',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-dop-turbo': {
    id: 'higgsfield-dop-turbo',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['i2v', 'with-refs'],
    maxDurationSec: 6,
    resolutions: ['720p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 18,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'DoP turbo — faster, cheaper, slightly lower fidelity.',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-speak': {
    id: 'higgsfield-speak',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['lip-sync'],
    // 15, not 30. `POST /higgsfield-ai/speak` with duration 99 answers
    // `Input should be 5, 10 or 15` — the platform's own enum, read 2026-08-01.
    maxDurationSec: 15,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'credits-per-video',
      rate: 35,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes:
        'Speak lip-sync — photo + audio → talking head. Body: image_url, audio_url, prompt ' +
        '(required); quality high|mid, duration 5|10|15, enhance_prompt, seed (optional). ' +
        'The 35-credit rate is NOT verified: `GET /models` does not list speak, so there is no ' +
        'base_credits to compare against, and the API account has 0 balance.',
    },
    ipRiskLevel: 'medium',
  },
  'higgsfield-speak2': {
    id: 'higgsfield-speak2',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['lip-sync'],
    maxDurationSec: 60,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'credits-per-video',
      rate: 55,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Speak 2.0 — longer clips, better emotion mapping.',
    },
    unavailable: {
      reason:
        '404 model_not_found with and without the tier segment; no speak2 exists on any Higgsfield surface',
      verifiedAt: '2026-08-01',
    },
    ipRiskLevel: 'medium',
  },
  'higgsfield-cinema-studio-3.5': {
    id: 'higgsfield-cinema-studio-3.5',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['i2v', 't2v', 'with-refs'],
    maxDurationSec: 8,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 90,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Cinema Studio 3.5 — 1,296 virtual lenses, focal length / aperture / sensor / grading.',
    },
    unavailable: {
      reason:
        '404 model_not_found on the Cloud API; the product lives on the CLI surface as job type cinematic_studio_video_3_5',
      verifiedAt: '2026-08-01',
    },
    ipRiskLevel: 'low',
  },
  'higgsfield-marketing-studio': {
    id: 'higgsfield-marketing-studio',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['t2v'],
    maxDurationSec: 15,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'credits-per-video',
      rate: 50,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: '9 UGC templates (unboxing, TV spot, hyper-motion, product review, ...) from product URL.',
    },
    unavailable: {
      reason:
        '404 model_not_found on the Cloud API; the product lives on the CLI surface as job type marketing_studio_video',
      verifiedAt: '2026-08-01',
    },
    ipRiskLevel: 'medium',
  },
  'higgsfield-recast': {
    id: 'higgsfield-recast',
    provider: 'higgsfield',
    outputType: 'video',
    modes: ['targeted-edit'],
    maxDurationSec: 30,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-video',
      rate: 80,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Recast Studio — swap character in existing video (Instadump / Character Swap).',
    },
    unavailable: {
      reason:
        '404 model_not_found with and without the tier segment; absent from the CLI too (dubbing/voice_change are a different product)',
      verifiedAt: '2026-08-01',
    },
    ipRiskLevel: 'high',
  },

  // -------------------------------------------------------------------------
  // higgsfield-cli catalogue.
  //
  // The `higgsfield-cli` provider existed with ZERO models, so naming it always
  // failed — the CLI's `job_type` values and the `higgsfield` registry ids are
  // DISJOINT sets, not two names for the same thing. `higgsfield-soul2` is a
  // video spec; `text2image_soul_v2` is an image job type. Live proof of the
  // failure: `exit 4: No model with job_type "higgsfield-soul2"`.
  //
  // A mapping table would have been an invention. These entries are the other
  // answer: register what the transport ACTUALLY serves, under its own provider.
  // The CLI resells other vendors' models, so the ids below are the CLI's own
  // job_type strings verbatim — `buildCliArgs` passes `req.modelId` straight
  // through as the job type, so id === job_type is what makes the path work.
  //
  // ## Priced in credits, never converted
  //
  // Higgsfield credits are a prepaid monthly bucket that expires. Converting
  // them to dollars to sort against a metered provider is a modelling error, not
  // a missing feature — see the header of aggregator-routes.ts. So these use
  // `credits-per-second`, which THROWS without MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT,
  // and `normalizeCostUSDSafe` turns that into POSITIVE_INFINITY. Net effect:
  // reachable by name, never auto-selected on an exchange rate nobody declared.
  //
  // Rates are measured, not published: `higgsfield generate cost <job_type>` is
  // a read that spends nothing, and every model came back exactly linear in
  // duration, which is why credits-per-SECOND is the honest unit.
  //
  // Deliberately absent: `veo3_1` and `wan2_7` (listed by the CLI but never
  // measured — a rate here would be a guess), and `kling2_6` / `seedance1_5`
  // (measured, but with no direct registry entry there is nothing to compare
  // against). Named here rather than dropped silently.
  // -------------------------------------------------------------------------
  kling3_0_turbo: {
    id: 'kling3_0_turbo',
    provider: 'higgsfield-cli',
    outputType: 'video',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 10,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-second',
      rate: 1.5,
      source: 'volatile-by-tier',
      updatedAt: '2026-07-30',
      notes:
        'Measured via `higgsfield generate cost kling3_0_turbo` (a read, 0 credits spent): ' +
        '7.5 credits/5s and 15/10s at 720p; 10/5s and 20/10s at 1080p. Baseline is 720p.',
      resolutionMultipliers: { '1080p': 1.3333333333333333 },
    },
    ipRiskLevel: 'low',
  },
  kling3_0: {
    id: 'kling3_0',
    provider: 'higgsfield-cli',
    outputType: 'video',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 10,
    resolutions: ['720p', '1080p', '4k'],
    fps: [24],
    audioNative: false,
    pricing: {
      unit: 'credits-per-second',
      rate: 2.0,
      source: 'volatile-by-tier',
      updatedAt: '2026-07-30',
      notes:
        'Measured: standard 10 credits/5s (2.0 c/s), pro 12.5/5s (2.5 c/s), 4K 30/5s (6.0 c/s). ' +
        'The CLI exposes one job_type whose price moves with the tier it renders at, so the ' +
        'tiers are expressed as resolution multipliers off the 720p standard baseline.',
      resolutionMultipliers: { '1080p': 1.25, '4k': 3.0 },
    },
    ipRiskLevel: 'low',
    // This job type has no `resolution` param — see cliResolutionParam on the
    // VideoModelSpec interface. Values measured 2026-08-01.
    cliResolutionParam: {
      flag: '--mode',
      values: { '720p': 'std', '1080p': 'pro', '4k': '4k' },
    },
  },
  seedance_2_0: {
    id: 'seedance_2_0',
    provider: 'higgsfield-cli',
    outputType: 'video',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 10,
    resolutions: ['480p', '720p', '1080p', '4k'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'credits-per-second',
      rate: 4.5,
      source: 'volatile-by-tier',
      updatedAt: '2026-08-01',
      notes:
        'Measured: 15 credits/5s at 480p (3.0 c/s), 22.5/5s at 720p (4.5 c/s), 45/5s at 1080p ' +
        '(9.0 c/s), 110/5s at 4k (22.0 c/s). Baseline is 720p, matching the other entries here. ' +
        '4k was absent until 2026-08-01: `higgsfield model get seedance_2_0` declares ' +
        'resolution [480p,720p,1080p,4k], so the tier existed and this registry did not offer it.',
      resolutionMultipliers: {
        '480p': 0.6666666666666666,
        '1080p': 2.0,
        '4k': 4.888888888888889,
      },
    },
    // Same underlying model as the direct bytedance route, so it carries the
    // same IP risk — the transport does not change what was trained on.
    ipRiskLevel: 'high',
  },
  seedance_2_0_mini: {
    id: 'seedance_2_0_mini',
    provider: 'higgsfield-cli',
    outputType: 'video',
    modes: ['t2v', 'i2v'],
    // No 1080p: the CLI rejects it for this model ("allowed: 480p, 720p"),
    // which matches the registry's own resolutions for seedance-2.0-fast.
    maxDurationSec: 10,
    resolutions: ['480p', '720p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'credits-per-second',
      rate: 2.5,
      source: 'volatile-by-tier',
      updatedAt: '2026-07-30',
      notes:
        'Measured: 5 credits/5s at 480p (1.0 c/s), 12.5/5s at 720p (2.5 c/s). Baseline 720p.',
      resolutionMultipliers: { '480p': 0.4 },
    },
    ipRiskLevel: 'high',
  },

  'kling-v3-standard': {
    id: 'kling-v3-standard',
    provider: 'kling',
    outputType: 'video',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 10,
    resolutions: ['720p', '1080p'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.126,
      source: 'fixed-public-rate',
      updatedAt: '2026-07-30',
      notes:
        'Confirmed via kling.ai/dev/pricing (read live 2026-07-30): "Kling 3.0 / With Native Audio" row — ' +
        '720P $0.126/s (this rate), 1080P $0.168/s (see resolutionMultipliers below).',
      // Official 1080P rate ($0.168) ÷ official 720P rate ($0.126) for the same
      // "Kling 3.0 / With Native Audio" row = 4/3 exactly. Written as a quotient of
      // the two published cells rather than a rounded decimal so the derivation is
      // auditable: 0.126 * (0.168/0.126) = 0.168.
      resolutionMultipliers: {
        '720p': 1.0,
        '1080p': 0.168 / 0.126,
      },
    },
    ipRiskLevel: 'medium',
  },
  // Reachable only through the API 2.0 protocol (MEDIA_FORGE_KLING_API_V2=true).
  // It has no legacy `/v1/videos/{type}` equivalent — that is exactly why the
  // migration matters, and why this entry is the first proof the flag does
  // something rather than being inert.
  'kling-3.0-turbo': {
    id: 'kling-3.0-turbo',
    provider: 'kling',
    outputType: 'video',
    modes: ['t2v', 'i2v'],
    // "durations (3-15 seconds)" per the model page's capability map.
    maxDurationSec: 15,
    resolutions: ['720p', '1080p'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      // Kling bills this model in UNITS, not dollars: the 2026-06-17 API update
      // states "0.8 units/second for 720P and 1.0 unit/second for 1080P". One
      // unit is $0.14, read off kling.ai/dev/pricing in an authenticated session
      // on 2026-07-30 (the same figure the other Kling rates here derive from).
      //
      // Written as the multiplication rather than the product so the derivation
      // stays auditable if either number moves: 0.8 * 0.14 = 0.112.
      rate: 0.8 * 0.14,
      source: 'fixed-public-rate',
      updatedAt: '2026-07-30',
      notes:
        'kling.ai/document-api/updates/api, 06/17/2026 entry: "Billing is based on video ' +
        'duration: 0.8 units/second for 720P and 1.0 unit/second for 1080P." Unit = $0.14 ' +
        'from kling.ai/dev/pricing. Requires MEDIA_FORGE_KLING_API_V2=true — this model has ' +
        'no legacy endpoint. The 2.0 API also accepts ONLY API-key auth, so KLING_API_KEY ' +
        'must be set; the legacy JWT is rejected.',
      // 1.0 unit/s at 1080P over 0.8 unit/s at 720P. Kept as the quotient of the
      // two published figures for the same reason as kling-v3-standard.
      resolutionMultipliers: {
        '720p': 1.0,
        '1080p': 1.0 / 0.8,
      },
    },
    ipRiskLevel: 'medium',
  },
  'kling-v3-pro': {
    id: 'kling-v3-pro',
    provider: 'kling',
    outputType: 'video',
    modes: ['t2v', 'i2v', 'motion-brush', 'elements', 'lip-sync', 'extend'],
    maxDurationSec: 10,
    // '2k' unverified: Kling's `mode` enum (std/pro/4k) maps 'pro' to 1080P output only —
    // no dedicated 2K mode exists per docs. Left in place: tests/core/models-registry.test.ts:124
    // asserts on it and it's part of the shared cross-provider resolution union (base.ts/schemas.ts).
    resolutions: ['1080p', '2k'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.168,
      source: 'fixed-public-rate',
      updatedAt: '2026-07-30',
      notes:
        'Verified via kling.ai/dev/pricing (read live 2026-07-30): "Kling 3.0 / With Native Audio" row, ' +
        '1080P $0.168/s. "2k" resolution entry remains unverified — Kling has no 2K tier per official ' +
        'pricing page, but is left in place per tests/core/models-registry.test.ts:124 and the shared ' +
        'cross-provider resolution union.',
    },
    ipRiskLevel: 'medium',
  },
  'kling-v3-master': {
    id: 'kling-v3-master',
    provider: 'kling',
    outputType: 'video',
    modes: ['t2v'],
    maxDurationSec: 10,
    resolutions: ['4k'],
    fps: [24, 30, 60],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.42,
      source: 'fixed-public-rate',
      updatedAt: '2026-07-30',
      notes:
        'Confirmed via kling.ai/dev/pricing (read live 2026-07-30): Kling 3.0 at 4K is $0.42/s regardless ' +
        'of the Native Audio / Voice Control axis — all three Kling 3.0 rows ("No Native Audio", ' +
        '"With Native Audio x No Voice Control", and both Omni "No Video Input" rows) list $0.42/s for 4K. ' +
        'Prior unverified 0.18 rate under-estimated by 133% (10s clip: $1.80 vs actual $4.20), which suppressed ' +
        'the $2.00 blockThresholdUsd hard block, under-counted the daily cap, and under-reserved credits.',
    },
    ipRiskLevel: 'medium',
  },
  'kling-v3-omni': {
    id: 'kling-v3-omni',
    provider: 'kling',
    outputType: 'video',
    modes: ['t2v', 'i2v', 'multi-shot'],
    maxDurationSec: 30, // 6 shots × 5s max each per Omni schema
    resolutions: ['1080p'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.14,
      source: 'fixed-public-rate',
      updatedAt: '2026-07-30',
      notes:
        'Resolved via kling.ai/dev/pricing (read live 2026-07-30). Omni has 3 official 1080P rows: ' +
        '"No Video Input x No Native Audio" $0.112, "No Video Input x With Native Audio" $0.14, ' +
        '"With Video Input x No Native Audio" $0.168 — there is no published "With Video Input x With ' +
        'Native Audio" row. This entry declares audioNative:true, and its modes (t2v, i2v, multi-shot) ' +
        'accept only text/image input — i2v is image-to-video, not a video reference — and it carries no ' +
        'maxVideoRefs limit (contrast Seedance, which does), so it has no video-input capability. That maps ' +
        'it to "No Video Input x With Native Audio" = $0.14/s, not the previous $0.168 (which is the ' +
        '"With Video Input x No Native Audio" row — wrong axis, since this entry has audio but no video ' +
        'input). If a video-reference mode is ever added to this entry, re-derive against the $0.168 row.',
    },
    // Single source of truth for Omni multi-shot caps. Task 9 schema + handler reference these
    // (do NOT hardcode MAX_OMNI_SHOTS / MAX_OMNI_DURATION_SEC elsewhere).
    limits: {
      maxShots: 6,
      maxDurationSec: 30,
      minDurationPerShotSec: 1,
      maxDurationPerShotSec: 10,
    },
    ipRiskLevel: 'medium',
  },
  'seedance-2.0-fast': {
    id: 'seedance-2.0-fast',
    provider: 'bytedance',
    outputType: 'video',
    modes: ['t2v', 'i2v', 'with-refs', 'multi-shot', 'targeted-edit'],
    maxDurationSec: 15,
    resolutions: ['480p', '720p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'per-second',
      rate: 0.2419,
      source: 'fixed-public-rate',
      updatedAt: '2026-05-28',
      notes: 'fal.ai Seedance 2.0 Fast tier ($0.2419/sec at 720p baseline; native audio included). Token formula tokens=h*w*dur*24/1024 @ $0.014/1k → resolution-aware multipliers below.',
      // Token-formula derivation: tokens scale with pixel area; relative to 720p
      // (1280×720) baseline: 480p (854×480) = 0.4448x.
      resolutionMultipliers: {
        '480p': 0.4448,
        '720p': 1.0,
      },
    },
    limits: { maxImageRefs: 9, maxVideoRefs: 3, maxAudioRefs: 3 },
    ipRiskLevel: 'high',
  },
  'seedance-2.0-standard': {
    id: 'seedance-2.0-standard',
    provider: 'bytedance',
    outputType: 'video',
    modes: ['t2v', 'i2v', 'with-refs', 'multi-shot', 'targeted-edit'],
    maxDurationSec: 15,
    resolutions: ['480p', '720p', '1080p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'per-second',
      rate: 0.3024,
      source: 'fixed-public-rate',
      updatedAt: '2026-05-28',
      notes: 'fal.ai Seedance 2.0 Standard tier ($0.3024/sec at 720p baseline; native audio included). Token formula tokens=h*w*dur*24/1024 @ $0.014/1k → 1080p ≈ $0.6804/sec, 480p ≈ $0.1345/sec. BytePlus ARK direct may differ — fallback normalizes at recordActualCostUSD.',
      // Token-formula derivation: tokens scale with pixel area; relative to 720p
      // (1280×720) baseline: 480p (854×480) = 0.4448x, 1080p (1920×1080) = 2.25x.
      resolutionMultipliers: {
        '480p': 0.4448,
        '720p': 1.0,
        '1080p': 2.25,
      },
    },
    limits: { maxImageRefs: 9, maxVideoRefs: 3, maxAudioRefs: 3 },
    ipRiskLevel: 'high',
  },
};

/**
 * Runtime override hook: cost-tracker and pricing helpers consult this map
 * before falling back to VIDEO_MODELS pricing. Allows per-environment override
 * (e.g. enterprise contract pricing) without recompiling. Populated by
 * `loadPricingOverridesFromEnv()` in `src/core/pricing.ts`.
 */
export const PRICING_OVERRIDES = new Map<string, VideoModelSpec['pricing']>();
