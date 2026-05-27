import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HiggsfieldProvider } from '../../src/video/providers/higgsfield.js';

/**
 * P14 Higgsfield live smoke test. Gated by:
 *   - HF_API_KEY + HF_API_SECRET set
 *   - MEDIA_FORGE_RUN_LIVE_TESTS=true
 *
 * Generates a real 4-second Soul standard video, polls until completion or 5min timeout,
 * downloads the first asset, and asserts it is a non-empty MP4 buffer.
 *
 * Expected cost: ~25 credits ≈ $0.975 on Plus plan.
 */
const SHOULD_RUN =
  process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true' &&
  typeof process.env['HF_API_KEY'] === 'string' &&
  process.env['HF_API_KEY'].length > 0 &&
  typeof process.env['HF_API_SECRET'] === 'string' &&
  process.env['HF_API_SECRET'].length > 0;

const describeIfLive = SHOULD_RUN ? describe : describe.skip;

describeIfLive('Higgsfield live E2E', () => {
  it('generates → polls → downloads a Soul standard video', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-e2e-'));
    const dbPath = join(tmpDir, 'cost.db');
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] ??= '0.039';

    try {
      const provider = new HiggsfieldProvider({ dbPath });

      const handle = await provider.generate({
        modelId: 'higgsfield-soul-standard',
        mode: 't2v',
        prompt: 'a quiet mountain lake at sunrise, mist rising, gentle breeze',
        durationSec: 4,
        resolution: '720p',
        aspectRatio: '16:9',
      });
      expect(handle.providerNativeId).toBeTruthy();

      const deadline = Date.now() + 5 * 60_000;
      let final;
      while (true) {
        if (Date.now() > deadline) throw new Error('Higgsfield live test timed out (5min)');
        const status = await provider.pollStatus(handle.jobId);
        if (status.state === 'completed') {
          final = status;
          break;
        }
        if (status.state === 'failed' || status.state === 'nsfw' || status.state === 'canceled') {
          throw new Error(`Higgsfield live test terminated state=${status.state} err=${status.errorMessage ?? ''}`);
        }
        await new Promise((r) => setTimeout(r, 5000));
      }

      expect(final.assetUrls && final.assetUrls.length).toBeGreaterThan(0);
      const url = final.assetUrls![0]!;
      const asset = await provider.download(url);
      expect(asset.buffer.length).toBeGreaterThan(1000);
      expect(asset.metadata.contentType).toMatch(/^video\//);

      // Persist a copy for human inspection if needed.
      const out = join(tmpDir, 'live-soul.mp4');
      writeFileSync(out, asset.buffer);
      // eslint-disable-next-line no-console
      console.log('[live-smoke] saved', out, asset.buffer.length, 'bytes');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 6 * 60_000);
});
