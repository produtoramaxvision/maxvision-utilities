import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createRefsServiceWithClient } from '../../src/refs/refs-service.js';
import type { MinioClient } from '../../src/refs/minio-client.js';
import type { MediaForgeClient } from '../../src/core/client.js';

// ---------------------------------------------------------------------------
// Mock NBP — must return real GenerateImageResult shape.
// base64 is generated at suite init (beforeAll) from a real sharp-encoded JPEG
// so that refs-service.ts:203 `sharp(outputBuf).metadata()` does not throw.
// ---------------------------------------------------------------------------
vi.mock('../../src/image/image-service.js', () => ({
  generateImageNanoBananaPro: vi.fn(),
}));

// Deferred import so vi.mock hoisting takes effect before import resolves.
const { generateImageNanoBananaPro } = await import('../../src/image/image-service.js');
const nbpMock = vi.mocked(generateImageNanoBananaPro);

// ---------------------------------------------------------------------------
// Minimal 1×1 transparent GIF (valid for downloadObject stub)
// ---------------------------------------------------------------------------
function staticGif(): Buffer {
  return Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
}

// ---------------------------------------------------------------------------
// Fake MediaForgeClient — ai is never called because NBP is mocked
// ---------------------------------------------------------------------------
const mockMfClient: MediaForgeClient = {
  mode: 'gemini',
  dryRun: false,
  ai: {} as never,
};

// ---------------------------------------------------------------------------
// Suite lifecycle — temp project dir + valid JPEG base64
// ---------------------------------------------------------------------------
let tempDir: string;
let prevProjectDir: string | undefined;
let fakeJpegBase64: string;

beforeAll(async () => {
  // Build a valid 8×8 JPEG so sharp().metadata() succeeds in refs-service
  const jpegBuf = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 128, g: 64, b: 32 } },
  })
    .jpeg()
    .toBuffer();
  fakeJpegBase64 = jpegBuf.toString('base64');

  // Wire NBP mock with the real base64
  nbpMock.mockResolvedValue({
    base64: fakeJpegBase64,
    mimeType: 'image/jpeg',
    modelUsed: 'nano-banana-pro',
    finishReason: 'STOP',
  });

  // Redirect moodboard output to an isolated temp dir
  tempDir = await mkdtemp(join(tmpdir(), 'mf-int-'));
  prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
  process.env['MEDIA_FORGE_PROJECT_DIR'] = tempDir;
});

afterAll(async () => {
  // Restore env and clean up temp dir
  if (prevProjectDir === undefined) {
    delete process.env['MEDIA_FORGE_PROJECT_DIR'];
  } else {
    process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
  }
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Shared fake MinIO client factory — resets per-test to avoid call-count bleed
// ---------------------------------------------------------------------------
function makeFakeClient(): MinioClient {
  return {
    listObjects: vi.fn(async (prefix: string) => ({
      objects: [
        { key: `${prefix}aaa.gif`, size: 100 },
        { key: `${prefix}bbb.webp`, size: 200 },
      ],
      truncated: false,
    })),
    headObject: vi.fn(),
    presignObject: vi.fn(async (k: string) => `https://signed.example/${k}`),
    downloadObject: vi.fn(async () => staticGif()),
  } as unknown as MinioClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('refs pipeline (mocked)', () => {
  it('search → compose end-to-end with fake S3 + fake NBP', async () => {
    const fakeClient = makeFakeClient();
    const svc = createRefsServiceWithClient(fakeClient, mockMfClient);

    const refs = await svc.searchRefs({
      tags: ['dolly-zoom'],
      mode: 'tag',
      limit: 2,
      seed: 1,
      ttlSeconds: 3000,
    });
    expect(refs.length).toBe(2);
    expect(refs[0].category).toBe('dolly-zoom');

    const moodboard = await svc.composeMoodboardFromKeys({
      refKeys: refs.map((r) => r.objectKey),
      subjectImagePaths: [],
      effectTags: ['dolly-zoom'],
      outputSize: '1024',
    });
    // refs-service writes `moodboard-${Date.now()}.jpg` under MEDIA_FORGE_PROJECT_DIR/moodboards/
    expect(moodboard.outputPath).toMatch(/moodboard-\d+\.jpg$/);
    expect(moodboard.refsUsed.length).toBe(2);
    expect(moodboard.width).toBeGreaterThan(0);
    expect(moodboard.height).toBeGreaterThan(0);
  });

  it('presignKeys is idempotent within TTL (cache hit on second call)', async () => {
    // Fresh client + service so presignObject call count starts at 0
    const fakeClient = makeFakeClient();
    const svc = createRefsServiceWithClient(fakeClient, mockMfClient);

    const a = await svc.presignKeys({ objectKeys: ['dolly-zoom/aaa.gif'], ttlSeconds: 3000 });
    const b = await svc.presignKeys({ objectKeys: ['dolly-zoom/aaa.gif'], ttlSeconds: 3000 });

    // Both calls return the same URL
    expect(a[0].url).toBe(b[0].url);

    // Underlying presignObject called exactly once — second hit came from cache
    const presignCallCount = vi.mocked(fakeClient.presignObject).mock.calls.length;
    expect(presignCallCount).toBe(1);
  });
});
