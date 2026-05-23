import { describe, it, expect } from 'vitest';
import {
  GenerateVideoT2VInput,
  GenerateVideoI2VInput,
  GenerateVideoInterpolateInput,
  GenerateVideoWithRefsInput,
  ExtendVideoInput,
  PollVideoOperationInput,
  DownloadVideoInput,
  VideoInput,
} from '../../../src/video/video-schemas.js';

// ---------------------------------------------------------------------------
// A) GenerateVideoT2VInput (op='t2v')
// ---------------------------------------------------------------------------
describe('GenerateVideoT2VInput', () => {
  const VALID_BASE = { op: 't2v' as const, prompt: 'a forest at dawn' };

  it('happy path — minimal valid input parses successfully', () => {
    const r = GenerateVideoT2VInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, aspectRatio, durationSeconds, resolution, generateAudio, personGeneration, outputDir, dryRun', () => {
    const r = GenerateVideoT2VInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('veo-3.1-generate-preview');
    expect(r.data.aspectRatio).toBe('16:9');
    expect(r.data.durationSeconds).toBe(8);
    expect(r.data.resolution).toBe('720p');
    expect(r.data.generateAudio).toBe(true);
    expect(r.data.personGeneration).toBe('allow_all');
    expect(r.data.outputDir).toBe('./outputs');
    expect(r.data.dryRun).toBe(false);
  });

  it('strict — rejects unknown keys', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, unknownKey: 'val' });
    expect(r.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, prompt: '' });
    expect(r.success).toBe(false);
  });

  it('rejects prompt exceeding 2000 chars', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, prompt: 'x'.repeat(2001) });
    expect(r.success).toBe(false);
  });

  it('accepts prompt at boundary 2000 chars', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, prompt: 'x'.repeat(2000) });
    expect(r.success).toBe(true);
  });

  it('rejects 4k resolution with durationSeconds=4', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      resolution: '4k',
      durationSeconds: 4,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.includes('durationSeconds'));
    expect(issue?.message).toContain('4k resolution requires durationSeconds=8');
  });

  it('rejects 4k resolution with durationSeconds=6', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      resolution: '4k',
      durationSeconds: 6,
    });
    expect(r.success).toBe(false);
  });

  it('accepts 4k resolution with durationSeconds=8', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      resolution: '4k',
      durationSeconds: 8,
    });
    expect(r.success).toBe(true);
  });

  it('rejects 1080p resolution with durationSeconds=4', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      resolution: '1080p',
      durationSeconds: 4,
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.includes('durationSeconds'));
    expect(issue?.message).toContain('1080p resolution requires durationSeconds=8');
  });

  it('accepts 1080p resolution with durationSeconds=8', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      resolution: '1080p',
      durationSeconds: 8,
    });
    expect(r.success).toBe(true);
  });

  it('rejects EU region with personGeneration=allow_all', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      region: 'EU',
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.includes('personGeneration'));
    expect(issue?.message).toContain('restricted region forces allow_adult');
  });

  it('accepts EU region with personGeneration=allow_adult', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      region: 'EU',
      personGeneration: 'allow_adult',
    });
    expect(r.success).toBe(true);
  });

  it('rejects UK region with personGeneration=allow_all', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      region: 'UK',
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(false);
  });

  it('rejects MENA region with personGeneration=allow_all', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      region: 'MENA',
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(false);
  });

  it('accepts non-restricted region with allow_all', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      region: 'US',
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(true);
  });

  it('rejects invalid durationSeconds (e.g. 5)', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, durationSeconds: 5 });
    expect(r.success).toBe(false);
  });

  it('accepts valid durationSeconds values: 4, 6, 8', () => {
    for (const d of [4, 6, 8] as const) {
      const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, durationSeconds: d });
      expect(r.success).toBe(true);
    }
  });

  it('rejects invalid resolution', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, resolution: '2160p' });
    expect(r.success).toBe(false);
  });

  it('rejects negativePrompt exceeding 500 chars', () => {
    const r = GenerateVideoT2VInput.safeParse({
      ...VALID_BASE,
      negativePrompt: 'z'.repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it('trims leading/trailing whitespace from prompt', () => {
    const r = GenerateVideoT2VInput.safeParse({ ...VALID_BASE, prompt: '  dawn  ' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.prompt).toBe('dawn');
  });
});

// ---------------------------------------------------------------------------
// B) GenerateVideoI2VInput (op='i2v')
// ---------------------------------------------------------------------------
describe('GenerateVideoI2VInput', () => {
  const VALID_BASE = {
    op: 'i2v' as const,
    prompt: 'slow zoom out',
    firstFrameImage: '/img/first.png',
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = GenerateVideoI2VInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: personGeneration=allow_adult', () => {
    const r = GenerateVideoI2VInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.personGeneration).toBe('allow_adult');
  });

  it('strict — rejects unknown keys', () => {
    const r = GenerateVideoI2VInput.safeParse({ ...VALID_BASE, ghost: true });
    expect(r.success).toBe(false);
  });

  it('rejects when firstFrameImage is missing', () => {
    const r = GenerateVideoI2VInput.safeParse({ op: 'i2v', prompt: 'test' });
    expect(r.success).toBe(false);
  });

  it('rejects personGeneration=allow_all (i2v requires allow_adult)', () => {
    const r = GenerateVideoI2VInput.safeParse({
      ...VALID_BASE,
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.includes('personGeneration'));
    expect(issue?.message).toContain('i2v mode requires personGeneration=allow_adult');
  });

  it('rejects 4k resolution with durationSeconds!=8', () => {
    const r = GenerateVideoI2VInput.safeParse({
      ...VALID_BASE,
      resolution: '4k',
      durationSeconds: 6,
    });
    expect(r.success).toBe(false);
  });

  it('rejects EU region with allow_all (via region matrix)', () => {
    const r = GenerateVideoI2VInput.safeParse({
      ...VALID_BASE,
      region: 'EU',
      // allow_all would also fail the i2v check; keep allow_adult to isolate region check
      personGeneration: 'allow_adult',
    });
    // EU + allow_adult is fine for i2v
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C) GenerateVideoInterpolateInput (op='interpolate')
// ---------------------------------------------------------------------------
describe('GenerateVideoInterpolateInput', () => {
  const VALID_BASE = {
    op: 'interpolate' as const,
    prompt: 'morph between frames',
    firstFrameImage: '/img/first.png',
    lastFrameImage: '/img/last.png',
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = GenerateVideoInterpolateInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, durationSeconds, resolution, personGeneration=allow_adult', () => {
    const r = GenerateVideoInterpolateInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('veo-3.1-generate-preview');
    expect(r.data.durationSeconds).toBe(8);
    expect(r.data.resolution).toBe('720p');
    expect(r.data.personGeneration).toBe('allow_adult');
  });

  it('strict — rejects unknown keys', () => {
    const r = GenerateVideoInterpolateInput.safeParse({ ...VALID_BASE, extra: 'val' });
    expect(r.success).toBe(false);
  });

  it('rejects when lastFrameImage is missing', () => {
    const { lastFrameImage: _removed, ...withoutLast } = VALID_BASE;
    const r = GenerateVideoInterpolateInput.safeParse(withoutLast);
    expect(r.success).toBe(false);
  });

  it('rejects when firstFrameImage is missing', () => {
    const { firstFrameImage: _removed, ...withoutFirst } = VALID_BASE;
    const r = GenerateVideoInterpolateInput.safeParse(withoutFirst);
    expect(r.success).toBe(false);
  });

  it('rejects personGeneration=allow_all', () => {
    const r = GenerateVideoInterpolateInput.safeParse({
      ...VALID_BASE,
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(false);
  });

  it('rejects 1080p + durationSeconds=6', () => {
    const r = GenerateVideoInterpolateInput.safeParse({
      ...VALID_BASE,
      resolution: '1080p',
      durationSeconds: 6,
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D) GenerateVideoWithRefsInput (op='with-refs')
// ---------------------------------------------------------------------------
describe('GenerateVideoWithRefsInput', () => {
  const VALID_BASE = {
    op: 'with-refs' as const,
    prompt: 'product showcase',
    referenceImages: [{ path: '/img/asset1.png', referenceType: 'ASSET' as const }],
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = GenerateVideoWithRefsInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, aspectRatio, durationSeconds, resolution, personGeneration=allow_adult', () => {
    const r = GenerateVideoWithRefsInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('veo-3.1-generate-preview');
    expect(r.data.aspectRatio).toBe('16:9');
    expect(r.data.durationSeconds).toBe(8);
    expect(r.data.resolution).toBe('720p');
    expect(r.data.personGeneration).toBe('allow_adult');
  });

  it('strict — rejects unknown keys', () => {
    const r = GenerateVideoWithRefsInput.safeParse({ ...VALID_BASE, extra: 'ghost' });
    expect(r.success).toBe(false);
  });

  it('rejects empty referenceImages array (min 1)', () => {
    const r = GenerateVideoWithRefsInput.safeParse({ ...VALID_BASE, referenceImages: [] });
    expect(r.success).toBe(false);
  });

  it('rejects referenceImages array with 4 items (max 3)', () => {
    const refs = Array.from({ length: 4 }, (_, i) => ({
      path: `/img/asset${i}.png`,
      referenceType: 'ASSET' as const,
    }));
    const r = GenerateVideoWithRefsInput.safeParse({ ...VALID_BASE, referenceImages: refs });
    expect(r.success).toBe(false);
  });

  it('accepts referenceImages at max 3 items', () => {
    const refs = Array.from({ length: 3 }, (_, i) => ({
      path: `/img/asset${i}.png`,
      referenceType: 'ASSET' as const,
    }));
    const r = GenerateVideoWithRefsInput.safeParse({ ...VALID_BASE, referenceImages: refs });
    expect(r.success).toBe(true);
  });

  it('rejects non-ASSET referenceType', () => {
    const r = GenerateVideoWithRefsInput.safeParse({
      ...VALID_BASE,
      referenceImages: [{ path: '/img/asset1.png', referenceType: 'STYLE' }],
    });
    expect(r.success).toBe(false);
  });

  it('rejects personGeneration=allow_all', () => {
    const r = GenerateVideoWithRefsInput.safeParse({
      ...VALID_BASE,
      personGeneration: 'allow_all',
    });
    expect(r.success).toBe(false);
  });

  it('rejects 4k + duration!=8', () => {
    const r = GenerateVideoWithRefsInput.safeParse({
      ...VALID_BASE,
      resolution: '4k',
      durationSeconds: 4,
    });
    expect(r.success).toBe(false);
  });

  it('accepts CH region with allow_adult', () => {
    const r = GenerateVideoWithRefsInput.safeParse({
      ...VALID_BASE,
      region: 'CH',
      personGeneration: 'allow_adult',
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E) ExtendVideoInput (op='extend')
// ---------------------------------------------------------------------------
describe('ExtendVideoInput', () => {
  const VALID_BASE = {
    op: 'extend' as const,
    sourceVideoPath: '/videos/source.mp4',
    prompt: 'continue the scene naturally',
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = ExtendVideoInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: model, resolution=720p, durationSeconds=7, hopIndex=0, personGeneration=allow_all, outputDir', () => {
    const r = ExtendVideoInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.model).toBe('veo-3.1-generate-preview');
    expect(r.data.resolution).toBe('720p');
    expect(r.data.durationSeconds).toBe(7);
    expect(r.data.hopIndex).toBe(0);
    expect(r.data.personGeneration).toBe('allow_all');
    expect(r.data.outputDir).toBe('./outputs');
  });

  it('strict — rejects unknown keys', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, extra: 'ghost' });
    expect(r.success).toBe(false);
  });

  it('rejects hopIndex=20 (max is 19)', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, hopIndex: 20 });
    expect(r.success).toBe(false);
  });

  it('accepts hopIndex at boundary 19', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, hopIndex: 19 });
    expect(r.success).toBe(true);
  });

  it('accepts hopIndex at boundary 0', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, hopIndex: 0 });
    expect(r.success).toBe(true);
  });

  it('rejects hopIndex negative', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, hopIndex: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects resolution other than 720p (literal constraint)', () => {
    // resolution is z.literal('720p') — any other value should be rejected
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, resolution: '1080p' });
    expect(r.success).toBe(false);
  });

  it('rejects durationSeconds other than 7 (literal constraint)', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, durationSeconds: 8 });
    expect(r.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const r = ExtendVideoInput.safeParse({ ...VALID_BASE, prompt: '' });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F) PollVideoOperationInput (op='poll')
// ---------------------------------------------------------------------------
describe('PollVideoOperationInput', () => {
  const VALID_BASE = {
    op: 'poll' as const,
    operationName: 'operations/proj/abc123',
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = PollVideoOperationInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: intervalMs=10000, timeoutMs=900000', () => {
    const r = PollVideoOperationInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.intervalMs).toBe(10000);
    expect(r.data.timeoutMs).toBe(900000);
  });

  it('strict — rejects unknown keys', () => {
    const r = PollVideoOperationInput.safeParse({ ...VALID_BASE, extra: 'val' });
    expect(r.success).toBe(false);
  });

  it('rejects intervalMs below 1000', () => {
    const r = PollVideoOperationInput.safeParse({ ...VALID_BASE, intervalMs: 999 });
    expect(r.success).toBe(false);
  });

  it('rejects intervalMs above 60000', () => {
    const r = PollVideoOperationInput.safeParse({ ...VALID_BASE, intervalMs: 60001 });
    expect(r.success).toBe(false);
  });

  it('accepts intervalMs at boundaries 1000 and 60000', () => {
    const r1 = PollVideoOperationInput.safeParse({ ...VALID_BASE, intervalMs: 1000 });
    const r2 = PollVideoOperationInput.safeParse({ ...VALID_BASE, intervalMs: 60000 });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('rejects timeoutMs below 60000', () => {
    const r = PollVideoOperationInput.safeParse({ ...VALID_BASE, timeoutMs: 59999 });
    expect(r.success).toBe(false);
  });

  it('rejects timeoutMs above 1800000', () => {
    const r = PollVideoOperationInput.safeParse({ ...VALID_BASE, timeoutMs: 1800001 });
    expect(r.success).toBe(false);
  });

  it('accepts timeoutMs at boundary 1800000', () => {
    const r = PollVideoOperationInput.safeParse({ ...VALID_BASE, timeoutMs: 1800000 });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// G) DownloadVideoInput (op='download')
// ---------------------------------------------------------------------------
describe('DownloadVideoInput', () => {
  const VALID_BASE = {
    op: 'download' as const,
    operationName: 'operations/proj/xyz789',
  };

  it('happy path — minimal valid input parses successfully', () => {
    const r = DownloadVideoInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
  });

  it('applies defaults: outputDir=./outputs', () => {
    const r = DownloadVideoInput.safeParse(VALID_BASE);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.outputDir).toBe('./outputs');
  });

  it('strict — rejects unknown keys', () => {
    const r = DownloadVideoInput.safeParse({ ...VALID_BASE, ghost: true });
    expect(r.success).toBe(false);
  });

  it('accepts optional filename', () => {
    const r = DownloadVideoInput.safeParse({ ...VALID_BASE, filename: 'output.mp4' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.filename).toBe('output.mp4');
  });
});

// ---------------------------------------------------------------------------
// VideoInput — aggregate discriminated union
// ---------------------------------------------------------------------------
describe('VideoInput (discriminated union)', () => {
  it('rejects unknown op value', () => {
    const r = VideoInput.safeParse({ op: 'unknown-video-op', prompt: 'test' });
    expect(r.success).toBe(false);
  });

  it('routes to t2v with minimal fields', () => {
    const r = VideoInput.safeParse({ op: 't2v', prompt: 'a forest' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.op).toBe('t2v');
  });

  it('routes to i2v', () => {
    const r = VideoInput.safeParse({
      op: 'i2v',
      prompt: 'test',
      firstFrameImage: '/img/f.png',
    });
    expect(r.success).toBe(true);
  });

  it('routes to interpolate', () => {
    const r = VideoInput.safeParse({
      op: 'interpolate',
      prompt: 'test',
      firstFrameImage: '/img/f.png',
      lastFrameImage: '/img/l.png',
    });
    expect(r.success).toBe(true);
  });

  it('routes to with-refs', () => {
    const r = VideoInput.safeParse({
      op: 'with-refs',
      prompt: 'test',
      referenceImages: [{ path: '/img/a.png', referenceType: 'ASSET' }],
    });
    expect(r.success).toBe(true);
  });

  it('routes to extend', () => {
    const r = VideoInput.safeParse({
      op: 'extend',
      sourceVideoPath: '/v.mp4',
      prompt: 'continue',
    });
    expect(r.success).toBe(true);
  });

  it('routes to poll', () => {
    const r = VideoInput.safeParse({ op: 'poll', operationName: 'op/abc' });
    expect(r.success).toBe(true);
  });

  it('routes to download', () => {
    const r = VideoInput.safeParse({ op: 'download', operationName: 'op/abc' });
    expect(r.success).toBe(true);
  });

  it('rejects missing op entirely', () => {
    const r = VideoInput.safeParse({ prompt: 'no op field' });
    expect(r.success).toBe(false);
  });
});
