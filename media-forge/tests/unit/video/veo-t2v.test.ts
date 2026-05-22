import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { generateVideoT2V } from '../../../src/video/veo-t2v.js';
import { ApiError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { GenerateVideoT2VInputT } from '../../../src/video/video-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

function makeInput(overrides: Partial<GenerateVideoT2VInputT> = {}): GenerateVideoT2VInputT {
  return {
    op: 't2v',
    model: 'veo-3.1-generate-preview',
    prompt: 'A dog running on the beach',
    aspectRatio: '16:9',
    durationSeconds: 8,
    resolution: '720p',
    generateAudio: true,
    personGeneration: 'allow_all',
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

describe('generateVideoT2V', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    mock = createMockGenAI();
  });

  it('happy path: returns operationName from mock operation', async () => {
    mock.queueVideoOperation('op-1');
    const result = await generateVideoT2V(makeInput(), makeClient(mock));
    expect(result.operationName).toBe('op-1');
    expect(result.modelUsed).toBe('veo-3.1-generate-preview');
    expect(result.dryRun).toBeUndefined();
  });

  it('config forwarding: mock called with all 7 config fields', async () => {
    mock.queueVideoOperation('op-2');
    await generateVideoT2V(makeInput(), makeClient(mock));
    const call = mock.recordedCalls[0];
    expect(call).toBeDefined();
    const args = call!.args as {
      model: string;
      prompt: string;
      config: Record<string, unknown>;
    };
    expect(args.config.aspectRatio).toBe('16:9');
    expect(args.config.durationSeconds).toBe(8);
    expect(args.config.resolution).toBe('720p');
    expect(args.config.personGeneration).toBe('allow_all');
    expect(args.config.numberOfVideos).toBe(1);
    expect(args.config.generateAudio).toBe(true);
  });

  it('seed=42 → mock config.seed === 42', async () => {
    mock.queueVideoOperation('op-seed');
    await generateVideoT2V(makeInput({ seed: 42 }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.seed).toBe(42);
  });

  it('negativePrompt → forwarded to config', async () => {
    mock.queueVideoOperation('op-neg');
    await generateVideoT2V(makeInput({ negativePrompt: 'no rain' }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.negativePrompt).toBe('no rain');
  });

  it('operation with no name → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateVideos').mockResolvedValueOnce({
      name: undefined,
      done: false,
    });
    await expect(generateVideoT2V(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(ApiError);
  });

  it('dryRun=true → returns dryRun:true WITHOUT calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateVideos');
    const result = await generateVideoT2V(makeInput(), makeClient(mock, true));
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.operationName).toBe('dry-run-op');
    expect(result.rawPayload).toBeDefined();
  });
});
