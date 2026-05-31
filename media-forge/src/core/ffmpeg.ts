// Resolves a usable ffmpeg binary at runtime. We only ever DECODE input and
// ENCODE to JPEG (mjpeg) — operations available in any LGPL/system ffmpeg —
// so we deliberately avoid bundling the GPL ffmpeg-static binary.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export class FfmpegNotFoundError extends Error {
  constructor() {
    super(
      'ffmpeg not found. Install ffmpeg and ensure it is on PATH, or set ' +
        'MEDIA_FORGE_FFMPEG_PATH to the binary. ' +
        'Windows: winget install Gyan.FFmpeg | macOS: brew install ffmpeg | ' +
        'Debian/Ubuntu: apt-get install ffmpeg',
    );
    this.name = 'FfmpegNotFoundError';
  }
}

let cached: string | undefined;

export function __resetFfmpegCache(): void {
  cached = undefined;
}

export function resolveFfmpegPathOrNull(env: NodeJS.ProcessEnv = process.env): string | null {
  if (cached) return cached;

  const override = env['MEDIA_FORGE_FFMPEG_PATH'];
  if (override && existsSync(override)) {
    cached = override;
    return override;
  }

  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, ['ffmpeg'], { encoding: 'utf8' });
  if (r.status === 0 && typeof r.stdout === 'string') {
    const found = r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0 && existsSync(s));
    if (found) {
      cached = found;
      return found;
    }
  }
  return null;
}

export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  const p = resolveFfmpegPathOrNull(env);
  if (!p) throw new FfmpegNotFoundError();
  return p;
}
