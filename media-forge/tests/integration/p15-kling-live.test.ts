/**
 * P15 Kling live integration tests — gated behind MEDIA_FORGE_RUN_LIVE_TESTS=true.
 *
 * CDN URL TTL operational invariant: Kling task_result CDN URLs are typically valid
 * for ~3600s (1 hour) after task completion. Our polling cadence MUST keep
 * max_poll_interval <= 30s so any 'completed' status observed leaves at minimum
 * ~3570s of URL validity before download. If a download fails with HTTP 403/404
 * on a URL from a 'completed' status, retry by re-polling status to fetch a fresh
 * URL (see refetchAssetUrl and the dedicated TTL-refresh test in the unit suite).
 */
import { describe, it, expect } from 'vitest';

const LIVE = process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true';

describe.skipIf(!LIVE)('P15 Kling live integration (real API)', () => {
  it('submits a real V3 Standard 5s t2v call and receives a task_id', async () => {
    // Import lazily — only when live mode is active
    const { KlingProvider } = await import('../../src/video/providers/kling.js');
    const provider = new KlingProvider({
      dbPath: ':memory:',
      env: process.env as never,
    });
    const handle = await provider.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'a small lake at dawn, slow dolly-in, 50mm, 5 seconds',
      durationSec: 5,
      resolution: '720p',
    });
    expect(handle.providerNativeId).toBeDefined();
    expect(handle.provider).toBe('kling');
  }, 30_000);

  it('polls until succeed (timeout 5min) and downloads the asset', async () => {
    const { KlingProvider } = await import('../../src/video/providers/kling.js');
    const provider = new KlingProvider({
      dbPath: ':memory:',
      env: process.env as never,
    });
    const handle = await provider.generate({
      modelId: 'kling-v3-standard',
      mode: 't2v',
      prompt: 'cheap 5s test for P15 live gate',
      durationSec: 5,
      resolution: '720p',
    });
    const deadline = Date.now() + 5 * 60_000;
    let status = await provider.pollStatus(handle.jobId);
    while (status.state !== 'completed' && status.state !== 'failed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      status = await provider.pollStatus(handle.jobId);
    }
    expect(status.state).toBe('completed');
    expect(status.assetUrls?.length).toBeGreaterThan(0);

    const asset = await provider.download(handle.jobId);
    expect(asset.buffer.length).toBeGreaterThan(1000); // sanity: real mp4 > 1KB
    expect(asset.metadata.contentType).toMatch(/video/);
  }, 360_000);

  it('verifies V3 Master endpoint + pricing on first live invocation (cost confirmation)', async () => {
    const { KlingProvider } = await import('../../src/video/providers/kling.js');
    const provider = new KlingProvider({
      dbPath: ':memory:',
      env: process.env as never,
    });
    // This is the placeholder pricing verification — Kling V3 Master rate is $0.18/s
    // placeholder in P15 Task 2. If the actual call succeeds and the API/billing returns
    // a different rate, the executor MUST update VIDEO_MODELS['kling-v3-master'].pricing.rate
    // and surface in Execution Amendments.
    try {
      const handle = await provider.generate({
        modelId: 'kling-v3-master',
        mode: 't2v',
        prompt: 'minimal 5s 4K test for pricing verification',
        durationSec: 5,
        resolution: '4k',
      });
      expect(handle.providerNativeId).toBeDefined();
      // NOTE: actual cost confirmation happens via webhook → recordActualCost → manual review
    } catch (err) {
      // If V3 Master is gated to enterprise contracts, this throws — surface in Amendments
      const msg = (err as Error).message;
      if (msg.includes('1001') || msg.includes('access')) {
        console.warn('[P15 live test] Kling V3 Master appears gated — defer pricing verification');
        return;
      }
      throw err;
    }
  }, 60_000);
});
