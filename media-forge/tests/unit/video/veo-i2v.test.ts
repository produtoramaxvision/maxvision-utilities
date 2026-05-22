import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GoogleGenAI } from '@google/genai';
import { generateVideoI2V } from '../../../src/video/veo-i2v.js';
import { FileSystemError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { GenerateVideoI2VInputT } from '../../../src/video/video-schemas.js';
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

function makeInput(
  overrides: Partial<GenerateVideoI2VInputT> & { firstFrameImage?: string } = {},
): GenerateVideoI2VInputT {
  return {
    op: 'i2v',
    model: 'veo-3.1-generate-preview',
    prompt: 'A cat jumping',
    firstFrameImage: makeFakePng('frame.png'),
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

describe('generateVideoI2V', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i2v-test-'));
    mock = createMockGenAI();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('happy path: returns operationName', async () => {
    mock.queueVideoOperation('op-i2v-1');
    const result = await generateVideoI2V(makeInput(), makeClient(mock));
    expect(result.operationName).toBe('op-i2v-1');
    expect(result.modelUsed).toBe('veo-3.1-generate-preview');
    expect(result.dryRun).toBeUndefined();
  });

  it('mock called with image at TOP LEVEL (not inside config)', async () => {
    mock.queueVideoOperation('op-i2v-2');
    await generateVideoI2V(makeInput(), makeClient(mock));
    const call = mock.recordedCalls[0];
    expect(call).toBeDefined();
    const args = call!.args as Record<string, unknown>;
    // image must be a top-level key
    expect(args.image).toBeDefined();
    expect(args.image).toHaveProperty('imageBytes');
    expect(args.image).toHaveProperty('mimeType', 'image/png');
    // config must NOT have an image key
    const config = args.config as Record<string, unknown>;
    expect(config.image).toBeUndefined();
  });

  it('personGeneration=allow_adult forwarded to config (vertex mode)', async () => {
    mock.queueVideoOperation('op-i2v-3');
    await generateVideoI2V(
      makeInput({ personGeneration: 'allow_adult' }),
      { mode: 'vertex', dryRun: false, ai: mock.client as unknown as GoogleGenAI },
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.personGeneration).toBe('allow_adult');
  });

  it('gemini mode strips personGeneration and generateAudio from payload', async () => {
    mock.queueVideoOperation('op-i2v-gemini');
    await generateVideoI2V(makeInput(), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.personGeneration).toBeUndefined();
    expect(args.config.generateAudio).toBeUndefined();
    expect(args.config.aspectRatio).toBe('16:9');
    expect(args.config.numberOfVideos).toBe(1);
  });

  it('dryRun=true → returns dryRun:true WITHOUT calling SDK or reading disk', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateVideos');
    // Use a non-existent path — dryRun must not attempt file read
    const result = await generateVideoI2V(
      makeInput({ firstFrameImage: '/nonexistent/frame.png' }),
      makeClient(mock, true),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.operationName).toBe('dry-run-op');
  });

  it('firstFrameImage path does not exist → throws FileSystemError', async () => {
    await expect(
      generateVideoI2V(makeInput({ firstFrameImage: '/no/such/file.png' }), makeClient(mock)),
    ).rejects.toBeInstanceOf(FileSystemError);
  });
});
