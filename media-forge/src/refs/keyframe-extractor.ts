// src/refs/keyframe-extractor.ts
// Decode animated gif/webp into individual JPEG keyframes.
// Sharp natively decodes both animated formats via `pages: -1`. We fall back to
// a resolved system/LGPL ffmpeg only if sharp returns a single frame for an
// animated input (rare, but possible with exotic encodings).
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveFfmpegPath } from '../core/ffmpeg.js';

const execFileP = promisify(execFile);

export interface ExtractOpts {
  maxFrames: number;
}

export interface NormaliseOpts {
  minSide: number; // Veo requires >=1024px shortest side
}

export async function extractKeyframesFromBuffer(input: Buffer, opts: ExtractOpts): Promise<Buffer[]> {
  // Sharp can iterate animated frames via metadata().pages
  const meta = await sharp(input, { animated: true }).metadata();
  const pageCount = meta.pages ?? 1;

  if (pageCount === 1) {
    const jpeg = await sharp(input).jpeg({ quality: 88 }).toBuffer();
    return [jpeg];
  }

  // Pick up to maxFrames evenly across pages
  const step = Math.max(1, Math.floor(pageCount / opts.maxFrames));
  const indices: number[] = [];
  for (let i = 0; i < pageCount && indices.length < opts.maxFrames; i += step) {
    indices.push(i);
  }

  const frames: Buffer[] = [];
  for (const idx of indices) {
    try {
      const jpeg = await sharp(input, { page: idx }).jpeg({ quality: 88 }).toBuffer();
      frames.push(jpeg);
    } catch {
      // Sharp page-indexing failed; fall back to system ffmpeg for this file
      return extractKeyframesViaFfmpeg(input, opts);
    }
  }
  return frames.length > 0 ? frames : extractKeyframesViaFfmpeg(input, opts);
}

async function extractKeyframesViaFfmpeg(input: Buffer, opts: ExtractOpts): Promise<Buffer[]> {
  const ffmpegPath = resolveFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), 'mf-refs-'));
  try {
    const inFile = join(dir, 'in.bin');
    await writeFile(inFile, input);
    // Scene-detect: pick frames where scene change > 0.4
    await execFileP(ffmpegPath, [
      '-y',
      '-i', inFile,
      '-vf', `select='gt(scene\\,0.4)',scale='if(gt(iw,ih),-2,1024)':'if(gt(iw,ih),1024,-2)'`,
      '-vsync', 'vfr',
      '-q:v', '3',
      join(dir, 'frame_%03d.jpg'),
    ]);
    const files = (await readdir(dir)).filter((f) => f.startsWith('frame_')).sort();
    const picked = files.slice(0, opts.maxFrames);
    const out: Buffer[] = [];
    for (const f of picked) out.push(await readFile(join(dir, f)));
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function normaliseToJpeg(input: Buffer, opts: NormaliseOpts): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const minSide = Math.min(meta.width ?? 0, meta.height ?? 0);
  if (minSide >= opts.minSide) {
    return sharp(input).jpeg({ quality: 88 }).toBuffer();
  }
  // Upscale shortest side to minSide while preserving aspect ratio
  const scale = opts.minSide / Math.max(1, minSide);
  const newW = Math.round((meta.width ?? opts.minSide) * scale);
  const newH = Math.round((meta.height ?? opts.minSide) * scale);
  return sharp(input).resize(newW, newH, { kernel: 'lanczos3' }).jpeg({ quality: 88 }).toBuffer();
}
