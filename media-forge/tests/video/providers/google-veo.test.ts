import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleVeoProvider } from '../../../src/video/providers/google-veo.js';
import { VIDEO_MODEL_VEO_3_1_PRO } from '../../../src/core/models.js';

describe('GoogleVeoProvider adapter', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: GoogleVeoProvider;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-veo-test-'));
    dbPath = join(tmpDir, 'cost.db');
    provider = new GoogleVeoProvider({ dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports name = google', () => {
    expect(provider.name).toBe('google');
  });

  it('lists only the Veo 3.1 model', () => {
    expect(provider.models.map((m) => m.id)).toEqual([VIDEO_MODEL_VEO_3_1_PRO]);
  });

  it('estimateCostUSD returns ~$2.00 for 4s @ 720p (rate $0.50/s)', () => {
    const usd = provider.estimateCostUSD({
      modelId: VIDEO_MODEL_VEO_3_1_PRO,
      mode: 't2v',
      prompt: 'test',
      durationSec: 4,
      resolution: '720p',
    });
    expect(usd).toBeCloseTo(2.0, 2);
  });

  it('estimateCostUSD scales linearly with duration', () => {
    const four = provider.estimateCostUSD({
      modelId: VIDEO_MODEL_VEO_3_1_PRO,
      mode: 't2v',
      prompt: 'x',
      durationSec: 4,
      resolution: '720p',
    });
    const eight = provider.estimateCostUSD({
      modelId: VIDEO_MODEL_VEO_3_1_PRO,
      mode: 't2v',
      prompt: 'x',
      durationSec: 8,
      resolution: '720p',
    });
    expect(eight).toBeCloseTo(four * 2, 2);
  });

  it('estimateCostUSD throws on unknown modelId', () => {
    expect(() =>
      provider.estimateCostUSD({
        modelId: 'unknown-model',
        mode: 't2v',
        prompt: 'x',
        durationSec: 4,
        resolution: '720p',
      }),
    ).toThrow(/unknown model/i);
  });
});

describe('GoogleVeoProvider.download', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: GoogleVeoProvider;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-veo-dl-test-'));
    dbPath = join(tmpDir, 'cost.db');
    provider = new GoogleVeoProvider({ dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns buffer + contentType + sizeBytes for a local file path', async () => {
    const fakeMp4Path = join(tmpDir, 'fake.mp4');
    writeFileSync(fakeMp4Path, 'FAKEMP4');
    expect(existsSync(fakeMp4Path)).toBe(true);

    const asset = await provider.download(fakeMp4Path);

    expect(asset.buffer.toString()).toBe('FAKEMP4');
    expect(asset.metadata.contentType).toBe('video/mp4');
    expect(asset.metadata.sizeBytes).toBe(7);
  });
});
