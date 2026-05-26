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
export const PROVIDERS = ['google'] as const;
export type Provider = (typeof PROVIDERS)[number] | 'higgsfield' | 'kling' | 'bytedance';
// ^ Future-provider names are kept in the type union for forward-compatible
// signatures (e.g. preferProvider in VideoRouteInput), but they are NOT in the
// runtime PROVIDERS array. Guards must check `PROVIDERS.includes(name)` before
// accepting an unknown provider value.

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

export const PRICING_UNITS = ['usd-per-second', 'usd-per-video', 'credits-per-video'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const PRICING_SOURCES = ['fixed-public-rate', 'volatile-by-tier', 'user-override'] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

export interface VideoModelSpec {
  readonly id: string;
  readonly provider: Provider;
  readonly modes: ReadonlyArray<VideoMode>;
  readonly maxDurationSec: number;
  readonly resolutions: ReadonlyArray<'720p' | '1080p' | '2k' | '4k'>;
  readonly fps: ReadonlyArray<number>;
  readonly audioNative: boolean;
  readonly pricing: {
    readonly unit: PricingUnit;
    readonly rate: number;
    readonly source: PricingSource;
    readonly updatedAt: string; // ISO date — flag stale in cost report
    readonly notes?: string;    // e.g. "fal.ai tier; official Kuaishou differs"
  };
  readonly ipRiskLevel: IpRiskLevel;
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
};

/**
 * Runtime override hook: cost-tracker and pricing helpers consult this map
 * before falling back to VIDEO_MODELS pricing. Allows per-environment override
 * (e.g. enterprise contract pricing) without recompiling. Populated by
 * `loadPricingOverridesFromEnv()` in `src/core/pricing.ts`.
 */
export const PRICING_OVERRIDES = new Map<string, VideoModelSpec['pricing']>();
