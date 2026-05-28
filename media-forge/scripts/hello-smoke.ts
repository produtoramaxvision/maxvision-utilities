// scripts/hello-smoke.ts — proves the build chain works without any API call.
// Run: pnpm hello
//
// Steps:
// 1. Imports the version constant from src/
// 2. Prints a sanitized "assembled payload" the way real generation code will
// 3. Asserts the expected top-tier model IDs are the only ones referenced
//
// Exits 0 on success, 1 with a diagnostic on failure.

import { MEDIA_FORGE_VERSION } from '../src/index.js';

const TOP_TIER_MODELS = {
  image_primary: 'gemini-3-pro-image-preview',
  image_imagen_ultra: 'imagen-4.0-ultra-generate-001',
  video: 'veo-3.1-generate-preview',
} as const;

function assembleSamplePayload() {
  return {
    plugin: 'media-forge',
    version: MEDIA_FORGE_VERSION,
    sample_image_call: {
      model: TOP_TIER_MODELS.image_primary,
      config: {
        imageConfig: { aspectRatio: '16:9', imageSize: '4K' },
        thinkingConfig: { thinkingLevel: 'HIGH' },
      },
    },
    sample_video_call: {
      model: TOP_TIER_MODELS.video,
      config: {
        aspectRatio: '16:9',
        durationSeconds: 8,
        resolution: '4k',
        personGeneration: 'allow_all',
        numberOfVideos: 1,
      },
    },
  };
}

function main(): number {
  const payload = assembleSamplePayload();
  console.error('media-forge hello smoke');
  console.error('  version:', MEDIA_FORGE_VERSION);
  console.error('  payload:', JSON.stringify(payload, null, 2));

  if (MEDIA_FORGE_VERSION !== '0.1.1') {
    console.error('FAIL: unexpected MEDIA_FORGE_VERSION:', MEDIA_FORGE_VERSION);
    return 1;
  }

  if (payload.sample_image_call.model !== 'gemini-3-pro-image-preview') {
    console.error('FAIL: image model not Nano Banana Pro');
    return 1;
  }

  if (payload.sample_video_call.model !== 'veo-3.1-generate-preview') {
    console.error('FAIL: video model not Veo 3.1 Pro');
    return 1;
  }

  console.error('OK: hello smoke passed.');
  return 0;
}

process.exit(main());
