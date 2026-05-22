import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { generateImageNanoBananaPro } from '../../../src/image/nano-banana-pro.js';
import { SafetyBlockError, ApiError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { NanoBananaProInputT } from '../../../src/image/image-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

function makeInput(overrides: Partial<NanoBananaProInputT> = {}): NanoBananaProInputT {
  return {
    op: 'nano-banana-pro',
    model: 'gemini-3-pro-image-preview',
    prompt: 'A leather handbag',
    aspectRatio: '1:1',
    imageSize: '4K',
    personGeneration: 'ALLOW_ADULT',
    referenceImages: [],
    useGoogleSearch: false,
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

describe('generateImageNanoBananaPro', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    mock = createMockGenAI();
  });

  it('happy path: returns base64 and mimeType from inlineData', async () => {
    mock.queueImageResponse({ base64: 'AAAA', mimeType: 'image/png' });
    const result = await generateImageNanoBananaPro(makeInput(), makeClient(mock));
    expect(result.base64).toBe('AAAA');
    expect(result.mimeType).toBe('image/png');
    expect(result.modelUsed).toBe('gemini-3-pro-image-preview');
    expect(result.finishReason).toBe('STOP');
  });

  it('reference images: 3 refs → call.contents has 3 inlineData parts + 1 text part', async () => {
    mock.queueImageResponse({ base64: 'BBBB', mimeType: 'image/png' });
    // Write 3 tiny fake PNG files to temp paths
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = join(tmpdir(), 'nbp-test-refs');
    mkdirSync(dir, { recursive: true });
    const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const paths = [join(dir, 'ref1.png'), join(dir, 'ref2.png'), join(dir, 'ref3.png')];
    paths.forEach(p => writeFileSync(p, buf));

    await generateImageNanoBananaPro(
      makeInput({ referenceImages: paths.map(p => ({ path: p, roleLabel: 'ref' })) }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    expect(call).toBeDefined();
    const args = call!.args as { contents: unknown[] };
    // 1 text + 3 inlineData
    expect(args.contents).toHaveLength(4);
  });

  it('thinkingLevel=HIGH → call.config.thinkingConfig.thinkingLevel === "HIGH"', async () => {
    mock.queueImageResponse({ base64: 'CC', mimeType: 'image/png' });
    await generateImageNanoBananaPro(makeInput({ thinkingLevel: 'HIGH' }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { thinkingConfig: { thinkingLevel: string } } };
    expect(args.config.thinkingConfig.thinkingLevel).toBe('HIGH');
  });

  it('thinkingBudget=1000 → call.config.thinkingConfig.thinkingBudget === 1000', async () => {
    mock.queueImageResponse({ base64: 'DD', mimeType: 'image/png' });
    await generateImageNanoBananaPro(makeInput({ thinkingBudget: 1000 }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { thinkingConfig: { thinkingBudget: number } } };
    expect(args.config.thinkingConfig.thinkingBudget).toBe(1000);
  });

  it('useGoogleSearch=true → call.config.tools contains googleSearch', async () => {
    mock.queueImageResponse({ base64: 'EE', mimeType: 'image/png' });
    await generateImageNanoBananaPro(makeInput({ useGoogleSearch: true }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { tools: unknown[] } };
    expect(args.config.tools).toBeDefined();
    expect(args.config.tools).toContainEqual({ googleSearch: {} });
  });

  it('promptFeedback.blockReason=SAFETY → throws SafetyBlockError', async () => {
    mock.queueSafetyBlock();
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      SafetyBlockError,
    );
  });

  it('finishReason=SAFETY → throws SafetyBlockError', async () => {
    // Override generateContent to return SAFETY finishReason
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
    });
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      SafetyBlockError,
    );
  });

  it('finishReason=IMAGE_SAFETY → throws SafetyBlockError', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }],
    });
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      SafetyBlockError,
    );
  });

  it('finishReason=PROHIBITED_CONTENT → throws SafetyBlockError', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [{ finishReason: 'PROHIBITED_CONTENT', content: { parts: [] } }],
    });
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      SafetyBlockError,
    );
  });

  it('finishReason=OTHER (non-safety) → throws ApiError (NOT SafetyBlockError)', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [{ finishReason: 'OTHER', content: { parts: [] } }],
    });
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && !(e instanceof SafetyBlockError),
    );
  });

  it('no candidate returned → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [],
    });
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('no inlineData in parts → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateContent').mockResolvedValueOnce({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: 'some text' }] },
        },
      ],
    });
    await expect(generateImageNanoBananaPro(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('dryRun=true → returns dryRun:true without calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateContent');
    const result = await generateImageNanoBananaPro(makeInput(), makeClient(mock, true));
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.finishReason).toBe('DRY_RUN');
    expect(result.base64).toBe('');
  });
});
