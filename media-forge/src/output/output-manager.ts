import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeJoin, jobId as generateJobId } from '../utils/paths.js';
import { sanitizePayload } from '../core/sanitize.js';
import { appendCostLogEntry } from '../core/cost.js';
import { logger } from '../core/logger.js';

export interface CreateJobOpts {
  project?: string;
  name?: string;
}

export interface JobHandle {
  jobId: string;
  jobDir: string;
}

export interface SaveAssetOpts {
  jobId: string;
  version: string;
  kind: 'image' | 'video' | 'audio' | 'json' | 'binary';
  bytes: Buffer;
  mime: string;
  filename?: string;
}

export interface SavedAsset {
  path: string;
  filename: string;
  bytes: number;
  mime: string;
}

export interface SaveMetadataOpts {
  jobId: string;
  version: string;
  metadata: Record<string, unknown>;
}

export interface SavePayloadOpts {
  jobId: string;
  version: string;
  payload: unknown;
}

export interface SavePromptOpts {
  jobId: string;
  version: string;
  prompt: string;
}

export interface WriteSummaryOpts {
  jobId: string;
  finalVersion: string;
  brief: string;
  finalAssetPath: string;
  totalCostUsd: number;
}

export interface MarkFinalOpts {
  jobId: string;
  version: string;
}

export interface AppendCostLogOpts {
  jobId: string;
  model: string;
  usd: number;
  breakdown?: Record<string, number>;
}

// Inline mime → extension map for saveAsset
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'application/json': '.json',
  'application/octet-stream': '.bin',
};

function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? '.bin';
}

export class OutputManager {
  private readonly baseDir: string;

  constructor(opts: { baseDir?: string } = {}) {
    this.baseDir = path.resolve(opts.baseDir ?? './outputs');
  }

  resolveJobDir(jobId: string): string {
    return safeJoin(this.baseDir, 'jobs', jobId);
  }

  resolveVersionDir(jobId: string, version: string): string {
    return safeJoin(this.resolveJobDir(jobId), version);
  }

  async createJob(opts: CreateJobOpts): Promise<JobHandle> {
    const id = generateJobId(opts.name);
    const jobDir = this.resolveJobDir(id);
    await fs.promises.mkdir(jobDir, { recursive: true });

    const marker = {
      project: opts.project,
      name: opts.name,
      createdAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      path.join(jobDir, '.media-forge-job.json'),
      JSON.stringify(marker, null, 2),
    );

    logger.debug('OutputManager: job created', { jobId: id, jobDir });
    return { jobId: id, jobDir };
  }

  async nextVersion(opts: { jobId: string }): Promise<string> {
    const jobDir = this.resolveJobDir(opts.jobId);

    // Retry loop to be concurrency-safe: attempt mkdir without recursive, retry on EEXIST
    const MAX_RETRIES = 20;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let maxV = 0;
      try {
        const entries = await fs.promises.readdir(jobDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && /^v\d+$/.test(entry.name)) {
            const n = parseInt(entry.name.slice(1), 10);
            if (n > maxV) maxV = n;
          }
        }
      } catch {
        // jobDir may not exist yet — treat as empty
      }

      const nextV = `v${maxV + 1}`;
      const versionDir = safeJoin(jobDir, nextV);

      try {
        // Use non-recursive mkdir to detect collisions atomically
        await fs.promises.mkdir(versionDir);
        logger.debug('OutputManager: version created', { jobId: opts.jobId, version: nextV });
        return nextV;
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'EEXIST') {
          // Another concurrent call took this version — retry
          continue;
        }
        if (nodeErr.code === 'ENOENT') {
          // jobDir doesn't exist yet, create it first
          await fs.promises.mkdir(jobDir, { recursive: true });
          continue;
        }
        throw err;
      }
    }

    throw new Error(`OutputManager.nextVersion: exceeded ${MAX_RETRIES} retries for job ${opts.jobId}`);
  }

  async saveAsset(opts: SaveAssetOpts): Promise<SavedAsset> {
    const versionDir = this.resolveVersionDir(opts.jobId, opts.version);
    const ext = extFromMime(opts.mime);
    const filename = opts.filename ?? `asset${ext}`;
    const filePath = safeJoin(versionDir, filename);

    await fs.promises.mkdir(versionDir, { recursive: true });
    await fs.promises.writeFile(filePath, opts.bytes);

    logger.debug('OutputManager: asset saved', { jobId: opts.jobId, version: opts.version, filename, bytes: opts.bytes.length });

    return {
      path: filePath,
      filename,
      bytes: opts.bytes.length,
      mime: opts.mime,
    };
  }

  async saveMetadata(opts: SaveMetadataOpts): Promise<void> {
    const versionDir = this.resolveVersionDir(opts.jobId, opts.version);
    await fs.promises.mkdir(versionDir, { recursive: true });
    const filePath = path.join(versionDir, 'metadata.json');
    await fs.promises.writeFile(filePath, JSON.stringify(opts.metadata, null, 2), 'utf8');
    logger.debug('OutputManager: metadata saved', { jobId: opts.jobId, version: opts.version });
  }

  async savePayload(opts: SavePayloadOpts): Promise<void> {
    const versionDir = this.resolveVersionDir(opts.jobId, opts.version);
    await fs.promises.mkdir(versionDir, { recursive: true });
    const sanitized = sanitizePayload(opts.payload);
    const filePath = path.join(versionDir, 'payload.json');
    await fs.promises.writeFile(filePath, JSON.stringify(sanitized, null, 2), 'utf8');
    logger.debug('OutputManager: payload saved (sanitized)', { jobId: opts.jobId, version: opts.version });
  }

  async savePrompt(opts: SavePromptOpts): Promise<void> {
    const versionDir = this.resolveVersionDir(opts.jobId, opts.version);
    await fs.promises.mkdir(versionDir, { recursive: true });
    const filePath = path.join(versionDir, 'prompt.txt');
    const text = opts.prompt.endsWith('\n') ? opts.prompt : opts.prompt + '\n';
    await fs.promises.writeFile(filePath, text, 'utf8');
    logger.debug('OutputManager: prompt saved', { jobId: opts.jobId, version: opts.version });
  }

  async writeSummary(opts: WriteSummaryOpts): Promise<void> {
    const jobDir = this.resolveJobDir(opts.jobId);
    const relFinalAsset = path.relative(jobDir, opts.finalAssetPath);
    const usdStr = opts.totalCostUsd.toFixed(4);
    const now = new Date().toISOString();

    const markdown = [
      `# Job ${opts.jobId}`,
      '',
      `**Final version:** ${opts.finalVersion}`,
      `**Final asset:** ${relFinalAsset}`,
      `**Total cost:** $${usdStr} USD`,
      '',
      '## Brief',
      '',
      opts.brief,
      '',
      '---',
      '',
      `_Generated ${now}_`,
      '',
    ].join('\n');

    const summaryPath = path.join(jobDir, 'SUMMARY.md');
    await fs.promises.writeFile(summaryPath, markdown, 'utf8');
    logger.debug('OutputManager: SUMMARY.md written', { jobId: opts.jobId });
  }

  async markFinal(opts: MarkFinalOpts): Promise<{ finalDir: string; copies: string[] }> {
    const jobDir = this.resolveJobDir(opts.jobId);
    const versionDir = this.resolveVersionDir(opts.jobId, opts.version);
    const finalDir = safeJoin(jobDir, 'final');

    // Replace existing final/ directory
    await fs.promises.rm(finalDir, { recursive: true, force: true });
    await fs.promises.mkdir(finalDir, { recursive: true });

    // Copy all files from versionDir to finalDir
    await fs.promises.cp(versionDir, finalDir, { recursive: true });

    // Collect copied file paths
    const entries = await fs.promises.readdir(finalDir, { withFileTypes: true });
    const copies: string[] = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        copies.push(path.join(finalDir, entry.name));
      }
    }

    logger.debug('OutputManager: markFinal completed', { jobId: opts.jobId, version: opts.version, copies: copies.length });
    return { finalDir, copies };
  }

  async appendCostLog(opts: AppendCostLogOpts): Promise<void> {
    const jobDir = this.resolveJobDir(opts.jobId);
    const logPath = path.join(jobDir, 'cost.jsonl');

    // Serialize breakdown Record<string, number> → string for the cost helper
    const breakdownStr = opts.breakdown
      ? JSON.stringify(opts.breakdown)
      : `${opts.model}: $${opts.usd}`;

    appendCostLogEntry(logPath, {
      model: opts.model,
      usd: opts.usd,
      breakdown: breakdownStr,
    });

    logger.debug('OutputManager: cost log appended', { jobId: opts.jobId, model: opts.model, usd: opts.usd });
  }
}
