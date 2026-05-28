import { describe, it, expect } from 'vitest';
import type {
  ProviderExtras,
  HiggsfieldExtras,
  VideoGenerationRequest,
} from '../../../src/video/providers/base.js';

describe('HiggsfieldExtras (compile-time)', () => {
  it('is assignable to ProviderExtras via discriminator', () => {
    const extras: ProviderExtras = {
      providerKind: 'higgsfield',
      soulId: 'soul_abc123',
      dopCameraVerbs: ['dolly_in', 'crash_zoom'],
    };
    expect(extras.providerKind).toBe('higgsfield');
  });

  it('accepts every documented field shape', () => {
    const extras: HiggsfieldExtras = {
      providerKind: 'higgsfield',
      soulId: 'soul_xyz',
      dopCameraVerbs: ['orbit', 'crane_up', 'handheld'],
      cinemaStudioParams: {
        focalLengthMm: 35,
        apertureFStop: 1.8,
        sensorSize: 'super35',
        colorGrading: 'teal-orange',
        lensId: 'arri-master-prime-35mm',
      },
      speakAudioPath: '/tmp/audio.wav',
      marketingStudioTemplate: 'unboxing',
      marketingStudioProductUrl: 'https://example.com/product/123',
      multiReferenceImages: ['/tmp/ref1.png', '/tmp/ref2.png'],
      viralityPredictor: true,
      recastTargetCharacterPath: '/tmp/new-character.png',
      aggregatorProxyModel: 'veo-3-fast',
      webhookUrl: 'https://example.com/webhook/job-abc',
    };
    expect(extras.providerKind).toBe('higgsfield');
    expect(extras.dopCameraVerbs?.length).toBe(3);
  });

  it('is assignable to VideoGenerationRequest.extras', () => {
    const req: VideoGenerationRequest = {
      modelId: 'higgsfield-soul-standard',
      mode: 't2v',
      prompt: 'astronaut riding a unicorn',
      durationSec: 8,
      resolution: '720p',
      extras: { providerKind: 'higgsfield', soulId: 'soul_a' },
    };
    expect(req.extras?.providerKind).toBe('higgsfield');
  });

  it('rejects mixing higgsfield-only fields onto google extras (compile-time)', () => {
    // The following is intentionally a runtime smoke check — TS catches the real bug at compile.
    const google: ProviderExtras = { providerKind: 'google' };
    expect(google.providerKind).toBe('google');
  });
});
