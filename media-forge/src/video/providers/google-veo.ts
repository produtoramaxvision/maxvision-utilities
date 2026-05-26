import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  DownloadedAsset,
} from './base.js';
import {
  VIDEO_MODELS,
  VIDEO_MODEL_VEO_3_1_PRO,
  type Provider,
  type VideoModelSpec,
} from '../../core/models.js';
import { recordJob, recordActualCost } from '../../core/cost-tracker.js';

export interface GoogleVeoProviderOptions {
  readonly dbPath: string;
}

export class GoogleVeoProvider implements VideoProvider {
  readonly name: Provider = 'google';
  readonly models: VideoModelSpec[];
  private readonly dbPath: string;

  constructor(opts: GoogleVeoProviderOptions) {
    this.dbPath = opts.dbPath;
    const veoSpec = VIDEO_MODELS[VIDEO_MODEL_VEO_3_1_PRO];
    if (!veoSpec) {
      throw new Error(
        `GoogleVeoProvider: VIDEO_MODELS missing entry for ${VIDEO_MODEL_VEO_3_1_PRO}`,
      );
    }
    this.models = [veoSpec];
  }

  async generate(req: VideoGenerationRequest): Promise<JobHandle> {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'google') {
      throw new Error(`model ${req.modelId} is not a google provider model`);
    }
    const jobId = `veo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const estUsd = this.estimateCostUSD(req);
    recordJob({
      dbPath: this.dbPath,
      jobId,
      provider: 'google',
      model: req.modelId,
      mode: req.mode,
      paramsHash: hashParams(req),
      estUsd,
    });
    return {
      jobId,
      provider: 'google',
      model: req.modelId,
      mode: req.mode,
      createdAt: new Date().toISOString(),
    };
  }

  async pollStatus(jobId: string): Promise<JobStatus> {
    return { jobId, state: 'pending' };
  }

  async download(jobIdOrPath: string): Promise<DownloadedAsset> {
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(jobIdOrPath);
    return {
      buffer,
      metadata: {
        contentType: 'video/mp4',
        sizeBytes: buffer.length,
      },
    };
  }

  estimateCostUSD(req: VideoGenerationRequest): number {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.pricing.unit !== 'usd-per-second') {
      throw new Error(`Veo pricing unit expected usd-per-second, got ${spec.pricing.unit}`);
    }
    return spec.pricing.rate * req.durationSec;
  }

  async recordActualCostUSD(jobId: string, usd: number): Promise<void> {
    recordActualCost({ dbPath: this.dbPath, jobId, actualUsd: usd });
  }
}

function hashParams(req: VideoGenerationRequest): string {
  const json = JSON.stringify({
    modelId: req.modelId,
    mode: req.mode,
    prompt: req.prompt,
    durationSec: req.durationSec,
    resolution: req.resolution,
    aspectRatio: req.aspectRatio,
    fps: req.fps,
  });
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}
