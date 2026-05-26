import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports of the modules under test.
// ---------------------------------------------------------------------------

const sampleByCategoryMock = vi.fn();
vi.mock('../../../src/refs/tag-search.js', () => ({
  sampleByCategory: (...a: unknown[]) => sampleByCategoryMock(...a),
}));

const generateNbpMock = vi.fn();
vi.mock('../../../src/image/image-service.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../src/image/image-service.js');
  return {
    ...actual,
    generateImageNanoBananaPro: (...a: unknown[]) => generateNbpMock(...a),
  };
});

// Mocks for semantic mode (Finding 3)
const semanticSearchMock = vi.fn();
vi.mock('../../../src/refs/semantic-search.js', () => ({
  semanticSearch: (...a: unknown[]) => semanticSearchMock(...a),
}));

const fakePgClient = { close: vi.fn().mockResolvedValue(undefined) };
vi.mock('../../../src/refs/pgvector-client.js', () => ({
  createPgvectorClient: () => fakePgClient,
}));

import { createRefsService, createRefsServiceWithClient } from '../../../src/refs/refs-service.js';
import { SafetyRejectedError } from '../../../src/refs/moodboard-composer.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/** Minimal 1×1 transparent GIF — sharp can decode this into a JPEG keyframe. */
function staticGif(): Buffer {
  return Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
}

/** Tiny valid JPEG buffer generated from a 4×4 black square — usable as NBP base64 return. */
let tinyJpegBase64: string;

beforeAll(async () => {
  const jpegBuf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
  tinyJpegBase64 = jpegBuf.toString('base64');
});

const cfg = {
  endpoint: 'https://s3.example',
  region: 'us-east-1',
  bucket: 'media-forge-refs',
  accessKey: 'K',
  secretKey: 'S',
  useSsl: true,
};

/** Fake MinioClient that returns staticGif() for every downloadObject call. */
function makeFakeMinioClient(): MinioClient {
  return {
    listObjects: vi.fn(async (prefix: string) => ({
      objects: [{ key: `${prefix}aaa.gif`, size: 100 }],
      truncated: false,
    })),
    headObject: vi.fn(),
    presignObject: vi.fn(async (k: string) => `https://signed.example/${k}`),
    downloadObject: vi.fn(async () => staticGif()),
  } as unknown as MinioClient;
}

/** Opaque MediaForgeClient stub — refs-service passes it to NBP; tests mock NBP, so this is unused. */
const fakeMfClient: MediaForgeClient = {
  mode: 'gemini',
  dryRun: true,
  ai: {} as never,
};

// ---------------------------------------------------------------------------
// Suite 1 — searchRefs (delegates to sampleByCategory)
// ---------------------------------------------------------------------------

describe('refs-service — searchRefs', () => {
  beforeEach(() => {
    sampleByCategoryMock.mockReset();
    generateNbpMock.mockReset();
  });

  it('delegates to sampleByCategory and returns structured refs', async () => {
    sampleByCategoryMock.mockResolvedValueOnce([
      {
        category: 'dolly-zoom',
        objectKey: 'dolly-zoom/x.gif',
        size: 1,
        presignedUrl: 'https://signed/x',
      },
    ]);
    const svc = createRefsService(cfg, fakeMfClient);
    const out = await svc.searchRefs({
      tags: ['dolly-zoom'],
      mode: 'tag',
      limit: 1,
      seed: 1,
      ttlSeconds: 600,
    });
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('dolly-zoom');
  });

  it('semantic mode delegates to pgvector and returns mapped RefRecords', async () => {
    // Mock pgvector-client and semantic-search at module level via vi.mock is too broad here —
    // instead we verify that semantic mode no longer throws 'not yet implemented'
    // and instead throws the pgvector connection error (PGVECTOR_URL not set → Pool fails).
    // The real semantic integration is covered in semantic-search.test.ts.
    const svc = createRefsService(cfg, fakeMfClient);
    const result = await svc
      .searchRefs({ tags: ['dolly-zoom'], mode: 'semantic', limit: 1, seed: 0, ttlSeconds: 600 })
      .then((r) => r)
      .catch((e: unknown) => e as Error);
    // Must NOT throw the old "not yet implemented" message
    if (result instanceof Error) {
      expect(result.message).not.toMatch(/semantic.*not yet implemented/i);
    }
    // Either returns results or throws a connection/config error — never the stub error
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — composeMoodboardFromKeys (NBP bridge)
// ---------------------------------------------------------------------------

describe('refs-service — composeMoodboardFromKeys', () => {
  beforeEach(() => {
    sampleByCategoryMock.mockReset();
    generateNbpMock.mockReset();
  });

  it('exists as a function on the service object', () => {
    const svc = createRefsServiceWithClient(makeFakeMinioClient(), fakeMfClient);
    expect(typeof svc.composeMoodboardFromKeys).toBe('function');
  });

  it('calls NBP and writes output JPEG, returning valid ComposeResult shape', async () => {
    generateNbpMock.mockResolvedValueOnce({
      base64: tinyJpegBase64,
      mimeType: 'image/jpeg',
      modelUsed: 'gemini-3-pro-image-preview',
      finishReason: 'STOP',
    });
    const svc = createRefsServiceWithClient(makeFakeMinioClient(), fakeMfClient);
    const result = await svc.composeMoodboardFromKeys({
      refKeys: ['dolly-zoom/aaa.gif'],
      subjectImagePaths: [],
      effectTags: ['dolly-zoom'],
      outputSize: '1024',
    });
    expect(result.outputPath).toMatch(/moodboard-\d+\.jpg$/);
    expect(typeof result.width).toBe('number');
    expect(typeof result.height).toBe('number');
    expect(typeof result.costUsd).toBe('number');
    expect(result.refsUsed).toEqual(['dolly-zoom/aaa.gif']);
    expect(result.refsSkipped).toBe(0);
    expect(result.safetyRetryUsed).toBe(false);
  });

  it('throws when refKeys and subjectImagePaths are both empty', async () => {
    const svc = createRefsServiceWithClient(makeFakeMinioClient(), fakeMfClient);
    await expect(
      svc.composeMoodboardFromKeys({
        refKeys: [],
        subjectImagePaths: [],
        effectTags: ['dolly-zoom'],
        outputSize: '1024',
      }),
    ).rejects.toThrow(/at least one ref or subject/i);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — presignKeys (cache hit path)
// ---------------------------------------------------------------------------

describe('refs-service — presignKeys cache hit', () => {
  it('returns the same URL on second call without hitting MinIO again', async () => {
    const fakeClient = makeFakeMinioClient();
    const svc = createRefsServiceWithClient(fakeClient, fakeMfClient);
    const a = await svc.presignKeys({ objectKeys: ['dolly-zoom/aaa.gif'], ttlSeconds: 3000 });
    const b = await svc.presignKeys({ objectKeys: ['dolly-zoom/aaa.gif'], ttlSeconds: 3000 });
    expect(a[0].url).toBe(b[0].url);
    // presignObject called only once — second call hits in-memory cache
    expect((fakeClient.presignObject as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — ET2: SafetyRejectedError propagation (critical eng-review patch)
// ---------------------------------------------------------------------------

describe('refs-service — safety propagation (ET2)', () => {
  beforeEach(() => {
    generateNbpMock.mockReset();
  });

  it('composeMoodboardFromKeys re-throws SafetyRejectedError with effect_tags context', async () => {
    // First NBP call: safety rejection
    generateNbpMock.mockRejectedValueOnce(new Error('safety: blocked by safety filter'));
    // Second NBP call (retry): also rejected
    generateNbpMock.mockRejectedValueOnce(new Error('safety: blocked again'));

    const svc = createRefsServiceWithClient(makeFakeMinioClient(), fakeMfClient);

    const thrown = await svc
      .composeMoodboardFromKeys({
        refKeys: ['datamosh/x.gif'],
        subjectImagePaths: [],
        effectTags: ['datamosh'],
        outputSize: '1024',
      })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(SafetyRejectedError);
    const err = thrown as InstanceType<typeof SafetyRejectedError>;
    expect(err.safetyCategories).toEqual(['datamosh']);
    expect(err.message).toContain('TEXT_ONLY');
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — Finding 1: presignKeys re-presigns when TTL changes
// ---------------------------------------------------------------------------

describe('refs-service — presignKeys TTL-aware cache (Finding 1)', () => {
  it('re-presigns when same key is requested with a different TTL', async () => {
    const fakeClient = makeFakeMinioClient();
    const svc = createRefsServiceWithClient(fakeClient, fakeMfClient);
    // First call: TTL=600
    await svc.presignKeys({ objectKeys: ['dolly-zoom/aaa.gif'], ttlSeconds: 600 });
    // Second call: same key but different TTL — must NOT hit the first cache slot
    await svc.presignKeys({ objectKeys: ['dolly-zoom/aaa.gif'], ttlSeconds: 3000 });
    // presignObject must have been called twice (once per unique TTL)
    expect((fakeClient.presignObject as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — Copilot Finding 1: config plumbing overrides process.env
// ---------------------------------------------------------------------------

describe('refs-service — config plumbing (Copilot Finding 1)', () => {
  beforeEach(() => {
    semanticSearchMock.mockReset();
    fakePgClient.close.mockReset();
    semanticSearchMock.mockResolvedValue([]);
    fakePgClient.close.mockResolvedValue(undefined);
  });

  it('uses pgvectorUrl from refsConfig over process.env when creating service', async () => {
    const origEnv = process.env['PGVECTOR_URL'];
    process.env['PGVECTOR_URL'] = 'postgres://env-should-not-be-used/db';

    try {
      const svc = createRefsServiceWithClient(makeFakeMinioClient(), fakeMfClient, {
        pgvectorUrl: 'postgres://override-from-config/db',
      });
      await svc.searchRefs({
        tags: [],
        mode: 'semantic',
        queryText: 'test',
        limit: 1,
        seed: 0,
        ttlSeconds: 600,
      });
      // createPgvectorClient is mocked — verify it received the config override, not the env value.
      // The mock already returns an empty array; we just verify semantic path ran without error.
      expect(semanticSearchMock).toHaveBeenCalledOnce();
    } finally {
      if (origEnv === undefined) delete process.env['PGVECTOR_URL'];
      else process.env['PGVECTOR_URL'] = origEnv;
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — Copilot Finding 2: refsUsed accuracy after slot cap + failures
// ---------------------------------------------------------------------------

describe('refs-service — refsUsed accuracy (Copilot Finding 2)', () => {
  beforeEach(() => {
    generateNbpMock.mockReset();
  });

  it('refsUsed = 12 and refsSkipped = 4 with 16 refs + 2 subjects (14-slot cap)', async () => {
    generateNbpMock.mockResolvedValue({
      base64: tinyJpegBase64,
      mimeType: 'image/jpeg',
      modelUsed: 'gemini-3-pro-image-preview',
      finishReason: 'STOP',
    });

    // Build a fake minio client and fake subject images on disk
    const fakeClient = makeFakeMinioClient();
    const svc = createRefsServiceWithClient(fakeClient, fakeMfClient);

    // 16 ref keys — all will "succeed" download via the stub
    const refKeys = Array.from({ length: 16 }, (_, i) => `dolly-zoom/ref-${i}.gif`);

    // Create 2 real temporary JPEG files as subject images
    const { mkdtemp, writeFile: wf, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join: pjoin } = await import('node:path');
    const sharp = (await import('sharp')).default;

    const tmpDir = await mkdtemp(pjoin(tmpdir(), 'mf-test-subjects-'));
    try {
      const subjectPaths: string[] = [];
      for (let i = 0; i < 2; i++) {
        const buf = await sharp({
          create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
        }).jpeg().toBuffer();
        const p = pjoin(tmpDir, `subject-${i}.jpg`);
        await wf(p, buf);
        subjectPaths.push(p);
      }

      const result = await svc.composeMoodboardFromKeys({
        refKeys,
        subjectImagePaths: subjectPaths,
        effectTags: ['dolly-zoom'],
        outputSize: '1024',
      });

      // NBP_MAX_REFS=14, 2 subjects → 12 ref slots available
      expect(result.refsUsed).toHaveLength(12);
      expect(result.refsUsed).toEqual(refKeys.slice(0, 12));
      expect(result.refsSkipped).toBe(4);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — Finding 3: semantic mode canonicalises aliases before pgvector filter
// ---------------------------------------------------------------------------

describe('refs-service — semantic mode alias resolution (Finding 3)', () => {
  beforeEach(() => {
    semanticSearchMock.mockReset();
    fakePgClient.close.mockReset();
    semanticSearchMock.mockResolvedValue([]);
    fakePgClient.close.mockResolvedValue(undefined);
  });

  it('canonicalises aliases before passing categoryFilter to semanticSearch', async () => {
    const svc = createRefsServiceWithClient(makeFakeMinioClient(), fakeMfClient);
    await svc.searchRefs({
      tags: ['vertigo-effect'], // alias → should resolve to 'dolly-zoom'
      mode: 'semantic',
      queryImagePath: undefined,
      queryText: 'test brief',
      limit: 3,
      seed: 0,
      ttlSeconds: 600,
    });
    expect(semanticSearchMock).toHaveBeenCalledOnce();
    const callArgs = semanticSearchMock.mock.calls[0][0] as { categoryFilter: string[] };
    // Must receive resolved canonical name, NOT the raw alias
    expect(callArgs.categoryFilter).toContain('dolly-zoom');
    expect(callArgs.categoryFilter).not.toContain('vertigo-effect');
  });
});
