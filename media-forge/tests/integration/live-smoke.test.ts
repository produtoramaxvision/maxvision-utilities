/**
 * Live API smoke test — real network calls, cost-capped ~$0.33.
 *
 * Gated by MEDIA_FORGE_RUN_LIVE_TESTS=true. When unset, ALL tests in this file
 * are skipped. Never runs in default CI.
 *
 * Usage:
 *   pnpm test:integration:live
 *
 * Estimated cost per run:
 *   Nano Banana Pro 1K image ≈ $0.134
 *   Veo 3.1 Pro 720p 4s      ≈ $0.20
 *   Total                     ≈ $0.33 (cap $0.50)
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { createClient } from '../../src/core/client.js';
import { generateImageNanoBananaPro } from '../../src/image/image-service.js';
import { generateVideoT2V, pollVideoOperation, downloadVideo } from '../../src/video/video-service.js';
import { NanoBananaProInput } from '../../src/image/image-schemas.js';
import { GenerateVideoT2VInput } from '../../src/video/video-schemas.js';
import { makeTempDir } from '../helpers/fs-tempdir.js';

const SHOULD_RUN = process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true';

describe.skipIf(!SHOULD_RUN)('Live API smoke (real network calls, cost-capped ≤$0.50)', () => {
  it('Nano Banana Pro 1K image generation', async () => {
    const config = loadConfig(process.env as Record<string, string | undefined>);
    expect(config.apiKey, 'GOOGLE_API_KEY or GEMINI_API_KEY required').toBeTruthy();

    const client = createClient({ config });
    const input = NanoBananaProInput.parse({
      op: 'nano-banana-pro',
      prompt: 'An abstract gradient pattern of geometric triangles, deep purple to teal, smooth color bands, 1K minimal composition',
      imageSize: '1K',
      thinkingLevel: 'LOW',
      referenceImages: [],
    });

    const result = await generateImageNanoBananaPro(input, client);
    expect(result.base64.length).toBeGreaterThan(1000);
    expect(result.mimeType).toMatch(/^image\//);
  }, 120_000);

  it('Veo 3.1 Pro 720p 4s video generation + poll + download', async () => {
    const config = loadConfig(process.env as Record<string, string | undefined>);
    const client = createClient({ config });

    const input = GenerateVideoT2VInput.parse({
      op: 't2v',
      prompt: 'A slow pan across a calm blue ocean horizon, daylight, peaceful',
      aspectRatio: '16:9',
      durationSeconds: 4,
      resolution: '720p',
      generateAudio: false,
    });

    const gen = await generateVideoT2V(input, client);
    expect(gen.operationName).toBeTruthy();

    const poll = await pollVideoOperation({
      client,
      operationName: gen.operationName,
      intervalMs: 15_000,
      maxAttempts: 30,
    });
    expect(poll.operation).toBeTruthy();

    // operation should have generatedVideos[0].video.uri
    const op = poll.operation as {
      response?: { generatedVideos?: Array<{ video?: { uri?: string; mimeType?: string } }> };
    };
    const videoUri = op.response?.generatedVideos?.[0]?.video?.uri;
    expect(videoUri, 'video URI in operation response').toBeTruthy();

    const tmp = makeTempDir('live-smoke-');
    const dl = await downloadVideo({
      client,
      videoUri: videoUri!,
      apiKey: config.apiKey,
      outputDir: tmp.path,
      filename: 'live-smoke.mp4',
    });
    expect(dl.bytes).toBeGreaterThan(10_000);
  }, 600_000);
});
