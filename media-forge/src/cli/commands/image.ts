import type { Command } from 'commander';
import { addCommonFlags, exitOk, exitErr, CliExit } from '../shared.js';
import { createClient } from '../../core/client.js';
import { loadConfig } from '../../core/config.js';
import {
  generateImageNanoBananaPro,
  generateImageImagen4Ultra,
  editImage,
  composeScene,
  describeImage,
  extractPalette,
} from '../../image/image-service.js';
import { estimateImageCost } from '../../core/cost.js';
import {
  NanoBananaProInput,
  Imagen4UltraInput,
  EditImageInput,
  ComposeSceneInput,
  DescribeImageInput,
  ExtractPaletteInput,
} from '../../image/image-schemas.js';
import { IMAGE_MODEL_NANO_BANANA_PRO, IMAGE_MODEL_IMAGEN_4_ULTRA } from '../../core/models.js';

// ---------------------------------------------------------------------------
// CLI flag types (exported for testing)
// ---------------------------------------------------------------------------

export interface GenerateOpts {
  aspectRatio?: string;
  imageSize?: string;
  thinkingLevel?: string;
  personGeneration?: string;
  referenceImages?: string[];
  useGoogleSearch?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface ImagenOpts {
  aspectRatio?: string;
  imageSize?: string;
  seed?: string;
  negativePrompt?: string;
  personGeneration?: string;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface EditOpts {
  editMode?: string;
  mask?: string;
  aspectRatio?: string;
  personGeneration?: string;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface ComposeOpts {
  ref?: string[];
  aspectRatio?: string;
  imageSize?: string;
  personGeneration?: string;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface DescribeOpts {
  detailLevel?: string;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface PaletteOpts {
  colorCount?: string;
  format?: string;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

// ---------------------------------------------------------------------------
// Input builders — map CLI flags → schema-shaped objects
// Exported for testing.
// ---------------------------------------------------------------------------

export function buildNanoBananaProInput(prompt: string, opts: GenerateOpts) {
  return NanoBananaProInput.parse({
    op: 'nano-banana-pro',
    prompt,
    aspectRatio: opts.aspectRatio ?? '1:1',
    imageSize: opts.imageSize ?? '4K',
    thinkingLevel: opts.thinkingLevel,
    personGeneration: opts.personGeneration ?? 'ALLOW_ADULT',
    referenceImages: (opts.referenceImages ?? []).map((p) => ({ path: p })),
    useGoogleSearch: opts.useGoogleSearch ?? false,
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildImagen4UltraInput(prompt: string, opts: ImagenOpts) {
  return Imagen4UltraInput.parse({
    op: 'imagen-4-ultra',
    prompt,
    aspectRatio: opts.aspectRatio ?? '1:1',
    imageSize: opts.imageSize ?? '2K',
    seed: opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined,
    negativePrompt: opts.negativePrompt,
    personGeneration: opts.personGeneration ?? 'ALLOW_ADULT',
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildEditImageInput(sourceImage: string, prompt: string, opts: EditOpts) {
  return EditImageInput.parse({
    op: 'edit-image',
    prompt,
    sourceImage,
    maskImage: opts.mask,
    editMode: opts.editMode ?? 'edit',
    aspectRatio: opts.aspectRatio,
    personGeneration: opts.personGeneration ?? 'ALLOW_ADULT',
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildComposeSceneInput(prompt: string, opts: ComposeOpts) {
  const refs = (opts.ref ?? []).map((p) => ({ path: p }));
  return ComposeSceneInput.parse({
    op: 'compose-scene',
    prompt,
    referenceImages: refs,
    aspectRatio: opts.aspectRatio ?? '16:9',
    imageSize: opts.imageSize ?? '4K',
    personGeneration: opts.personGeneration ?? 'ALLOW_ADULT',
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildDescribeImageInput(imagePath: string, opts: DescribeOpts) {
  return DescribeImageInput.parse({
    op: 'describe-image',
    imagePath,
    detailLevel: opts.detailLevel ?? 'detailed',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildExtractPaletteInput(imagePath: string, opts: PaletteOpts) {
  return ExtractPaletteInput.parse({
    op: 'extract-palette',
    imagePath,
    colorCount: opts.colorCount !== undefined ? parseInt(opts.colorCount, 10) : 5,
    format: opts.format ?? 'hex',
    dryRun: opts.dryRun ?? false,
  });
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerImageCommands(program: Command): void {
  const img = program.command('image').description('Image generation/editing subcommands');

  // --- generate (Nano Banana Pro) ---
  const gen = img
    .command('generate')
    .description('Generate an image via Nano Banana Pro')
    .argument('<prompt>', 'Text prompt')
    .option('--aspect-ratio <ratio>', '1:1, 16:9, 9:16, etc.', '1:1')
    .option('--image-size <size>', '1K | 2K | 4K', '4K')
    .option('--thinking-level <level>', 'MINIMAL | LOW | MEDIUM | HIGH', 'HIGH')
    .option('--person-generation <mode>', 'ALLOW_ALL | ALLOW_ADULT | ALLOW_NONE', 'ALLOW_ADULT')
    .option('--reference-images <paths...>', 'Up to 14 reference image paths')
    .option('--use-google-search', 'Enable Google Search grounding', false);
  addCommonFlags(gen);
  gen.action(async (prompt: string, opts: GenerateOpts) => {
    try {
      const input = buildNanoBananaProInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          imageSize: input.imageSize as '1K' | '2K' | '4K',
          numberOfImages: 1,
        });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await generateImageNanoBananaPro(input, client);
      exitOk(result, opts);
    } catch (err) {
      if (err instanceof CliExit) throw err;
      exitErr(err, opts);
    }
  });

  // --- imagen (Imagen 4 Ultra) ---
  const imagen = img
    .command('imagen')
    .description('Generate an image via Imagen 4 Ultra')
    .argument('<prompt>', 'Text prompt')
    .option('--aspect-ratio <ratio>', '1:1, 3:4, 4:3, 9:16, 16:9', '1:1')
    .option('--image-size <size>', '1K | 2K', '2K')
    .option('--seed <n>', 'Random seed (integer)')
    .option('--negative-prompt <text>', 'Negative prompt (max 500 chars)')
    .option('--person-generation <mode>', 'ALLOW_ALL | ALLOW_ADULT | ALLOW_NONE', 'ALLOW_ADULT');
  addCommonFlags(imagen);
  imagen.action(async (prompt: string, opts: ImagenOpts) => {
    try {
      const input = buildImagen4UltraInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateImageCost({
          model: IMAGE_MODEL_IMAGEN_4_ULTRA,
        });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await generateImageImagen4Ultra(input, client);
      exitOk(result, opts);
    } catch (err) {
      if (err instanceof CliExit) throw err;
      exitErr(err, opts);
    }
  });

  // --- edit ---
  const edit = img
    .command('edit')
    .description('Edit an existing image (semantic edit/inpaint/outpaint/remove/replace)')
    .argument('<sourceImage>', 'Path to source image')
    .argument('<prompt>', 'Edit prompt')
    .option('--edit-mode <mode>', 'edit | inpaint | outpaint | remove | replace', 'edit')
    .option('--mask <path>', 'Mask image path (required for inpaint mode)')
    .option('--aspect-ratio <ratio>', 'Output aspect ratio')
    .option('--person-generation <mode>', 'ALLOW_ALL | ALLOW_ADULT | ALLOW_NONE', 'ALLOW_ADULT');
  addCommonFlags(edit);
  edit.action(async (sourceImage: string, prompt: string, opts: EditOpts) => {
    try {
      const input = buildEditImageInput(sourceImage, prompt, opts);
      if (opts.estimateCost) {
        const est = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          imageSize: '4K',
        });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await editImage(input, client);
      exitOk(result, opts);
    } catch (err) {
      if (err instanceof CliExit) throw err;
      exitErr(err, opts);
    }
  });

  // --- compose ---
  const compose = img
    .command('compose')
    .description('Compose a scene from multiple reference images')
    .argument('<prompt>', 'Composition prompt')
    .option('--ref <path>', 'Reference image path (repeat for multiple)', (val, acc: string[]) => {
      acc.push(val);
      return acc;
    }, [] as string[])
    .option('--aspect-ratio <ratio>', '1:1 | 16:9 | 9:16', '16:9')
    .option('--image-size <size>', '1K | 2K | 4K', '4K')
    .option('--person-generation <mode>', 'ALLOW_ALL | ALLOW_ADULT | ALLOW_NONE', 'ALLOW_ADULT');
  addCommonFlags(compose);
  compose.action(async (prompt: string, opts: ComposeOpts) => {
    try {
      const input = buildComposeSceneInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          imageSize: (input.imageSize ?? '4K') as '1K' | '2K' | '4K',
        });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await composeScene(input, client);
      exitOk(result, opts);
    } catch (err) {
      if (err instanceof CliExit) throw err;
      exitErr(err, opts);
    }
  });

  // --- describe ---
  const describe = img
    .command('describe')
    .description('Describe an image via Gemini vision')
    .argument('<imagePath>', 'Path to image file')
    .option('--detail-level <level>', 'brief | detailed | technical', 'detailed');
  addCommonFlags(describe);
  describe.action(async (imagePath: string, opts: DescribeOpts) => {
    try {
      const input = buildDescribeImageInput(imagePath, opts);
      if (opts.estimateCost) {
        // describe uses the vision model — same pricing as Nano Banana Pro
        const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize: '4K' });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await describeImage(input, client);
      exitOk(result, opts);
    } catch (err) {
      if (err instanceof CliExit) throw err;
      exitErr(err, opts);
    }
  });

  // --- palette ---
  const palette = img
    .command('palette')
    .description('Extract dominant color palette from an image')
    .argument('<imagePath>', 'Path to image file')
    .option('--color-count <n>', 'Number of colors to extract (2-16)', '5')
    .option('--format <fmt>', 'hex | rgb | hsl', 'hex');
  addCommonFlags(palette);
  palette.action(async (imagePath: string, opts: PaletteOpts) => {
    try {
      const input = buildExtractPaletteInput(imagePath, opts);
      if (opts.estimateCost) {
        // extractPalette is local (node-vibrant) — zero API cost
        exitOk({ estimateUsd: 0, breakdown: 'local processing (node-vibrant), no API call' }, opts);
      }
      // extractPalette does not take a client — local processing
      const result = await extractPalette(input);
      exitOk(result, opts);
    } catch (err) {
      if (err instanceof CliExit) throw err;
      exitErr(err, opts);
    }
  });
}
