import * as nodeCrypto from 'node:crypto';
import * as nodeFs from 'node:fs/promises';
import { ApiError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { MediaForgeClient } from '../core/client.js';
import { safeJoin } from '../utils/paths.js';
import { ensureDir } from '../utils/files.js';

export interface DownloadResult {
  outputPath: string;
  bytes: number;
  sha256: string;
}

export interface DownloadOpts {
  client: MediaForgeClient;
  videoUri: string;
  apiKey?: string;
  outputDir: string;
  filename?: string;
  createTime?: string;
  fetchImpl?: typeof fetch;
}

export async function downloadVideo(opts: DownloadOpts): Promise<DownloadResult> {
  const filename = opts.filename ?? 'video.mp4';
  const outputPath = safeJoin(opts.outputDir, filename);
  await ensureDir(opts.outputDir);

  if (opts.createTime) {
    const ageHours = (Date.now() - new Date(opts.createTime).getTime()) / 3_600_000;
    if (ageHours > 36) {
      logger.warn('Veo asset >36h old; 2-day TTL nearing expiration', {
        ageHours,
        videoUri: opts.videoUri.slice(0, 60),
      });
    }
  }

  const url = opts.apiKey ? `${opts.videoUri}&key=${opts.apiKey}` : opts.videoUri;
  const fetchFn = opts.fetchImpl ?? fetch;
  const resp = await fetchFn(url);
  if (!resp.ok) {
    throw new ApiError(`Video download failed: ${resp.status} ${resp.statusText}`, 'API');
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  await nodeFs.writeFile(outputPath, buf);

  const sha256 = nodeCrypto.createHash('sha256').update(buf).digest('hex');

  logger.info('Video downloaded', { outputPath, bytes: buf.length });

  return { outputPath, bytes: buf.length, sha256 };
}
