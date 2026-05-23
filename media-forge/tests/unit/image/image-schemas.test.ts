import { describe, it, expect } from 'vitest';
import {
  NanoBananaProInput,
  Imagen4UltraInput,
  EditImageInput,
  ComposeSceneInput,
  DescribeImageInput,
  ExtractPaletteInput,
  ImageInput,
} from '../../../src/image/image-schemas.js';

// ---------------------------------------------------------------------------
// A) NanoBananaProInput
// ---------------------------------------------------------------------------
describe('NanoBananaProInput', () => {
  const VALID_BASE = { op: 'nano-banana-pro' as const, prompt: 'a sunset over the mountains' };

  it('happy path — minimal valid input parses successfully', () => {
    const r = NanoBananaProInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, aspectRatio, imageSize, personGeneration, referenceImages, useGoogleSearch, outputDir, dryRun', () => {
    const r = NanoBananaProInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('gemini-3-pro-image-preview');
    expect(r.data.aspectRatio).toBe('1:1');
    expect(r.data.imageSize).toBe('4K');
    expect(r.data.personGeneration).toBe('ALLOW_ADULT');
    expect(r.data.referenceImages).toEqual([]);
    expect(r.data.useGoogleSearch).toBe(false);
    expect(r.data.outputDir).toBe('./outputs');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, unknownKey: 'oops' });
    expect(r.success).toBe(false);
  });

  it('rejects prompt that is empty string', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, prompt: '' });
    expect(r.success).toBe(false);
  });

  it('rejects prompt that exceeds 8000 characters', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, prompt: 'x'.repeat(8001) });
    expect(r.success).toBe(false);
  });

  it('accepts prompt exactly at 8000 characters', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, prompt: 'x'.repeat(8000) });
    expect(r.success).toBe(true);
  });

  it('rejects invalid aspectRatio enum', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, aspectRatio: '21:10' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid imageSize enum', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, imageSize: '8K' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid personGeneration enum', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, personGeneration: 'allow_all' }); // wrong casing
    expect(r.success).toBe(false);
  });

  it('rejects invalid thinkingLevel enum', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, thinkingLevel: 'ULTRA' });
    expect(r.success).toBe(false);
  });

  it('rejects referenceImages array exceeding 14 items', () => {
    const refs = Array.from({ length: 15 }, (_, i) => ({ path: `/img/${i}.png` }));
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, referenceImages: refs });
    expect(r.success).toBe(false);
  });

  it('accepts referenceImages array at exactly 14 items', () => {
    const refs = Array.from({ length: 14 }, (_, i) => ({ path: `/img/${i}.png` }));
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, referenceImages: refs });
    expect(r.success).toBe(true);
  });

  it('thinkingLevel and thinkingBudget are mutually exclusive — rejects when both set', () => {
    const r = NanoBananaProInput.safeParse({
      ...VALID_BASE,
      thinkingLevel: 'HIGH',
      thinkingBudget: 1000,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.includes('thinkingLevel'));
    expect(issue?.message).toContain('mutually exclusive');
  });

  it('thinkingLevel alone is valid', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, thinkingLevel: 'HIGH' });
    expect(r.success).toBe(true);
  });

  it('thinkingBudget alone is valid', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, thinkingBudget: 1000 });
    expect(r.success).toBe(true);
  });

  it('trims leading/trailing whitespace from prompt', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, prompt: '  hello  ' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.prompt).toBe('hello');
  });

  it('prompt that is only whitespace is rejected (trim → empty)', () => {
    const r = NanoBananaProInput.safeParse({ ...VALID_BASE, prompt: '   ' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B) Imagen4UltraInput
// ---------------------------------------------------------------------------
describe('Imagen4UltraInput', () => {
  const VALID_BASE = { op: 'imagen-4-ultra' as const, prompt: 'a majestic lion' };

  it('happy path — minimal valid input parses successfully', () => {
    const r = Imagen4UltraInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, aspectRatio, imageSize, numberOfImages, personGeneration, outputDir, dryRun', () => {
    const r = Imagen4UltraInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('imagen-4.0-ultra-generate-001');
    expect(r.data.aspectRatio).toBe('1:1');
    expect(r.data.imageSize).toBe('2K');
    expect(r.data.numberOfImages).toBe(1);
    expect(r.data.personGeneration).toBe('ALLOW_ADULT');
    expect(r.data.outputDir).toBe('./outputs');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, extraKey: 'nope' });
    expect(r.success).toBe(false);
  });

  it('rejects imageSize 4K (Ultra excludes 4K)', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, imageSize: '4K' });
    expect(r.success).toBe(false);
  });

  it('accepts imageSize 1K', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, imageSize: '1K' });
    expect(r.success).toBe(true);
  });

  it('rejects prompt that is empty', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, prompt: '' });
    expect(r.success).toBe(false);
  });

  it('rejects prompt exceeding 8000 chars', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, prompt: 'y'.repeat(8001) });
    expect(r.success).toBe(false);
  });

  it('accepts valid seed (nonnegative integer)', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, seed: 42 });
    expect(r.success).toBe(true);
  });

  it('rejects negative seed', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, seed: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects negativePrompt exceeding 500 chars', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, negativePrompt: 'z'.repeat(501) });
    expect(r.success).toBe(false);
  });

  it('rejects invalid aspectRatio for Imagen (e.g. 21:9 is Nano-Banana-only)', () => {
    const r = Imagen4UltraInput.safeParse({ ...VALID_BASE, aspectRatio: '21:9' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C) EditImageInput
// ---------------------------------------------------------------------------
describe('EditImageInput', () => {
  const VALID_BASE = {
    op: 'edit-image' as const,
    prompt: 'remove the background',
    sourceImage: '/path/to/source.png',
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = EditImageInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, editMode, personGeneration, outputDir, dryRun', () => {
    const r = EditImageInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('gemini-3-pro-image-preview');
    expect(r.data.editMode).toBe('edit');
    expect(r.data.personGeneration).toBe('ALLOW_ADULT');
    expect(r.data.outputDir).toBe('./outputs');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = EditImageInput.safeParse({ ...VALID_BASE, extra: 'val' });
    expect(r.success).toBe(false);
  });

  it('inpaint with maskImage succeeds', () => {
    const r = EditImageInput.safeParse({
      ...VALID_BASE,
      editMode: 'inpaint',
      maskImage: '/path/to/mask.png',
    });
    expect(r.success).toBe(true);
  });

  it('inpaint WITHOUT maskImage is rejected', () => {
    const r = EditImageInput.safeParse({ ...VALID_BASE, editMode: 'inpaint' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.includes('maskImage'));
    expect(issue?.message).toContain('inpaint requires maskImage');
  });

  it('non-inpaint editMode without maskImage is accepted', () => {
    const r = EditImageInput.safeParse({ ...VALID_BASE, editMode: 'outpaint' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid editMode enum', () => {
    const r = EditImageInput.safeParse({ ...VALID_BASE, editMode: 'sketch' });
    expect(r.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const r = EditImageInput.safeParse({ ...VALID_BASE, prompt: '' });
    expect(r.success).toBe(false);
  });

  it('rejects prompt exceeding 8000 chars', () => {
    const r = EditImageInput.safeParse({ ...VALID_BASE, prompt: 'a'.repeat(8001) });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D) ComposeSceneInput
// ---------------------------------------------------------------------------
describe('ComposeSceneInput', () => {
  const VALID_BASE = {
    op: 'compose-scene' as const,
    prompt: 'compose a cinematic scene',
    referenceImages: [{ path: '/img/ref1.png' }],
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = ComposeSceneInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, aspectRatio, imageSize, personGeneration, thinkingLevel, outputDir, dryRun', () => {
    const r = ComposeSceneInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('gemini-3-pro-image-preview');
    expect(r.data.aspectRatio).toBe('16:9');
    expect(r.data.imageSize).toBe('4K');
    expect(r.data.personGeneration).toBe('ALLOW_ADULT');
    expect(r.data.thinkingLevel).toBe('HIGH');
    expect(r.data.outputDir).toBe('./outputs');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = ComposeSceneInput.safeParse({ ...VALID_BASE, mystery: true });
    expect(r.success).toBe(false);
  });

  it('rejects empty referenceImages array (min 1 required)', () => {
    const r = ComposeSceneInput.safeParse({ ...VALID_BASE, referenceImages: [] });
    expect(r.success).toBe(false);
  });

  it('rejects referenceImages array exceeding 14 items', () => {
    const refs = Array.from({ length: 15 }, (_, i) => ({ path: `/img/${i}.png` }));
    const r = ComposeSceneInput.safeParse({ ...VALID_BASE, referenceImages: refs });
    expect(r.success).toBe(false);
  });

  it('accepts referenceImages at max 14 items', () => {
    const refs = Array.from({ length: 14 }, (_, i) => ({ path: `/img/${i}.png` }));
    const r = ComposeSceneInput.safeParse({ ...VALID_BASE, referenceImages: refs });
    expect(r.success).toBe(true);
  });

  it('accepts roleLabel in referenceImages item', () => {
    const r = ComposeSceneInput.safeParse({
      ...VALID_BASE,
      referenceImages: [{ path: '/img/ref1.png', roleLabel: 'background' }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid thinkingLevel', () => {
    const r = ComposeSceneInput.safeParse({ ...VALID_BASE, thinkingLevel: 'EXTREME' });
    expect(r.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const r = ComposeSceneInput.safeParse({ ...VALID_BASE, prompt: '' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E) DescribeImageInput
// ---------------------------------------------------------------------------
describe('DescribeImageInput', () => {
  const VALID_BASE = { op: 'describe-image' as const, imagePath: '/img/photo.jpg' };

  it('happy path — minimal valid input parses successfully', () => {
    const r = DescribeImageInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, detailLevel, dryRun', () => {
    const r = DescribeImageInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('gemini-3-pro-image-preview');
    expect(r.data.detailLevel).toBe('detailed');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = DescribeImageInput.safeParse({ ...VALID_BASE, extra: 'ghost' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid detailLevel', () => {
    const r = DescribeImageInput.safeParse({ ...VALID_BASE, detailLevel: 'verbose' });
    expect(r.success).toBe(false);
  });

  it('accepts each valid detailLevel value', () => {
    for (const level of ['brief', 'detailed', 'technical'] as const) {
      const r = DescribeImageInput.safeParse({ ...VALID_BASE, detailLevel: level });
      expect(r.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// F) ExtractPaletteInput
// ---------------------------------------------------------------------------
describe('ExtractPaletteInput', () => {
  const VALID_BASE = { op: 'extract-palette' as const, imagePath: '/img/brand.png' };

  it('happy path — minimal valid input parses successfully', () => {
    const r = ExtractPaletteInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: colorCount, format, dryRun', () => {
    const r = ExtractPaletteInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.colorCount).toBe(5);
    expect(r.data.format).toBe('hex');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = ExtractPaletteInput.safeParse({ ...VALID_BASE, unknown: 'val' });
    expect(r.success).toBe(false);
  });

  it('rejects colorCount below 2', () => {
    const r = ExtractPaletteInput.safeParse({ ...VALID_BASE, colorCount: 1 });
    expect(r.success).toBe(false);
  });

  it('accepts colorCount at boundary 2', () => {
    const r = ExtractPaletteInput.safeParse({ ...VALID_BASE, colorCount: 2 });
    expect(r.success).toBe(true);
  });

  it('rejects colorCount above 16', () => {
    const r = ExtractPaletteInput.safeParse({ ...VALID_BASE, colorCount: 17 });
    expect(r.success).toBe(false);
  });

  it('accepts colorCount at boundary 16', () => {
    const r = ExtractPaletteInput.safeParse({ ...VALID_BASE, colorCount: 16 });
    expect(r.success).toBe(true);
  });

  it('rejects invalid format', () => {
    const r = ExtractPaletteInput.safeParse({ ...VALID_BASE, format: 'cmyk' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ImageInput — aggregate discriminated union
// ---------------------------------------------------------------------------
describe('ImageInput (discriminated union)', () => {
  it('rejects unknown op value', () => {
    const r = ImageInput.safeParse({ op: 'unknown-op', prompt: 'test' });
    expect(r.success).toBe(false);
  });

  it('succeeds with nano-banana-pro + minimal fields, applying defaults', () => {
    const r = ImageInput.safeParse({ op: 'nano-banana-pro', prompt: 'hello' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.op).toBe('nano-banana-pro');
  });

  it('routes to correct variant for imagen-4-ultra', () => {
    const r = ImageInput.safeParse({ op: 'imagen-4-ultra', prompt: 'a cat' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.op).toBe('imagen-4-ultra');
  });

  it('routes to correct variant for edit-image', () => {
    const r = ImageInput.safeParse({
      op: 'edit-image',
      prompt: 'blur background',
      sourceImage: '/src.png',
    });
    expect(r.success).toBe(true);
  });

  it('routes to correct variant for compose-scene', () => {
    const r = ImageInput.safeParse({
      op: 'compose-scene',
      prompt: 'scene',
      referenceImages: [{ path: '/a.png' }],
    });
    expect(r.success).toBe(true);
  });

  it('routes to correct variant for describe-image', () => {
    const r = ImageInput.safeParse({ op: 'describe-image', imagePath: '/a.png' });
    expect(r.success).toBe(true);
  });

  it('routes to correct variant for extract-palette', () => {
    const r = ImageInput.safeParse({ op: 'extract-palette', imagePath: '/a.png' });
    expect(r.success).toBe(true);
  });

  it('rejects missing op entirely', () => {
    const r = ImageInput.safeParse({ prompt: 'test' });
    expect(r.success).toBe(false);
  });
});
