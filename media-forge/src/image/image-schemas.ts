import { z } from 'zod';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  THINKING_LEVELS,
  PERSON_GENERATION_IMAGE,
  IMAGE_SIZE,
  ASPECT_RATIO_NANO_BANANA,
  ASPECT_RATIO_IMAGEN,
} from '../core/models.js';

// Zod 3 requires a mutable string tuple for z.enum(), but our constants are readonly.
// We cast via `as unknown as [string, ...string[]]` to satisfy the overload without losing
// type safety — the actual values are still constrained by the readonly arrays at the source.
const ThinkingLevelEnum = z.enum(THINKING_LEVELS as unknown as [string, ...string[]]);
const PersonGenerationImageEnum = z.enum(
  PERSON_GENERATION_IMAGE as unknown as [string, ...string[]],
);
const ImageSizeEnum = z.enum(IMAGE_SIZE as unknown as [string, ...string[]]);
const AspectRatioNanaBananaEnum = z.enum(
  ASPECT_RATIO_NANO_BANANA as unknown as [string, ...string[]],
);
const AspectRatioImagenEnum = z.enum(ASPECT_RATIO_IMAGEN as unknown as [string, ...string[]]);

const ReferenceImageItem = z.object({
  path: z.string(),
  roleLabel: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Note on discriminatedUnion + superRefine:
// In Zod 3, z.discriminatedUnion() only accepts ZodObject members — wrapping a schema
// with .superRefine() produces a ZodEffects which is rejected at runtime AND by the TS
// type checker. Strategy: define a *base* ZodObject for each variant (used in the union),
// then export the fully-validated schema (base + superRefine) for callers that need the
// cross-field checks. The base schemas are unexported internal helpers.
// ---------------------------------------------------------------------------

// A) NanoBananaProInput — Gemini multimodal (text → image, up to 14 reference images)
export const _NanoBananaProBase = z
  .object({
    op: z.literal('nano-banana-pro'),
    model: z.literal(IMAGE_MODEL_NANO_BANANA_PRO).default(IMAGE_MODEL_NANO_BANANA_PRO),
    prompt: z.string().trim().min(1).max(8000),
    aspectRatio: AspectRatioNanaBananaEnum.default('1:1'),
    imageSize: ImageSizeEnum.default('4K'),
    personGeneration: PersonGenerationImageEnum.default('ALLOW_ADULT'),
    thinkingLevel: ThinkingLevelEnum.optional(),
    thinkingBudget: z.number().int().positive().optional(),
    referenceImages: z.array(ReferenceImageItem).max(14).default([]),
    useGoogleSearch: z.boolean().default(false),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const NanoBananaProInput = _NanoBananaProBase.superRefine((v, ctx) => {
  if (v.thinkingLevel !== undefined && v.thinkingBudget !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['thinkingLevel'],
      message: 'thinkingLevel and thinkingBudget are mutually exclusive',
    });
  }
});

export type NanoBananaProInputT = z.infer<typeof NanoBananaProInput>;

// B) Imagen4UltraInput — Imagen 4 Ultra (no thinking, no reference images, seed support)
export const Imagen4UltraInput = z
  .object({
    op: z.literal('imagen-4-ultra'),
    model: z.literal(IMAGE_MODEL_IMAGEN_4_ULTRA).default(IMAGE_MODEL_IMAGEN_4_ULTRA),
    prompt: z.string().trim().min(1).max(8000),
    aspectRatio: AspectRatioImagenEnum.default('1:1'),
    // Ultra excludes 4K
    imageSize: z.enum(['1K', '2K']).default('2K'),
    numberOfImages: z.literal(1).default(1),
    seed: z.number().int().nonnegative().optional(),
    negativePrompt: z.string().max(500).optional(),
    personGeneration: PersonGenerationImageEnum.default('ALLOW_ADULT'),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type Imagen4UltraInputT = z.infer<typeof Imagen4UltraInput>;

// C) EditImageInput — semantic edit (add/remove/replace/inpaint/outpaint)
export const _EditImageBase = z
  .object({
    op: z.literal('edit-image'),
    model: z.literal(IMAGE_MODEL_NANO_BANANA_PRO).default(IMAGE_MODEL_NANO_BANANA_PRO),
    prompt: z.string().trim().min(1).max(8000),
    sourceImage: z.string(),
    maskImage: z.string().optional(),
    editMode: z.enum(['edit', 'inpaint', 'outpaint', 'remove', 'replace']).default('edit'),
    aspectRatio: AspectRatioNanaBananaEnum.optional(),
    personGeneration: PersonGenerationImageEnum.default('ALLOW_ADULT'),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const EditImageInput = _EditImageBase.superRefine((v, ctx) => {
  if (v.editMode === 'inpaint' && v.maskImage === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['maskImage'],
      message: 'inpaint requires maskImage',
    });
  }
});

export type EditImageInputT = z.infer<typeof EditImageInput>;

// D) ComposeSceneInput — multi-image composition (1–14 reference images, required)
export const ComposeSceneInput = z
  .object({
    op: z.literal('compose-scene'),
    model: z.literal(IMAGE_MODEL_NANO_BANANA_PRO).default(IMAGE_MODEL_NANO_BANANA_PRO),
    prompt: z.string().trim().min(1).max(8000),
    referenceImages: z.array(ReferenceImageItem).min(1).max(14),
    aspectRatio: AspectRatioNanaBananaEnum.default('16:9'),
    imageSize: ImageSizeEnum.default('4K'),
    personGeneration: PersonGenerationImageEnum.default('ALLOW_ADULT'),
    thinkingLevel: ThinkingLevelEnum.default('HIGH'),
    outputDir: z.string().default('./outputs'),
    filename: z.string().optional(),
    project: z.string().optional(),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type ComposeSceneInputT = z.infer<typeof ComposeSceneInput>;

// E) DescribeImageInput — image → text description via Gemini vision
export const DescribeImageInput = z
  .object({
    op: z.literal('describe-image'),
    imagePath: z.string(),
    model: z.literal(IMAGE_MODEL_NANO_BANANA_PRO).default(IMAGE_MODEL_NANO_BANANA_PRO),
    detailLevel: z.enum(['brief', 'detailed', 'technical']).default('detailed'),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type DescribeImageInputT = z.infer<typeof DescribeImageInput>;

// F) ExtractPaletteInput — extract dominant colors
export const ExtractPaletteInput = z
  .object({
    op: z.literal('extract-palette'),
    imagePath: z.string(),
    colorCount: z.number().int().min(2).max(16).default(5),
    format: z.enum(['hex', 'rgb', 'hsl']).default('hex'),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type ExtractPaletteInputT = z.infer<typeof ExtractPaletteInput>;

// ---------------------------------------------------------------------------
// Aggregate discriminated union on 'op'
// Uses the *base* ZodObject schemas (not the superRefine-wrapped ZodEffects) so that
// Zod 3's discriminatedUnion can inspect the discriminator field. Cross-field validation
// is enforced by the individual exported schemas (NanoBananaProInput, EditImageInput).
// ---------------------------------------------------------------------------
export const ImageInput = z.discriminatedUnion('op', [
  _NanoBananaProBase,
  Imagen4UltraInput,
  _EditImageBase,
  ComposeSceneInput,
  DescribeImageInput,
  ExtractPaletteInput,
]);

export type ImageInputT = z.infer<typeof ImageInput>;
