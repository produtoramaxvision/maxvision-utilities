import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { generateImageImagen4Ultra } from '../../../src/image/imagen-4-ultra.js';
import { SafetyBlockError, ApiError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { Imagen4UltraInputT } from '../../../src/image/image-schemas.js';
import type { MediaForgeClient } from '../../../src/core/client.js';
import { logger } from '../../../src/core/logger.js';

function makeInput(overrides: Partial<Imagen4UltraInputT> = {}): Imagen4UltraInputT {
  return {
    op: 'imagen-4-ultra',
    model: 'imagen-4.0-ultra-generate-001',
    prompt: 'A beautiful mountain landscape',
    aspectRatio: '1:1',
    imageSize: '2K',
    numberOfImages: 1,
    personGeneration: 'ALLOW_ADULT',
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

describe('generateImageImagen4Ultra', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    mock = createMockGenAI();
    vi.restoreAllMocks();
  });

  it('happy path: returns base64 and mimeType', async () => {
    mock.queueImagenResponse([{ base64: 'AAAA', mimeType: 'image/png' }]);
    const result = await generateImageImagen4Ultra(makeInput(), makeClient(mock));
    expect(result.base64).toBe('AAAA');
    expect(result.mimeType).toBe('image/png');
    expect(result.modelUsed).toBe('imagen-4.0-ultra-generate-001');
    expect(result.finishReason).toBeUndefined();
  });

  it('seed=42 → SDK config.seed === 42', async () => {
    mock.queueImagenResponse([{ base64: 'BB', mimeType: 'image/png' }]);
    await generateImageImagen4Ultra(makeInput({ seed: 42 }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { seed: number } };
    expect(args.config.seed).toBe(42);
  });

  it('negativePrompt → forwarded to config', async () => {
    mock.queueImagenResponse([{ base64: 'CC', mimeType: 'image/png' }]);
    await generateImageImagen4Ultra(
      makeInput({ negativePrompt: 'no clouds' }),
      makeClient(mock),
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { negativePrompt: string } };
    expect(args.config.negativePrompt).toBe('no clouds');
  });

  it('personGeneration=ALLOW_NONE → SDK config receives DONT_ALLOW (vertex mode)', async () => {
    mock.queueImagenResponse([{ base64: 'DD', mimeType: 'image/png' }]);
    await generateImageImagen4Ultra(
      makeInput({ personGeneration: 'ALLOW_NONE' }),
      { mode: 'vertex', dryRun: false, ai: mock.client as unknown as GoogleGenAI },
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { personGeneration: string } };
    expect(args.config.personGeneration).toBe('DONT_ALLOW');
  });

  it('personGeneration=ALLOW_ADULT → forwarded as-is (vertex mode)', async () => {
    mock.queueImagenResponse([{ base64: 'EE', mimeType: 'image/png' }]);
    await generateImageImagen4Ultra(
      makeInput({ personGeneration: 'ALLOW_ADULT' }),
      { mode: 'vertex', dryRun: false, ai: mock.client as unknown as GoogleGenAI },
    );
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: { personGeneration: string } };
    expect(args.config.personGeneration).toBe('ALLOW_ADULT');
  });

  it('gemini mode strips personGeneration from payload', async () => {
    mock.queueImagenResponse([{ base64: 'GG', mimeType: 'image/png' }]);
    await generateImageImagen4Ultra(makeInput({ personGeneration: 'ALLOW_ADULT' }), makeClient(mock));
    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.personGeneration).toBeUndefined();
  });

  it('raiFilteredReason set → throws SafetyBlockError', async () => {
    vi.spyOn(mock.client.models, 'generateImages').mockResolvedValueOnce({
      generatedImages: [{ raiFilteredReason: 'SAFETY', image: null }],
    });
    await expect(generateImageImagen4Ultra(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      SafetyBlockError,
    );
  });

  it('no generatedImages → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateImages').mockResolvedValueOnce({
      generatedImages: [],
    });
    await expect(generateImageImagen4Ultra(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('no imageBytes in result → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateImages').mockResolvedValueOnce({
      generatedImages: [{ image: { imageBytes: undefined, mimeType: 'image/png' } }],
    });
    await expect(generateImageImagen4Ultra(makeInput(), makeClient(mock))).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it('imageSize=1K set → logger.warn fires', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    mock.queueImagenResponse([{ base64: 'FF', mimeType: 'image/png' }]);
    await generateImageImagen4Ultra(makeInput({ imageSize: '1K' }), makeClient(mock));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('imageSize'),
      expect.objectContaining({ requested: '1K' }),
    );
  });

  it('dryRun=true → returns dry-run shape without calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateImages');
    const result = await generateImageImagen4Ultra(makeInput(), makeClient(mock, true));
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.base64).toBe('');
    // rawPayload must mirror production generateImages shape: {model, prompt, config}
    const payload = result.rawPayload as { model: string; prompt: string; config: { numberOfImages: number; aspectRatio: string } };
    expect(payload.model).toBe('imagen-4.0-ultra-generate-001');
    expect(payload.prompt).toBe('A beautiful mountain landscape');
    expect(payload.config.numberOfImages).toBe(1);
    expect(payload.config.aspectRatio).toBe('1:1');
  });
});
