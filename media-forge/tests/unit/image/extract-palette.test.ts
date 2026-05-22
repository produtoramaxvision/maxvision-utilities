import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import sharp from 'sharp';
import { extractPalette } from '../../../src/image/extract-palette.js';
import { makeTempDir } from '../../helpers/fs-tempdir.js';
import type { ExtractPaletteInputT } from '../../../src/image/image-schemas.js';

let tmpDir: ReturnType<typeof makeTempDir>;
let imagePath: string;

function makeInput(overrides: Partial<ExtractPaletteInputT> = {}): ExtractPaletteInputT {
  return {
    op: 'extract-palette',
    imagePath,
    colorCount: 5,
    format: 'hex',
    dryRun: false,
    ...overrides,
  };
}

// Create a 100x100 PNG with colored stripes so vibrant can extract real swatches
async function createTestImage(path: string): Promise<void> {
  // 6 colored 100x100 regions stacked — red, green, blue, yellow, purple, orange
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [0, 200, 0],
    [0, 0, 255],
    [255, 200, 0],
    [150, 0, 200],
    [255, 100, 0],
  ];
  const regionHeight = 20;
  const width = 100;
  const totalHeight = regionHeight * colors.length;
  const pixels = Buffer.alloc(width * totalHeight * 3);
  for (let ci = 0; ci < colors.length; ci++) {
    const [r, g, b] = colors[ci]!;
    for (let row = 0; row < regionHeight; row++) {
      for (let col = 0; col < width; col++) {
        const idx = (ci * regionHeight * width + row * width + col) * 3;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
      }
    }
  }
  await sharp(pixels, { raw: { width, height: totalHeight, channels: 3 } })
    .png()
    .toFile(path);
}

describe('extractPalette', () => {
  beforeEach(async () => {
    tmpDir = makeTempDir('extract-palette-test-');
    imagePath = join(tmpDir.path, 'test.png');
    await createTestImage(imagePath);
  });

  afterEach(() => {
    tmpDir.cleanup();
  });

  it('returns colors in hex format by default', async () => {
    const result = await extractPalette(makeInput({ format: 'hex' }));
    expect(result.colors.length).toBeGreaterThan(0);
    // hex colors start with #
    result.colors.forEach((c) => {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it('format=rgb → strings like rgb(255, 0, 0)', async () => {
    const result = await extractPalette(makeInput({ format: 'rgb' }));
    result.colors.forEach((c) => {
      expect(c).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });
  });

  it('format=hsl → strings like hsl(0, 100%, 50%)', async () => {
    const result = await extractPalette(makeInput({ format: 'hsl' }));
    result.colors.forEach((c) => {
      expect(c).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    });
  });

  it('colorCount=2 → at most 2 colors returned', async () => {
    const result = await extractPalette(makeInput({ colorCount: 2 }));
    expect(result.colors.length).toBeLessThanOrEqual(2);
    expect(result.colors.length).toBeGreaterThan(0);
  });

  it('colorCount=5 → default returns colors up to limit', async () => {
    const result = await extractPalette(makeInput({ colorCount: 5 }));
    expect(result.colors.length).toBeLessThanOrEqual(5);
    expect(result.colors.length).toBeGreaterThan(0);
  });

  it('imagePath is returned in result', async () => {
    const result = await extractPalette(makeInput());
    expect(result.imagePath).toBe(imagePath);
  });

  it('returns colorCount field in result', async () => {
    const result = await extractPalette(makeInput({ colorCount: 3 }));
    expect(result.colorCount).toBe(3);
  });

  it('dryRun=true → returns empty colors array without processing', async () => {
    const result = await extractPalette(makeInput({ dryRun: true }));
    expect(result.colors).toHaveLength(0);
    expect(result.dryRun).toBe(true);
  });
});
