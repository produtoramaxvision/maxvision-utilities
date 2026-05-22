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
 *
 * Prompts below follow the OFFICIAL Google prompt frameworks. They are
 * deliberately detailed so that this smoke test doubles as an executable
 * reference for the production prompt patterns documented in P11 templates.
 *
 *   Nano Banana Pro framework (image):
 *     [Subject + Adjectives] doing [Action] in [Location/Context].
 *     [Composition/Camera Angle]. [Lighting/Atmosphere]. [Style/Media].
 *     — https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/
 *     — https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
 *
 *   Veo 3.1 Pro 5-part formula (video):
 *     [Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]
 *     plus optional Audio: dialogue / SFX / ambient noise
 *     — https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
 *     — https://deepmind.google/models/veo/prompt-guide/
 *
 * Subjects chosen intentionally avoid copyright/celebrity/famous-art mappings
 * that can trigger Google's Layer 2 RAI filter (finishReason: IMAGE_RECITATION,
 * blockReason: OTHER). See https://ai.google.dev/gemini-api/docs/safety-settings.
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
      // Nano Banana Pro framework: Subject → Composition → Camera → Lighting → Style.
      prompt:
        'A precision-machined titanium watch movement with exposed gear assembly, ' +
        'photographed in extreme macro detail. ' +
        'Composition: top-down centered, subject fills 80% of frame. ' +
        'Camera: 100mm macro lens, f/8 aperture for edge-to-edge sharpness. ' +
        'Lighting: dual softbox key+fill at 45 degree elevation, single rim light from behind ' +
        'separating gears from background. Atmosphere: deep matte black velvet backdrop, ' +
        'subtle dust particles catching the rim light. ' +
        'Style: high-end editorial product photography, photorealistic, color graded with cool steel tones.',
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
      // Veo 3.1 5-part formula: Cinematography → Subject → Action → Context → Style & Ambiance.
      // Audio disabled here to keep the run inside the cost cap; the Audio syntax
      // (dialogue / SFX / ambient noise) is exercised by P11 templates and integration mocks.
      prompt:
        'Slow tracking shot from left to right, 50mm lens, shallow depth of field. ' +
        'A single drop of dark espresso falls from a brushed copper espresso machine spout, ' +
        'then accelerates and impacts a white ceramic cup creating a controlled splash with ' +
        'concentric surface ripples. ' +
        'Modern artisanal coffee bar setting, blurred warm tungsten lights in background, ' +
        'polished marble countertop in foreground. ' +
        'Cinematic commercial photography aesthetic, golden hour color grade, ' +
        'slight motion blur on the falling drop, premium product film quality.',
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
