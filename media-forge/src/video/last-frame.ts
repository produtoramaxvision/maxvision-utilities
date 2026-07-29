// src/video/last-frame.ts
// Extracts the last frame of a video as a still image.
//
// T9-d: media-forge already CONSUMES a last frame — lastFrameImagePath
// (base.ts), lastFrameImage (capabilities.ts), CLI `--last` — to chain one
// generated clip into the next (interpolate / i2v). Nothing PRODUCED one.
// This module closes that gap so the continuation workflow (generate clip 1,
// take its last frame, feed it as clip 2's first frame) never has to leave
// media-forge.
//
// ffmpeg invocation, verified empirically against real generated fixtures
// (see tests/unit/video/last-frame.test.ts):
//
//   fast path:  -y -sseof -3 -i <video> -update 1 [-q:v 2] <out>
//   fallback:   -y         -i <video> -update 1 [-q:v 2] <out>
//
// `-sseof -3` seeks to 3s before end-of-file; `-update 1` tells the image2
// muxer to keep overwriting the SAME output file for every frame it decodes
// from the seek point onward. Whatever is left on disk when ffmpeg exits is
// therefore the true LAST frame, not the first frame at the seek point. When
// the seek offset exceeds the video's total duration, ffmpeg clamps the seek
// to the start of the file — confirmed against a 0.2s single-frame fixture —
// so the fast path also covers clips shorter than 3s without extra branching.
//
// Failure mode found empirically: if the seek target lands inside the
// timespan of what would be the final decodable frame (reproduced with a
// single-frame video whose one frame spans 10s and a 3s end-seek — the
// target lands 7s into that frame's own span), ffmpeg's mjpeg/image2 encoder
// cannot initialize ("Error while opening encoder", "Could not open encoder
// before EOF") and exits non-zero with no output file. We detect that (the
// primary attempt throws, or the expected output file never appears) and
// fall back to a full decode with NO seek at all — walking every frame from
// t=0 is immune to the seek-window edge case and reliably yields the last
// frame at the cost of decoding the whole file.
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat, copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname, basename, extname } from 'node:path';
import { resolveFfmpegPath } from '../core/ffmpeg.js';
import { ensureDir } from '../utils/files.js';
import { mimeFromExt, isVideoMime } from '../utils/mime.js';
import { FileSystemError, ValidationError } from '../core/errors.js';

const execFileP = promisify(execFile);

export interface ExtractLastFrameOpts {
  readonly videoPath: string;
  readonly outputPath?: string;
  readonly format?: 'jpg' | 'png';
}

export interface LastFrameResult {
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
}

// Seek margin for the fast path, in whole seconds. Chosen far larger than the
// frame period of any realistic media-forge output (Veo/Kling/Higgsfield/
// Seedance clips all run at standard fps, i.e. frame periods well under 1s),
// so the seek target never lands inside the final frame's own span — the one
// condition that reproducibly breaks the mjpeg/image2 encoder (see module
// doc above). Pathological containers that DO trigger it fall through to the
// full-decode fallback below.
const SEEK_FROM_END_SEC = '3';

function jpegQualityArgs(format: 'jpg' | 'png'): string[] {
  return format === 'jpg' ? ['-q:v', '2'] : [];
}

interface FfmpegAttempt {
  readonly ok: boolean;
  readonly stderr?: string;
}

async function runFfmpeg(ffmpegPath: string, args: string[], outFile: string): Promise<FfmpegAttempt> {
  try {
    await execFileP(ffmpegPath, args);
  } catch (err) {
    const stderr = typeof (err as { stderr?: unknown }).stderr === 'string'
      ? (err as { stderr: string }).stderr
      : undefined;
    return { ok: false, stderr };
  }
  return { ok: existsSync(outFile) };
}

/**
 * Extracts the last frame of `opts.videoPath` and writes it as a still image.
 *
 * Throws FileSystemError if the video does not exist, ValidationError if the
 * path is not a recognized video file (or ffmpeg cannot decode it at all),
 * and FfmpegNotFoundError (from core/ffmpeg.ts) if no usable ffmpeg binary is
 * available — the same error every other ffmpeg-backed tool in this codebase
 * surfaces, never a second bespoke type.
 */
export async function extractLastFrame(opts: ExtractLastFrameOpts): Promise<LastFrameResult> {
  const format = opts.format ?? 'jpg';

  // Resolve ffmpeg first — mirrors src/refs/keyframe-extractor.ts, which
  // resolves the binary before touching the filesystem for anything else.
  const ffmpegPath = resolveFfmpegPath();

  if (!existsSync(opts.videoPath)) {
    throw new FileSystemError(`Video not found: ${opts.videoPath}`, {
      videoPath: opts.videoPath,
    });
  }

  let mime: string;
  try {
    mime = mimeFromExt(opts.videoPath);
  } catch {
    throw new ValidationError(
      `Not a video file (unrecognized extension): ${opts.videoPath}`,
      { videoPath: opts.videoPath },
    );
  }
  if (!isVideoMime(mime)) {
    throw new ValidationError(
      `Not a video file (detected ${mime}): ${opts.videoPath}`,
      { videoPath: opts.videoPath, detectedMime: mime },
    );
  }

  const outputPath =
    opts.outputPath ??
    join(
      dirname(opts.videoPath),
      `${basename(opts.videoPath, extname(opts.videoPath))}.last-frame.${format}`,
    );

  const tmpDir = await mkdtemp(join(tmpdir(), 'mf-lastframe-'));
  try {
    const tmpOut = join(tmpDir, `last.${format}`);

    const fastArgs = [
      '-y',
      '-sseof', `-${SEEK_FROM_END_SEC}`,
      '-i', opts.videoPath,
      '-update', '1',
      ...jpegQualityArgs(format),
      tmpOut,
    ];
    let attempt = await runFfmpeg(ffmpegPath, fastArgs, tmpOut);

    if (!attempt.ok) {
      // Fallback: full decode, no seek at all. Slower on long videos but
      // immune to the seek-window edge case that can make the fast path fail
      // on pathological (very-low-effective-framerate) containers.
      const fullArgs = [
        '-y',
        '-i', opts.videoPath,
        '-update', '1',
        ...jpegQualityArgs(format),
        tmpOut,
      ];
      attempt = await runFfmpeg(ffmpegPath, fullArgs, tmpOut);
    }

    if (!attempt.ok) {
      const stderrTail = attempt.stderr
        ? ` ffmpeg said: ${attempt.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`
        : '';
      throw new ValidationError(
        `Could not extract last frame from ${opts.videoPath}: ffmpeg failed on both the ` +
          'fast-seek and full-decode attempts. The file is likely not a valid or decodable video.' +
          stderrTail,
        { videoPath: opts.videoPath, ffmpegStderr: attempt.stderr },
      );
    }

    const meta = await sharp(tmpOut).metadata();
    const st = await stat(tmpOut);

    ensureDir(dirname(outputPath));
    await copyFile(tmpOut, outputPath);

    return {
      outputPath,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      sizeBytes: st.size,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
