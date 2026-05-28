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
export const PROVIDERS = ['google', 'higgsfield', 'kling', 'bytedance'] as const;
export type Provider = (typeof PROVIDERS)[number];
// ^ Provider type derives from the runtime array. bytedance is now a shipped adapter (P16).

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

export const PRICING_UNITS = ['usd-per-second', 'usd-per-video', 'credits-per-video', 'per-second'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const PRICING_SOURCES = ['fixed-public-rate', 'volatile-by-tier', 'user-override'] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

export interface VideoModelSpec {
  readonly id: string;
  readonly provider: Provider;
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
}

export const VIDEO_MODELS: Readonly<Record<string, VideoModelSpec>> = {
  [VIDEO_MODEL_VEO_3_1_PRO]: {
    id: VIDEO_MODEL_VEO_3_1_PRO,
    provider: 'google',
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
    ipRiskLevel: 'low',
  },
  'higgsfield-soul2': {
    id: 'higgsfield-soul2',
    provider: 'higgsfield',
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
    ipRiskLevel: 'low',
  },
  'higgsfield-dop': {
    id: 'higgsfield-dop',
    provider: 'higgsfield',
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
    modes: ['lip-sync'],
    maxDurationSec: 30,
    resolutions: ['720p', '1080p'],
    fps: [24],
    audioNative: true,
    pricing: {
      unit: 'credits-per-video',
      rate: 35,
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes: 'Speak lip-sync — photo + audio → talking head.',
    },
    ipRiskLevel: 'medium',
  },
  'higgsfield-speak2': {
    id: 'higgsfield-speak2',
    provider: 'higgsfield',
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
    ipRiskLevel: 'medium',
  },
  'higgsfield-cinema-studio-3.5': {
    id: 'higgsfield-cinema-studio-3.5',
    provider: 'higgsfield',
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
    ipRiskLevel: 'low',
  },
  'higgsfield-marketing-studio': {
    id: 'higgsfield-marketing-studio',
    provider: 'higgsfield',
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
    ipRiskLevel: 'medium',
  },
  'higgsfield-recast': {
    id: 'higgsfield-recast',
    provider: 'higgsfield',
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
    ipRiskLevel: 'high',
  },
  'kling-v3-standard': {
    id: 'kling-v3-standard',
    provider: 'kling',
    modes: ['t2v', 'i2v'],
    maxDurationSec: 10,
    resolutions: ['720p', '1080p'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.126,
      source: 'fixed-public-rate',
      updatedAt: '2026-05-27',
      notes: 'Kling V3 Standard tier per kling.ai pricing docs (context7 verified 2026-05-27)',
    },
    ipRiskLevel: 'medium',
  },
  'kling-v3-pro': {
    id: 'kling-v3-pro',
    provider: 'kling',
    modes: ['t2v', 'i2v', 'motion-brush', 'elements', 'lip-sync', 'extend'],
    maxDurationSec: 10,
    resolutions: ['1080p', '2k'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.168,
      source: 'fixed-public-rate',
      updatedAt: '2026-05-27',
      notes: 'Kling V3 Pro tier per kling.ai pricing docs (context7 verified 2026-05-27)',
    },
    ipRiskLevel: 'medium',
  },
  'kling-v3-master': {
    id: 'kling-v3-master',
    provider: 'kling',
    modes: ['t2v'],
    maxDurationSec: 10,
    resolutions: ['4k'],
    fps: [24, 30, 60],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.18, // PLACEHOLDER — verify on first live invocation
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes:
        'Kling V3 Master (4K native, 60fps) pricing NOT confirmed by context7 fetch — verify on first live invocation and update rate via PRICING_OVERRIDES or commit a correction',
    },
    ipRiskLevel: 'medium',
  },
  'kling-v3-omni': {
    id: 'kling-v3-omni',
    provider: 'kling',
    modes: ['t2v', 'i2v', 'multi-shot'],
    maxDurationSec: 30, // 6 shots × 5s max each per Omni schema
    resolutions: ['1080p'],
    fps: [24, 30],
    audioNative: true,
    pricing: {
      unit: 'usd-per-second',
      rate: 0.168, // PLACEHOLDER — matches Pro tier; verify on first live invocation
      source: 'volatile-by-tier',
      updatedAt: '2026-05-27',
      notes:
        'Kling V3 Omni multi-shot pricing NOT confirmed by context7 fetch — assumed to match Pro tier per kling.ai pricing Q&A wording. Verify on first live invocation.',
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
