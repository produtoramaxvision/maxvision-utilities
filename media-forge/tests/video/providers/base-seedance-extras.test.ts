import { describe, it, expect } from 'vitest';
import type {
  ProviderExtras,
  BytedanceSeedanceExtras,
  VideoGenerationRequest,
} from '../../../src/video/providers/base.js';

describe('BytedanceSeedanceExtras (P16)', () => {
  it('discriminates on providerKind = "bytedance"', () => {
    const extras: BytedanceSeedanceExtras = { providerKind: 'bytedance' };
    expect(extras.providerKind).toBe('bytedance');
  });

  it('accepts functionMode literals', () => {
    const extras: BytedanceSeedanceExtras = {
      providerKind: 'bytedance',
      functionMode: 'omni_reference',
    };
    expect(extras.functionMode).toBe('omni_reference');
  });

  it('accepts reference URL arrays (images / videos / audios)', () => {
    const extras: BytedanceSeedanceExtras = {
      providerKind: 'bytedance',
      referenceImageUrls: ['https://example/img1.jpg', 'https://example/img2.png'],
      referenceVideoUrls: ['https://example/clip.mp4'],
      referenceAudioUrls: ['https://example/voice.wav'],
    };
    expect(extras.referenceImageUrls).toHaveLength(2);
  });

  it('accepts multiShotTimestamps array with start/end/prompt shape', () => {
    const extras: BytedanceSeedanceExtras = {
      providerKind: 'bytedance',
      multiShotTimestamps: [
        { start: 0, end: 5, prompt: 'wide shot of city skyline' },
        { start: 5, end: 10, prompt: 'close-up on a window' },
      ],
    };
    expect(extras.multiShotTimestamps?.[0]?.prompt).toContain('skyline');
  });

  it('accepts targetedEditShotIndex (1-based)', () => {
    const extras: BytedanceSeedanceExtras = {
      providerKind: 'bytedance',
      targetedEditShotIndex: 2,
    };
    expect(extras.targetedEditShotIndex).toBe(2);
  });

  it('accepts lipSyncEnabled and cameraFixed flags', () => {
    const extras: BytedanceSeedanceExtras = {
      providerKind: 'bytedance',
      lipSyncEnabled: true,
      cameraFixed: false,
    };
    expect(extras.lipSyncEnabled).toBe(true);
    expect(extras.cameraFixed).toBe(false);
  });

  it('accepts seed field', () => {
    const extras: BytedanceSeedanceExtras = {
      providerKind: 'bytedance',
      seed: 42,
    };
    expect(extras.seed).toBe(42);
  });

  it('VideoGenerationRequest.extras accepts BytedanceSeedanceExtras in union', () => {
    const req: VideoGenerationRequest = {
      modelId: 'seedance-2.0-standard',
      mode: 'multi-shot',
      prompt: 'test',
      durationSec: 10,
      resolution: '1080p',
      extras: { providerKind: 'bytedance', multiShotTimestamps: [{ start: 0, end: 5, prompt: 'a' }] },
    };
    expect(req.extras?.providerKind).toBe('bytedance');
  });

  it('ProviderExtras union enumerates bytedance arm', () => {
    const e: ProviderExtras = { providerKind: 'bytedance' };
    expect(e.providerKind).toBe('bytedance');
  });

  it('mode enum literals are covered by VideoGenerationRequest.mode for all Seedance modes', () => {
    const modes: VideoGenerationRequest['mode'][] = [
      't2v',
      'i2v',
      'with-refs',
      'multi-shot',
      'targeted-edit',
    ];
    expect(modes).toHaveLength(5);
  });
});
