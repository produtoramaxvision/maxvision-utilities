import { describe, it, expect } from 'vitest';
import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  DownloadedAsset,
  KlingExtras,
  ProviderExtras,
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

describe('P15 — KlingExtras union arm', () => {
  it('KlingExtras has providerKind: "kling" discriminator', () => {
    const extras: KlingExtras = { providerKind: 'kling' };
    expect(extras.providerKind).toBe('kling');
  });

  it('accepts motion-brush regions field', () => {
    const extras: KlingExtras = {
      providerKind: 'kling',
      motionBrushRegions: [
        { id: 'r1', polygon: [[0, 0], [100, 0], [100, 100], [0, 100]], motionVector: [10, 0] },
      ],
    };
    expect(extras.motionBrushRegions).toHaveLength(1);
  });

  it('accepts elementIds array (up to 4 refs)', () => {
    const extras: KlingExtras = {
      providerKind: 'kling',
      elementIds: ['elem-1', 'elem-2', 'elem-3', 'elem-4'],
    };
    expect(extras.elementIds).toHaveLength(4);
  });

  it('accepts lipSyncEmotion + lipSyncMode', () => {
    const extras: KlingExtras = {
      providerKind: 'kling',
      lipSync: { mode: 'text', text: 'hello world', emotion: 'happy' },
    };
    expect(extras.lipSync?.emotion).toBe('happy');
  });

  it('accepts omniMultiShot with per-shot index + duration', () => {
    const extras: KlingExtras = {
      providerKind: 'kling',
      omniMultiShot: {
        multiPrompt: [
          { index: 0, prompt: 'wide establishing shot', duration: 5 },
          { index: 1, prompt: 'close-up reaction', duration: 5 },
        ],
        imageList: [{ imageUrl: 'https://example/ref1.png' }],
      },
    };
    expect(extras.omniMultiShot?.multiPrompt).toHaveLength(2);
  });

  it('accepts watermarkEnabled boolean (default false for paid keys)', () => {
    const extras: KlingExtras = { providerKind: 'kling', watermarkEnabled: false };
    expect(extras.watermarkEnabled).toBe(false);
  });

  it('accepts characterOrientation for motion control', () => {
    const extras: KlingExtras = { providerKind: 'kling', characterOrientation: 'image' };
    expect(extras.characterOrientation).toBe('image');
  });

  it('ProviderExtras union now accepts a kling-shaped value (compile-time)', () => {
    const extras: ProviderExtras = { providerKind: 'kling' };
    expect(extras.providerKind).toBe('kling');
  });
});
