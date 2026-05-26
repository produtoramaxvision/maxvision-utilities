// Generates the binary fixtures used by tests/unit/refs/keyframe-extractor.test.ts.
// Run with: pnpm tsx scripts/generate-test-fixtures.ts
// Output is committed; this script exists so reviewers can regenerate fixtures
// without external assets.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const OUT = resolve('tests/unit/refs/fixtures');

async function frameRgb(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  // Build a 3-frame animated GIF (red, green, blue) via sharp's animated WebP first,
  // then fall back to a static GIF if animated GIF encoding is unavailable.
  // The keyframe-extractor uses ffmpeg-static which can decode either format.
  const frames = await Promise.all([
    frameRgb(255, 0, 0),
    frameRgb(0, 255, 0),
    frameRgb(0, 0, 255),
  ]);

  // Animated WebP (sharp supports this natively)
  const webp = await sharp(frames[0], { animated: true })
    .composite([])
    .webp({ effort: 0 })
    .toBuffer();
  await writeFile(resolve(OUT, 'tiny.webp'), webp);

  // Static GIF (single frame red — sufficient for "decode-and-emit-first-frame" test)
  const gif = await sharp(frames[0]).gif().toBuffer();
  await writeFile(resolve(OUT, 'tiny.gif'), gif);

  console.log(`Wrote fixtures to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
