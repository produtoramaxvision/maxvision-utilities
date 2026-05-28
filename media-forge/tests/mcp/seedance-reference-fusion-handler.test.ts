/**
 * P16 Task 7 — media_seedance_reference_fusion handler tests.
 *
 * R2V (reference-to-video) with @Image1/@Video1/@Audio1 mention syntax in prompt.
 * Hard caps from fal.ai spec: 9 images, 3 videos, 3 audios. Total refs >= 1.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const generate = vi.fn();
const estimateCostUSD = vi.fn();
const mockInstance = {
  generate,
  estimateCostUSD,
  pollStatus: vi.fn(),
  download: vi.fn(),
  recordActualCostUSD: vi.fn(),
  models: [],
  name: 'bytedance' as const,
};

vi.mock('../../src/video/providers/bytedance-seedance.js', () => ({
  BytedanceSeedanceProvider: vi.fn(() => mockInstance),
  getBytedanceSeedanceProvider: vi.fn(() => mockInstance),
  __resetBytedanceSeedanceSingleton: vi.fn(),
}));

import { handleSeedanceReferenceFusion } from '../../src/mcp/handlers.js';

describe('media_seedance_reference_fusion handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generate.mockResolvedValue({
      jobId: 'seedance-r2v-1',
      provider: 'bytedance',
      model: 'seedance-2.0-standard',
      mode: 'with-refs',
      createdAt: '2026-05-27T00:00:00.000Z',
      providerNativeId: 'fal-req-r2v',
    });
    estimateCostUSD.mockReturnValue(2.4192);
  });

  it('accepts a near-max ref mix (8 images + 2 videos + 2 audios = 12, fal.ai cap)', async () => {
    // Per fal.ai contract (verified via context7), total refs across modalities
    // must not exceed 12. The old "9+3+3=15" test was over-cap by design and now
    // correctly rejects (see new "rejects when total references exceed 12" test).
    const result = await handleSeedanceReferenceFusion({
      prompt: 'fuse @Image1 @Video1 @Audio1',
      modelTier: 'standard',
      durationSec: 8,
      resolution: '1080p',
      imageUrls: [
        'https://cdn/u1.jpg', 'https://cdn/u2.jpg', 'https://cdn/u3.jpg',
        'https://cdn/u4.jpg', 'https://cdn/u5.jpg', 'https://cdn/u6.jpg',
        'https://cdn/u7.jpg', 'https://cdn/u8.jpg',
      ],
      videoUrls: ['https://cdn/v1.mp4', 'https://cdn/v2.mp4'],
      audioUrls: ['https://cdn/a1.wav', 'https://cdn/a2.wav'],
    });
    expect(result.jobId).toBe('seedance-r2v-1');
    expect(result.mode).toBe('with-refs');
    const req = generate.mock.calls[0]![0];
    expect(req.mode).toBe('with-refs');
    expect(req.extras.providerKind).toBe('bytedance');
    expect(req.extras.functionMode).toBe('omni_reference');
    expect(req.extras.referenceImageUrls).toHaveLength(8);
    expect(req.extras.referenceVideoUrls).toHaveLength(2);
    expect(req.extras.referenceAudioUrls).toHaveLength(2);
  });

  it('rejects when > 9 image refs (spec limit)', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'too many',
        durationSec: 8,
        resolution: '720p',
        imageUrls: Array.from({ length: 10 }, (_, i) => `https://cdn/u${i}.jpg`),
      }),
    ).rejects.toThrow(/at most 9 image/i);
  });

  it('rejects when > 3 video refs (spec limit)', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'too many vids',
        durationSec: 8,
        resolution: '720p',
        videoUrls: [
          'https://cdn/v1.mp4', 'https://cdn/v2.mp4',
          'https://cdn/v3.mp4', 'https://cdn/v4.mp4',
        ],
      }),
    ).rejects.toThrow(/at most 3 video/i);
  });

  it('rejects when > 3 audio refs (spec limit)', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'too many audios',
        durationSec: 8,
        resolution: '720p',
        audioUrls: [
          'https://cdn/a1.wav', 'https://cdn/a2.wav',
          'https://cdn/a3.wav', 'https://cdn/a4.wav',
        ],
      }),
    ).rejects.toThrow(/at most 3 audio/i);
  });

  it('rejects when total refs (img+video+audio) = 0', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'no refs',
        durationSec: 8,
        resolution: '720p',
        imageUrls: [],
        videoUrls: [],
        audioUrls: [],
      }),
    ).rejects.toThrow(/at least one reference/i);
  });

  it('rejects 1080p with modelTier=fast (A0.1 Fast caps at 720p)', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'x',
        modelTier: 'fast',
        resolution: '1080p',
        imageUrls: ['https://cdn/u1.jpg'],
      }),
    ).rejects.toThrow(/1080p resolution requires modelTier=.*standard/);
  });

  it('passes seed through to extras when provided', async () => {
    await handleSeedanceReferenceFusion({
      prompt: 'reproducible',
      durationSec: 6,
      resolution: '720p',
      imageUrls: ['https://cdn/u1.jpg'],
      seed: 99,
    });
    const req = generate.mock.calls[0]![0];
    expect(req.extras.seed).toBe(99);
  });

  it('uses fast model id when modelTier=fast (single image ref + 720p)', async () => {
    await handleSeedanceReferenceFusion({
      prompt: 'fast refs',
      modelTier: 'fast',
      resolution: '720p',
      durationSec: 4,
      imageUrls: ['https://cdn/u1.jpg'],
    });
    const req = generate.mock.calls[0]![0];
    expect(req.modelId).toBe('seedance-2.0-fast');
  });

  // -------------------------------------------------------------------------
  // Codex P2 round 7 PR#12 — fal.ai contract enforcement
  // (verified via context7: https://fal.ai/models/bytedance/seedance-2.0/reference-to-video)
  // -------------------------------------------------------------------------
  it('rejects when audioUrls provided without any image/video reference (fal.ai contract)', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'audio only',
        resolution: '720p',
        durationSec: 5,
        imageUrls: [],
        videoUrls: [],
        audioUrls: ['https://cdn/a1.wav'],
      }),
    ).rejects.toThrow(/audioUrls.*at least one reference image or video|image or video is required/i);
  });

  it('rejects when total references exceed 12 across all modalities (fal.ai contract)', async () => {
    await expect(
      handleSeedanceReferenceFusion({
        prompt: 'over cap',
        resolution: '720p',
        durationSec: 5,
        imageUrls: [
          'https://cdn/i1.jpg', 'https://cdn/i2.jpg', 'https://cdn/i3.jpg',
          'https://cdn/i4.jpg', 'https://cdn/i5.jpg', 'https://cdn/i6.jpg',
          'https://cdn/i7.jpg', 'https://cdn/i8.jpg', 'https://cdn/i9.jpg',
        ],
        videoUrls: ['https://cdn/v1.mp4', 'https://cdn/v2.mp4', 'https://cdn/v3.mp4'],
        audioUrls: ['https://cdn/a1.wav', 'https://cdn/a2.wav', 'https://cdn/a3.wav'],
      }),
    ).rejects.toThrow(/total reference files.*not exceed 12/i);
  });

  it('accepts exactly 12 total references at the cap', async () => {
    await handleSeedanceReferenceFusion({
      prompt: 'exactly twelve',
      resolution: '720p',
      durationSec: 5,
      imageUrls: [
        'https://cdn/i1.jpg', 'https://cdn/i2.jpg', 'https://cdn/i3.jpg',
        'https://cdn/i4.jpg', 'https://cdn/i5.jpg', 'https://cdn/i6.jpg',
        'https://cdn/i7.jpg', 'https://cdn/i8.jpg', 'https://cdn/i9.jpg',
      ],
      videoUrls: ['https://cdn/v1.mp4', 'https://cdn/v2.mp4', 'https://cdn/v3.mp4'],
      audioUrls: [],
    });
    expect(generate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Codex local round 8 PR#12 — direct schema parse asserts to verify Zod issue
// `path` attribution. Earlier tests only matched on the error message text via
// `.toThrow()`; the refines could regress with `path: undefined` and tests
// would still pass. Hitting safeParse directly catches that.
// ---------------------------------------------------------------------------
import { SeedanceReferenceFusionInput } from '../../src/mcp/schemas.js';

describe('SeedanceReferenceFusionInput zod refines — issue path attribution', () => {
  it('audio-only refusal attributes to path=["audioUrls"]', () => {
    const r = SeedanceReferenceFusionInput.safeParse({
      prompt: 'audio only',
      resolution: '720p',
      durationSec: 5,
      imageUrls: [],
      videoUrls: [],
      audioUrls: ['https://cdn/a1.wav'],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const hit = r.error.issues.find(
      (i) => i.path.length > 0 && i.path[0] === 'audioUrls',
    );
    expect(hit).toBeDefined();
    expect(hit?.message).toMatch(/image or video is required/i);
  });

  it('total-cap refusal attributes to path=["imageUrls"]', () => {
    const r = SeedanceReferenceFusionInput.safeParse({
      prompt: 'over cap',
      resolution: '720p',
      durationSec: 5,
      imageUrls: [
        'https://cdn/i1.jpg', 'https://cdn/i2.jpg', 'https://cdn/i3.jpg',
        'https://cdn/i4.jpg', 'https://cdn/i5.jpg', 'https://cdn/i6.jpg',
        'https://cdn/i7.jpg', 'https://cdn/i8.jpg', 'https://cdn/i9.jpg',
      ],
      videoUrls: ['https://cdn/v1.mp4', 'https://cdn/v2.mp4', 'https://cdn/v3.mp4'],
      audioUrls: ['https://cdn/a1.wav', 'https://cdn/a2.wav', 'https://cdn/a3.wav'],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const hit = r.error.issues.find(
      (i) => i.path.length > 0 && i.path[0] === 'imageUrls',
    );
    expect(hit).toBeDefined();
    expect(hit?.message).toMatch(/not exceed 12/i);
  });

  it('empty refs (0+0+0) attributes to the original "at least one reference required" refine, not the audio-only refine', () => {
    const r = SeedanceReferenceFusionInput.safeParse({
      prompt: 'no refs',
      resolution: '720p',
      durationSec: 5,
      imageUrls: [],
      videoUrls: [],
      audioUrls: [],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const msgs = r.error.issues.map((i) => i.message).join(' || ');
    expect(msgs).toMatch(/at least one reference/i);
    // Audio-only refine MUST NOT trigger when audioUrls is empty.
    expect(msgs).not.toMatch(/image or video is required/i);
  });
});

// ---------------------------------------------------------------------------
// CodeRabbit R18 deferred (PR#12) — file-format URL whitelist on Seedance.
// Image: JPEG/PNG/WebP. Video: MP4/MOV. Audio: MP3/WAV.
// Permissive: extension-less URLs (signed/CDN) pass; only explicitly wrong
// extensions fail (saves a fal.ai round-trip).
// ---------------------------------------------------------------------------
import { SeedanceImageToVideoInput } from '../../src/mcp/schemas.js';

describe('Seedance URL format refines — image/video/audio whitelist', () => {
  it('image-to-video rejects .gif on imageUrl', () => {
    const r = SeedanceImageToVideoInput.safeParse({
      prompt: 'x',
      resolution: '720p',
      durationSec: 4,
      imageUrl: 'https://cdn/start.gif',
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const hit = r.error.issues.find((i) => i.path[0] === 'imageUrl');
    expect(hit?.message).toMatch(/JPEG\/PNG\/WebP/i);
  });

  it('image-to-video accepts query-string after .jpg (?token=…)', () => {
    const r = SeedanceImageToVideoInput.safeParse({
      prompt: 'x',
      resolution: '720p',
      durationSec: 4,
      imageUrl: 'https://cdn/start.jpg?token=abc&exp=123',
    });
    expect(r.success).toBe(true);
  });

  it('image-to-video accepts extension-less signed/CDN URL', () => {
    const r = SeedanceImageToVideoInput.safeParse({
      prompt: 'x',
      resolution: '720p',
      durationSec: 4,
      imageUrl: 'https://cdn/abc123def456',
    });
    expect(r.success).toBe(true);
  });

  it('reference-fusion rejects .webm on videoUrls[]', () => {
    const r = SeedanceReferenceFusionInput.safeParse({
      prompt: '@Video1',
      resolution: '720p',
      durationSec: 5,
      imageUrls: [],
      videoUrls: ['https://cdn/v1.webm'],
      audioUrls: [],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const hit = r.error.issues.find((i) => i.path[0] === 'videoUrls');
    expect(hit?.message).toMatch(/MP4\/MOV/i);
  });

  it('reference-fusion rejects .aac on audioUrls[] (still needs image/video — both refines fire)', () => {
    const r = SeedanceReferenceFusionInput.safeParse({
      prompt: '@Image1 @Audio1',
      resolution: '720p',
      durationSec: 5,
      imageUrls: ['https://cdn/i.jpg'],
      videoUrls: [],
      audioUrls: ['https://cdn/a.aac'],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const hit = r.error.issues.find((i) => i.path[0] === 'audioUrls');
    expect(hit?.message).toMatch(/MP3\/WAV/i);
  });

  it('reference-fusion accepts mixed canonical extensions (jpg/png/webp/mp4/mov/mp3/wav)', () => {
    const r = SeedanceReferenceFusionInput.safeParse({
      prompt: 'mix',
      resolution: '720p',
      durationSec: 5,
      imageUrls: ['https://cdn/a.jpg', 'https://cdn/b.png', 'https://cdn/c.webp'],
      videoUrls: ['https://cdn/v.mp4', 'https://cdn/w.MOV'],
      audioUrls: ['https://cdn/s.mp3', 'https://cdn/t.WAV'],
    });
    expect(r.success).toBe(true);
  });
});
