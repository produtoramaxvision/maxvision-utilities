import { z } from 'zod';
import {
  VIDEO_MODEL_VEO_3_1_PRO,
  PERSON_GENERATION_VIDEO,
  VIDEO_RESOLUTION,
  ASPECT_RATIO_VIDEO,
} from '../core/models.js';

// Zod 3 requires a mutable string tuple for z.enum(), but our constants are readonly.
// We cast via `as unknown as [string, ...string[]]` to satisfy the overload without losing
// type safety — the actual values are still constrained by the readonly arrays at the source.
const PersonGenerationVideoEnum = z.enum(
  PERSON_GENERATION_VIDEO as unknown as [string, ...string[]],
);
const VideoResolutionEnum = z.enum(VIDEO_RESOLUTION as unknown as [string, ...string[]]);
const AspectRatioVideoEnum = z.enum(ASPECT_RATIO_VIDEO as unknown as [string, ...string[]]);

// VIDEO_DURATION_SECONDS = [4, 6, 8] — Zod can't use numeric arrays with z.enum().
// Use z.union of literals for type-safe numeric enum with a default.
const DurationSecondsSchema = z.union([z.literal(4), z.literal(6), z.literal(8)]);

// Restricted regions that enforce allow_adult personGeneration
const RESTRICTED_REGIONS = ['EU', 'UK', 'CH', 'MENA'] as const;

// ---------------------------------------------------------------------------
// Shared resolution+duration cross-field rule:
// 4k and 1080p are only supported at durationSeconds=8.
// ---------------------------------------------------------------------------
function addResolutionDurationIssue(
  ctx: z.RefinementCtx,
  resolution: string,
  durationSeconds: number,
): void {
  if ((resolution === '4k' || resolution === '1080p') && durationSeconds !== 8) {
    ctx.addIssue({
      code: 'custom',
      path: ['durationSeconds'],
      message: `${resolution} resolution requires durationSeconds=8`,
    });
  }
}

// Shared region+personGeneration cross-field rule for T2V (allow_all is rejected).
function addRegionPersonGenerationIssue(
  ctx: z.RefinementCtx,
  region: string | undefined,
  personGeneration: string,
): void {
  if (
    region !== undefined &&
    (RESTRICTED_REGIONS as readonly string[]).includes(region) &&
    personGeneration === 'allow_all'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['personGeneration'],
      message: 'restricted region forces allow_adult',
    });
  }
}

// ---------------------------------------------------------------------------
// Note on discriminatedUnion + superRefine (same constraint as image-schemas):
// ZodEffects produced by .superRefine() are not accepted by discriminatedUnion in Zod 3.
// Internal *Base schemas are used for the union; exported schemas add superRefine.
// ---------------------------------------------------------------------------

// A) GenerateVideoT2VInput (op='t2v') — text to video
export const _T2VBase = z
  .object({
    op: z.literal('t2v'),
    model: z.literal(VIDEO_MODEL_VEO_3_1_PRO).default(VIDEO_MODEL_VEO_3_1_PRO),
    prompt: z.string().trim().min(1).max(2000),
    aspectRatio: AspectRatioVideoEnum.default('16:9'),
    durationSeconds: DurationSecondsSchema.default(8),
    resolution: VideoResolutionEnum.default('720p'),
    generateAudio: z.boolean().default(true),
    personGeneration: PersonGenerationVideoEnum.default('allow_all'),
    region: z.string().optional(),
    seed: z.number().int().nonnegative().optional(),
    negativePrompt: z.string().max(500).optional(),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const GenerateVideoT2VInput = _T2VBase.superRefine((v, ctx) => {
  addResolutionDurationIssue(ctx, v.resolution, v.durationSeconds);
  addRegionPersonGenerationIssue(ctx, v.region, v.personGeneration);
});

export type GenerateVideoT2VInputT = z.infer<typeof GenerateVideoT2VInput>;

// B) GenerateVideoI2VInput (op='i2v') — image (first frame) to video
export const _I2VBase = z
  .object({
    op: z.literal('i2v'),
    model: z.literal(VIDEO_MODEL_VEO_3_1_PRO).default(VIDEO_MODEL_VEO_3_1_PRO),
    prompt: z.string().trim().min(1).max(2000),
    firstFrameImage: z.string(),
    aspectRatio: AspectRatioVideoEnum.default('16:9'),
    durationSeconds: DurationSecondsSchema.default(8),
    resolution: VideoResolutionEnum.default('720p'),
    generateAudio: z.boolean().default(true),
    // i2v requires allow_adult per spec
    personGeneration: PersonGenerationVideoEnum.default('allow_adult'),
    region: z.string().optional(),
    seed: z.number().int().nonnegative().optional(),
    negativePrompt: z.string().max(500).optional(),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const GenerateVideoI2VInput = _I2VBase.superRefine((v, ctx) => {
  addResolutionDurationIssue(ctx, v.resolution, v.durationSeconds);
  addRegionPersonGenerationIssue(ctx, v.region, v.personGeneration);
  if (v.personGeneration === 'allow_all') {
    ctx.addIssue({
      code: 'custom',
      path: ['personGeneration'],
      message: 'i2v mode requires personGeneration=allow_adult',
    });
  }
});

export type GenerateVideoI2VInputT = z.infer<typeof GenerateVideoI2VInput>;

// C) GenerateVideoInterpolateInput (op='interpolate') — first + last frame to video
export const _InterpolateBase = z
  .object({
    op: z.literal('interpolate'),
    model: z.literal(VIDEO_MODEL_VEO_3_1_PRO).default(VIDEO_MODEL_VEO_3_1_PRO),
    prompt: z.string().trim().min(1).max(2000),
    firstFrameImage: z.string(),
    lastFrameImage: z.string(),
    aspectRatio: AspectRatioVideoEnum.default('16:9'),
    durationSeconds: DurationSecondsSchema.default(8),
    resolution: VideoResolutionEnum.default('720p'),
    generateAudio: z.boolean().default(true),
    personGeneration: PersonGenerationVideoEnum.default('allow_adult'),
    region: z.string().optional(),
    seed: z.number().int().nonnegative().optional(),
    negativePrompt: z.string().max(500).optional(),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const GenerateVideoInterpolateInput = _InterpolateBase.superRefine((v, ctx) => {
  addResolutionDurationIssue(ctx, v.resolution, v.durationSeconds);
  addRegionPersonGenerationIssue(ctx, v.region, v.personGeneration);
  if (v.personGeneration === 'allow_all') {
    ctx.addIssue({
      code: 'custom',
      path: ['personGeneration'],
      message: 'interpolate mode requires personGeneration=allow_adult',
    });
  }
});

export type GenerateVideoInterpolateInputT = z.infer<typeof GenerateVideoInterpolateInput>;

// D) GenerateVideoWithRefsInput (op='with-refs') — text + up to 3 asset reference images
export const _WithRefsBase = z
  .object({
    op: z.literal('with-refs'),
    model: z.literal(VIDEO_MODEL_VEO_3_1_PRO).default(VIDEO_MODEL_VEO_3_1_PRO),
    prompt: z.string().trim().min(1).max(2000),
    referenceImages: z
      .array(
        z.object({
          path: z.string(),
          referenceType: z.literal('ASSET'),
        }),
      )
      .min(1)
      .max(3),
    aspectRatio: AspectRatioVideoEnum.default('16:9'),
    durationSeconds: DurationSecondsSchema.default(8),
    resolution: VideoResolutionEnum.default('720p'),
    generateAudio: z.boolean().default(true),
    personGeneration: PersonGenerationVideoEnum.default('allow_adult'),
    region: z.string().optional(),
    seed: z.number().int().nonnegative().optional(),
    negativePrompt: z.string().max(500).optional(),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const GenerateVideoWithRefsInput = _WithRefsBase.superRefine((v, ctx) => {
  addResolutionDurationIssue(ctx, v.resolution, v.durationSeconds);
  addRegionPersonGenerationIssue(ctx, v.region, v.personGeneration);
  if (v.personGeneration === 'allow_all') {
    ctx.addIssue({
      code: 'custom',
      path: ['personGeneration'],
      message: 'with-refs mode requires personGeneration=allow_adult',
    });
  }
});

export type GenerateVideoWithRefsInputT = z.infer<typeof GenerateVideoWithRefsInput>;

// E) ExtendVideoInput (op='extend') — extend existing video by +7s hop
export const ExtendVideoInput = z
  .object({
    op: z.literal('extend'),
    model: z.literal(VIDEO_MODEL_VEO_3_1_PRO).default(VIDEO_MODEL_VEO_3_1_PRO),
    sourceVideoPath: z.string(),
    prompt: z.string().trim().min(1).max(2000),
    // Extension is 720p only
    resolution: z.literal('720p').default('720p'),
    // Each hop = +7s
    durationSeconds: z.literal(7).default(7),
    // Up to 20 hops (0-indexed → max index 19)
    hopIndex: z.number().int().min(0).max(19).default(0),
    personGeneration: PersonGenerationVideoEnum.default('allow_all'),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type ExtendVideoInputT = z.infer<typeof ExtendVideoInput>;

// F) PollVideoOperationInput (op='poll') — poll long-running operation status
export const PollVideoOperationInput = z
  .object({
    op: z.literal('poll'),
    operationName: z.string(),
    intervalMs: z.number().int().min(1000).max(60000).default(10000),
    timeoutMs: z.number().int().min(60000).max(1800000).default(900000),
  })
  .strict();

export type PollVideoOperationInputT = z.infer<typeof PollVideoOperationInput>;

// G) DownloadVideoInput (op='download') — fetch operation result video
export const DownloadVideoInput = z
  .object({
    op: z.literal('download'),
    operationName: z.string(),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
  })
  .strict();

export type DownloadVideoInputT = z.infer<typeof DownloadVideoInput>;

// ---------------------------------------------------------------------------
// Aggregate discriminated union on 'op'
// Uses *Base schemas (ZodObject, no superRefine) for discriminatedUnion compatibility.
// ---------------------------------------------------------------------------
export const VideoInput = z.discriminatedUnion('op', [
  _T2VBase,
  _I2VBase,
  _InterpolateBase,
  _WithRefsBase,
  ExtendVideoInput,
  PollVideoOperationInput,
  DownloadVideoInput,
]);

export type VideoInputT = z.infer<typeof VideoInput>;
