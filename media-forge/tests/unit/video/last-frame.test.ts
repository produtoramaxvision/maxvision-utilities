// T9-d: last-frame extraction. Fixtures are generated at test time with real
// ffmpeg (no committed binary fixtures) -- see beforeAll below for why each
// clip is shaped the way it is.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { resolveFfmpegPath } from '../../../src/core/ffmpeg.js';
import { extractLastFrame } from '../../../src/video/last-frame.js';
import { FileSystemError, ValidationError } from '../../../src/core/errors.js';

const execFileP = promisify(execFile);

let fixturesDir: string;
let threeColorVideo: string;
let pathologicalVideo: string;
let ffmpegPath: string;

async function ffmpegRun(args: string[]): Promise<void> {
  await execFileP(ffmpegPath, args);
}

beforeAll(async () => {
  ffmpegPath = resolveFfmpegPath();
  fixturesDir = await mkdtemp(join(tmpdir(), 'mf-lastframe-fixtures-'));

  // Three one-second solid-color segments (red -> green -> blue) at 5fps,
  // 320x240, concatenated. Ground truth: the LAST frame must be blue. This is
  // what the "really is the last frame" assertion below checks -- a test that
  // only asserted "a file appeared" would pass even if extractLastFrame
  // silently returned the FIRST frame instead.
  threeColorVideo = join(fixturesDir, 'three-color.mp4');
  await ffmpegRun([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1:r=5',
    '-f', 'lavfi', '-i', 'color=c=green:s=320x240:d=1:r=5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=5',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[outv]',
    '-map', '[outv]',
    '-pix_fmt', 'yuv420p',
    threeColorVideo,
  ]);

  // Pathological single-frame video: one yellow frame nominally spanning 10s
  // (r=0.1 fps). extractLastFrame's fast path seeks 3s before EOF -- for this
  // file that lands 7s INSIDE the one and only frame's own span, which
  // reproducibly breaks ffmpeg's mjpeg/image2 encoder ("Error while opening
  // encoder... Could not open encoder before EOF", exit code non-zero,
  // zero-byte/no output file). This is the concrete "clip too short for the
  // end-seek window" case the fallback (full decode, no seek) exists for.
  pathologicalVideo = join(fixturesDir, 'pathological.mp4');
  await ffmpegRun([
    '-y',
    '-f', 'lavfi', '-i', 'color=c=yellow:s=320x240:d=10:r=0.1',
    '-pix_fmt', 'yuv420p',
    pathologicalVideo,
  ]);
}, 30_000);

afterAll(async () => {
  if (fixturesDir) {
    await rm(fixturesDir, { recursive: true, force: true });
  }
});

// Each test that needs its own default-named output gets a private copy of
// the shared fixture video, so concurrent/back-to-back tests never write to
// the same derived destination path (observed to be flaky under Windows
// Defender's on-write scan when two tests raced on one shared filename).
async function freshCopyOf(sourceVideo: string, copyName: string): Promise<string> {
  const dest = join(fixturesDir, copyName);
  await copyFile(sourceVideo, dest);
  return dest;
}

describe('extractLastFrame', () => {
  it('extracts a valid image with the source video dimensions', async () => {
    const video = await freshCopyOf(threeColorVideo, 'for-dimensions.mp4');
    const result = await extractLastFrame({ videoPath: video });
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(result.outputPath)).toBe(true);
  });

  it('really extracts the LAST frame -- pixel color proves blue, not red or green', async () => {
    const video = await freshCopyOf(threeColorVideo, 'for-pixel-check.mp4');
    const result = await extractLastFrame({ videoPath: video });
    const stats = await sharp(result.outputPath).stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(50);
    expect(g).toBeLessThan(50);
  });

  it('defaults the output path alongside the source video', async () => {
    const video = await freshCopyOf(threeColorVideo, 'for-default-path.mp4');
    const result = await extractLastFrame({ videoPath: video });
    expect(result.outputPath).toBe(join(fixturesDir, 'for-default-path.last-frame.jpg'));
  });

  it('honors an explicit output path, creating missing parent directories', async () => {
    const video = await freshCopyOf(threeColorVideo, 'for-explicit-path.mp4');
    const customPath = join(fixturesDir, 'nested', 'deep', 'frame.jpg');
    const result = await extractLastFrame({
      videoPath: video,
      outputPath: customPath,
    });
    expect(result.outputPath).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);
  });

  it('supports png format', async () => {
    const video = await freshCopyOf(threeColorVideo, 'for-png.mp4');
    const result = await extractLastFrame({ videoPath: video, format: 'png' });
    expect(result.outputPath.endsWith('.png')).toBe(true);
    const meta = await sharp(result.outputPath).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
  });

  it('falls back to full decode when the clip is too short for the end-seek window, and still returns the (only) last frame', async () => {
    const result = await extractLastFrame({
      videoPath: pathologicalVideo,
      outputPath: join(fixturesDir, 'pathological-out.jpg'),
    });
    const stats = await sharp(result.outputPath).stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    // yellow = high R, high G, low B
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeLessThan(50);
  });

  it('throws FileSystemError (actionable, not a crash) for a missing video', async () => {
    const missing = join(fixturesDir, 'does-not-exist.mp4');
    await expect(extractLastFrame({ videoPath: missing })).rejects.toThrow(FileSystemError);
  });

  it('throws ValidationError for an unrecognized (non-video) extension', async () => {
    const notVideo = join(fixturesDir, 'notes.txt');
    await writeFile(notVideo, 'just some text, not a video');
    await expect(extractLastFrame({ videoPath: notVideo })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for a video-extension file ffmpeg cannot decode', async () => {
    const garbage = join(fixturesDir, 'garbage.mp4');
    await writeFile(garbage, 'not a real video file, just bytes with a .mp4 name');
    await expect(extractLastFrame({ videoPath: garbage })).rejects.toThrow(ValidationError);
  });
});
