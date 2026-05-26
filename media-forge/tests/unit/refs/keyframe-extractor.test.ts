import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractKeyframesFromBuffer, normaliseToJpeg } from '../../../src/refs/keyframe-extractor.js';

const FIXTURES = resolve('tests/unit/refs/fixtures');

describe('keyframe-extractor', () => {
  it('extractKeyframesFromBuffer returns >=1 JPEG buffer for animated webp', async () => {
    const input = await readFile(resolve(FIXTURES, 'tiny.webp'));
    const frames = await extractKeyframesFromBuffer(input, { maxFrames: 3 });
    expect(frames.length).toBeGreaterThanOrEqual(1);
    for (const f of frames) {
      expect(f.subarray(0, 2).toString('hex')).toBe('ffd8'); // JPEG SOI marker
    }
  });

  it('extractKeyframesFromBuffer handles static gif (returns 1 frame)', async () => {
    const input = await readFile(resolve(FIXTURES, 'tiny.gif'));
    const frames = await extractKeyframesFromBuffer(input, { maxFrames: 3 });
    expect(frames.length).toBe(1);
    expect(frames[0].subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('normaliseToJpeg upscales below-minimum input to target size', async () => {
    const input = await readFile(resolve(FIXTURES, 'tiny.gif')); // 100×100
    const jpeg = await normaliseToJpeg(input, { minSide: 1024 });
    expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
    // Minimal sanity on size (1024×1024 jpeg is several KB even at q=70)
    expect(jpeg.length).toBeGreaterThan(2000);
  });
});
