import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GoogleGenAI } from '@google/genai';
import { generateVideoWithRefs } from '../../../src/video/veo-with-refs.js';
import { ApiError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { GenerateVideoWithRefsInputT } from '../../../src/video/video-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// Minimal valid PNG bytes (1x1 pixel)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let tmpDir: string;

function makeFakePng(name: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, TINY_PNG);
  return p;
}

function makeRefs(count: number): Array<{ path: string; referenceType: 'ASSET' }> {
  return Array.from({ length: count }, (_, i) => ({
    path: makeFakePng(`ref${i}.png`),
    referenceType: 'ASSET' as const,
  }));
}

function makeInput(
  overrides: Partial<GenerateVideoWithRefsInputT> = {},
): GenerateVideoWithRefsInputT {
  return {
    op: 'with-refs',
    model: 'veo-3.1-generate-preview',
    prompt: 'A stylized mountain scene',
    referenceImages: makeRefs(1),
    aspectRatio: '16:9',
    durationSeconds: 8,
    resolution: '720p',
    generateAudio: true,
    personGeneration: 'allow_adult',
    outputDir: './outputs',
    dryRun: false,
    ...overrides,
  };
}

function makeClient(mock: ReturnType<typeof createMockGenAI>, dryRun = false): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun,
    ai: mock.client as unknown as GoogleGenAI,
  };
}

describe('generateVideoWithRefs', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-refs-test-'));
    mock = createMockGenAI();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('happy with 3 refs → config.referenceImages has 3 entries', async () => {
    mock.queueVideoOperation('op-refs-3');
    await generateVideoWithRefs(makeInput({ referenceImages: makeRefs(3) }), makeClient(mock));
    const call = mock.recordedCalls[0];
    expect(call).toBeDefined();
    const args = call!.args as { config: { referenceImages: unknown[] } };
    expect(args.config.referenceImages).toHaveLength(3);
  });

  it('each entry has shape {image: {imageBytes, mimeType}, referenceType: "ASSET"}', async () => {
    mock.queueVideoOperation('op-refs-shape');
    await generateVideoWithRefs(makeInput({ referenceImages: makeRefs(2) }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { referenceImages: Array<Record<string, unknown>> } };
    for (const ref of args.config.referenceImages) {
      expect(ref.referenceType).toBe('ASSET');
      expect(ref.image).toBeDefined();
      const img = ref.image as Record<string, unknown>;
      expect(img.imageBytes).toBeDefined();
      expect(img.mimeType).toBe('image/png');
    }
  });

  it('1-ref boundary → succeeds and returns operationName', async () => {
    mock.queueVideoOperation('op-refs-1');
    const result = await generateVideoWithRefs(
      makeInput({ referenceImages: makeRefs(1) }),
      makeClient(mock),
    );
    expect(result.operationName).toBe('op-refs-1');
    expect(result.modelUsed).toBe('veo-3.1-generate-preview');
  });

  it('dryRun=true → returns dryRun:true WITHOUT calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateVideos');
    const result = await generateVideoWithRefs(
      makeInput({ referenceImages: [{ path: '/no/ref.png', referenceType: 'ASSET' }] }),
      makeClient(mock, true),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.operationName).toBe('dry-run-op');
  });

  it('operation no name → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateVideos').mockResolvedValueOnce({
      name: undefined,
      done: false,
    });
    await expect(
      generateVideoWithRefs(makeInput(), makeClient(mock)),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
