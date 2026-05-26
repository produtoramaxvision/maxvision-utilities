import { describe, it, expect } from 'vitest';
import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  DownloadedAsset,
} from '../../../src/video/providers/base.js';
import type { Provider, VideoModelSpec } from '../../../src/core/models.js';

class MockProvider implements VideoProvider {
  readonly name: Provider = 'google';
  readonly models: VideoModelSpec[] = [];

  async generate(_req: VideoGenerationRequest): Promise<JobHandle> {
    return {
      jobId: 'mock-1',
      provider: 'google',
      model: 'mock',
      mode: 't2v',
      createdAt: new Date().toISOString(),
    };
  }

  async pollStatus(_jobId: string): Promise<JobStatus> {
    return { jobId: 'mock-1', state: 'completed', progress: 1 };
  }

  async download(_jobIdOrPath: string): Promise<DownloadedAsset> {
    return { buffer: Buffer.from('mock'), metadata: { contentType: 'video/mp4' } };
  }

  estimateCostUSD(_req: VideoGenerationRequest): number {
    return 0.01;
  }

  async recordActualCostUSD(_jobId: string, _usd: number): Promise<void> {
    // no-op
  }
}

describe('VideoProvider contract', () => {
  const provider = new MockProvider();

  it('exposes name + models', () => {
    expect(provider.name).toBe('google');
    expect(Array.isArray(provider.models)).toBe(true);
  });

  it('generate returns a JobHandle with required fields', async () => {
    const handle = await provider.generate({
      modelId: 'mock',
      mode: 't2v',
      prompt: 'test',
      durationSec: 4,
      resolution: '720p',
    });
    expect(handle.jobId).toBeTruthy();
    expect(handle.provider).toBe('google');
    expect(handle.createdAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('pollStatus returns a JobStatus with valid state', async () => {
    const status = await provider.pollStatus('mock-1');
    expect(['pending', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled']).toContain(
      status.state,
    );
  });

  it('estimateCostUSD returns a finite non-negative number', () => {
    const usd = provider.estimateCostUSD({
      modelId: 'mock',
      mode: 't2v',
      prompt: 'test',
      durationSec: 4,
      resolution: '720p',
    });
    expect(usd).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(usd)).toBe(true);
  });
});
