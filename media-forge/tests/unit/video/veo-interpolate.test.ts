import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GoogleGenAI } from '@google/genai';
import { generateVideoInterpolate } from '../../../src/video/veo-interpolate.js';
import { ApiError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { GenerateVideoInterpolateInputT } from '../../../src/video/video-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// Minimal valid PNG bytes (1x1 pixel)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let tmpDir: string;

function makeFakeFile(name: string, content = TINY_PNG): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

function makeInput(
  overrides: Partial<GenerateVideoInterpolateInputT> = {},
): GenerateVideoInterpolateInputT {
  return {
    op: 'interpolate',
    model: 'veo-3.1-generate-preview',
    prompt: 'Camera pans across a mountain valley',
    firstFrameImage: makeFakeFile('first.png'),
    lastFrameImage: makeFakeFile('last.png'),
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

describe('generateVideoInterpolate', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interpolate-test-'));
    mock = createMockGenAI();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('happy path: returns operationName', async () => {
    mock.queueVideoOperation('op-interp-1');
    const result = await generateVideoInterpolate(makeInput(), makeClient(mock));
    expect(result.operationName).toBe('op-interp-1');
    expect(result.modelUsed).toBe('veo-3.1-generate-preview');
    expect(result.dryRun).toBeUndefined();
  });

  it('image at top level AND config.lastFrame both present', async () => {
    mock.queueVideoOperation('op-interp-2');
    const firstPath = makeFakeFile('first2.png');
    const lastPath = makeFakeFile('last2.png');
    await generateVideoInterpolate(
      makeInput({ firstFrameImage: firstPath, lastFrameImage: lastPath }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    expect(call).toBeDefined();
    const args = call!.args as Record<string, unknown>;

    // Top-level image key
    expect(args.image).toBeDefined();
    expect(args.image).toHaveProperty('imageBytes');
    expect(args.image).toHaveProperty('mimeType', 'image/png');

    // config.lastFrame key
    const config = args.config as Record<string, unknown>;
    expect(config.lastFrame).toBeDefined();
    const lastFrame = config.lastFrame as Record<string, unknown>;
    expect(lastFrame.imageBytes).toBeDefined();
    expect(lastFrame.mimeType).toBe('image/png');
  });

  it('lastFrame mime derived from extension', async () => {
    // Create a JPEG-named file to verify mime detection
    const firstPath = makeFakeFile('first3.png');
    // Write a tiny valid JPEG-named file (content doesn't matter for mime detection)
    const lastPath = path.join(tmpDir, 'last3.jpg');
    fs.writeFileSync(lastPath, TINY_PNG);

    mock.queueVideoOperation('op-interp-3');
    await generateVideoInterpolate(
      makeInput({ firstFrameImage: firstPath, lastFrameImage: lastPath }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as Record<string, unknown>;
    const config = args.config as Record<string, unknown>;
    const lastFrame = config.lastFrame as Record<string, unknown>;
    expect(lastFrame.mimeType).toBe('image/jpeg');
  });

  it('dryRun=true → returns dryRun:true WITHOUT calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateVideos');
    const result = await generateVideoInterpolate(
      makeInput({ firstFrameImage: '/no/first.png', lastFrameImage: '/no/last.png' }),
      makeClient(mock, true),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.operationName).toBe('dry-run-op');
  });

  it('operation with no name → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateVideos').mockResolvedValueOnce({
      name: undefined,
      done: false,
    });
    await expect(generateVideoInterpolate(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('gemini mode strips personGeneration and generateAudio from payload', async () => {
    mock.queueVideoOperation('op-interp-gemini');
    await generateVideoInterpolate(makeInput(), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.personGeneration).toBeUndefined();
    expect(args.config.generateAudio).toBeUndefined();
    expect(args.config.aspectRatio).toBe('16:9');
    expect(args.config.numberOfVideos).toBe(1);
  });
});
