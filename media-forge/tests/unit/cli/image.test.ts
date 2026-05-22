/**
 * Tests for image CLI commands (commit 9.2).
 *
 * Strategy: test the exported input builder functions directly (no commander
 * parsing, no process.exit) for all flag mapping / validation assertions.
 * Commander wiring is verified in a small set of integration-style tests that
 * import the builders after mocking the service layer.
 */
import { describe, it, expect } from 'vitest';
import {
  buildNanoBananaProInput,
  buildImagen4UltraInput,
  buildEditImageInput,
  buildComposeSceneInput,
  buildDescribeImageInput,
  buildExtractPaletteInput,
} from '../../../src/cli/commands/image.js';

// ---------------------------------------------------------------------------
// 1. generateNanoBananaPro — prompt set correctly
// ---------------------------------------------------------------------------
describe('buildNanoBananaProInput', () => {
  it('sets prompt from positional arg', () => {
    const input = buildNanoBananaProInput('hello world', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.prompt).toBe('hello world');
    expect(input.op).toBe('nano-banana-pro');
  });

  // 2. --dry-run propagated to input schema dryRun field
  it('--dry-run: input.dryRun=true', () => {
    const input = buildNanoBananaProInput('test', { dryRun: true, json: false, estimateCost: false, strict: false });
    expect(input.dryRun).toBe(true);
  });

  // 3. --json flag does not affect the input builder (it's a CLI output flag)
  it('json flag is CLI output flag, does not affect input schema', () => {
    const input = buildNanoBananaProInput('test', { dryRun: false, json: true, estimateCost: false, strict: false });
    expect(input.op).toBe('nano-banana-pro');
  });

  // 5. --aspect-ratio 16:9 propagated
  it('--aspect-ratio propagated to input', () => {
    const input = buildNanoBananaProInput('test', {
      aspectRatio: '16:9',
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.aspectRatio).toBe('16:9');
  });

  // 6. --reference-images a.png b.png → referenceImages.length = 2
  it('--reference-images sets referenceImages', () => {
    const input = buildNanoBananaProInput('test', {
      referenceImages: ['a.png', 'b.png'],
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.referenceImages).toHaveLength(2);
    expect(input.referenceImages[0]?.path).toBe('a.png');
    expect(input.referenceImages[1]?.path).toBe('b.png');
  });

  // 7. --use-google-search → useGoogleSearch=true
  it('--use-google-search sets useGoogleSearch=true', () => {
    const input = buildNanoBananaProInput('test', {
      useGoogleSearch: true,
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.useGoogleSearch).toBe(true);
  });

  // 8. Invalid aspect-ratio → Zod throws
  it('invalid aspect-ratio throws ZodError', () => {
    expect(() =>
      buildNanoBananaProInput('test', {
        aspectRatio: 'invalid-ratio',
        dryRun: false,
        json: false,
        estimateCost: false,
        strict: false,
      }),
    ).toThrow();
  });

  it('defaults: aspectRatio=1:1, imageSize=4K, useGoogleSearch=false', () => {
    const input = buildNanoBananaProInput('test', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.aspectRatio).toBe('1:1');
    expect(input.imageSize).toBe('4K');
    expect(input.useGoogleSearch).toBe(false);
    expect(input.referenceImages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. image edit — sourceImage and prompt
// ---------------------------------------------------------------------------
describe('buildEditImageInput', () => {
  it('sets sourceImage and prompt', () => {
    const input = buildEditImageInput('src.png', 'make it blue', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.sourceImage).toBe('src.png');
    expect(input.prompt).toBe('make it blue');
    expect(input.op).toBe('edit-image');
  });

  it('--edit-mode replace propagated', () => {
    const input = buildEditImageInput('src.png', 'change it', {
      editMode: 'replace',
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.editMode).toBe('replace');
  });

  it('default editMode is edit', () => {
    const input = buildEditImageInput('src.png', 'modify', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.editMode).toBe('edit');
  });
});

// ---------------------------------------------------------------------------
// 10. image compose — referenceImages from --ref flags
// ---------------------------------------------------------------------------
describe('buildComposeSceneInput', () => {
  it('builds 2 refs from opts.ref', () => {
    const input = buildComposeSceneInput('scene', {
      ref: ['a.png', 'b.png'],
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.referenceImages).toHaveLength(2);
    expect(input.referenceImages[0]?.path).toBe('a.png');
    expect(input.referenceImages[1]?.path).toBe('b.png');
    expect(input.op).toBe('compose-scene');
  });

  it('throws when no refs provided (min 1)', () => {
    expect(() =>
      buildComposeSceneInput('scene', {
        ref: [],
        dryRun: false,
        json: false,
        estimateCost: false,
        strict: false,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 11. image palette — colorCount and format
// ---------------------------------------------------------------------------
describe('buildExtractPaletteInput', () => {
  it('sets imagePath, colorCount, format', () => {
    const input = buildExtractPaletteInput('img.png', {
      colorCount: '3',
      format: 'hex',
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.imagePath).toBe('img.png');
    expect(input.colorCount).toBe(3);
    expect(input.format).toBe('hex');
    expect(input.op).toBe('extract-palette');
  });

  it('defaults to colorCount=5, format=hex', () => {
    const input = buildExtractPaletteInput('img.png', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.colorCount).toBe(5);
    expect(input.format).toBe('hex');
  });
});

// ---------------------------------------------------------------------------
// 12. image describe — detail-level
// ---------------------------------------------------------------------------
describe('buildDescribeImageInput', () => {
  it('sets imagePath and detailLevel', () => {
    const input = buildDescribeImageInput('img.png', {
      detailLevel: 'technical',
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.imagePath).toBe('img.png');
    expect(input.detailLevel).toBe('technical');
    expect(input.op).toBe('describe-image');
  });

  it('defaults detailLevel=detailed', () => {
    const input = buildDescribeImageInput('img.png', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.detailLevel).toBe('detailed');
  });
});

// ---------------------------------------------------------------------------
// 13. image imagen — seed propagation
// ---------------------------------------------------------------------------
describe('buildImagen4UltraInput', () => {
  it('propagates seed as integer', () => {
    const input = buildImagen4UltraInput('a cool scene', {
      seed: '42',
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.seed).toBe(42);
    expect(input.op).toBe('imagen-4-ultra');
  });

  it('sets prompt correctly', () => {
    const input = buildImagen4UltraInput('cinematic shot', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.prompt).toBe('cinematic shot');
  });

  it('--negative-prompt propagated', () => {
    const input = buildImagen4UltraInput('sunset', {
      negativePrompt: 'blur',
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.negativePrompt).toBe('blur');
  });

  it('defaults to imageSize=2K, aspectRatio=1:1', () => {
    const input = buildImagen4UltraInput('test', {
      dryRun: false,
      json: false,
      estimateCost: false,
      strict: false,
    });
    expect(input.imageSize).toBe('2K');
    expect(input.aspectRatio).toBe('1:1');
  });
});
