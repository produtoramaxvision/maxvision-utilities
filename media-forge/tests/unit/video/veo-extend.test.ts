import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { extendVideo, buildExtensionPrompt } from '../../../src/video/veo-extend.js';
import { ApiError, ValidationError } from '../../../src/core/errors.js';
import { createMockGenAI } from '../../helpers/mock-genai.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

function makeClient(mock: ReturnType<typeof createMockGenAI>, dryRun = false): MediaForgeClient {
  return {
    mode: 'gemini',
    dryRun,
    ai: mock.client as unknown as GoogleGenAI,
  };
}

describe('buildExtensionPrompt', () => {
  it('original text appears verbatim in output (>=80% preservation)', () => {
    const original = 'A serene forest at dawn with birds chirping';
    const directive = 'Pan the camera slowly to the right';
    const result = buildExtensionPrompt(original, directive);

    // Original text must appear verbatim
    expect(result).toContain(original);
    // Directive must appear
    expect(result).toContain(directive);
    // Continuation prefix present
    expect(result).toContain('Continuation:');
    // Tone consistency line present
    expect(result).toContain('Keep the same color palette, subject, and tone.');
  });
});

describe('extendVideo', () => {
  let mock: ReturnType<typeof createMockGenAI>;

  beforeEach(() => {
    mock = createMockGenAI();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hopIndex=0 happy → config.resolution=720p, durationSeconds=7', async () => {
    mock.queueVideoOperation('op-extend-1');
    const result = await extendVideo({
      client: makeClient(mock),
      sourceVideoUri: 'https://example.com/source.mp4',
      sourceMimeType: 'video/mp4',
      originalPrompt: 'A mountain landscape',
      extensionDirective: 'Zoom out slowly',
      hopIndex: 0,
    });
    expect(result.operationName).toBe('op-extend-1');
    expect(result.hopIndex).toBe(0);
    expect(result.forcedResolution).toBe('720p');
    expect(result.modelUsed).toBe('veo-3.1-generate-preview');

    const call = mock.recordedCalls[0];
    const args = call!.args as { config: Record<string, unknown> };
    expect(args.config.resolution).toBe('720p');
    expect(args.config.durationSeconds).toBe(7);
  });

  it('hopIndex=20 → throws ValidationError', async () => {
    await expect(
      extendVideo({
        client: makeClient(mock),
        sourceVideoUri: 'https://example.com/source.mp4',
        sourceMimeType: 'video/mp4',
        originalPrompt: 'test',
        extensionDirective: 'extend',
        hopIndex: 20,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('hopIndex=-1 → throws ValidationError', async () => {
    await expect(
      extendVideo({
        client: makeClient(mock),
        sourceVideoUri: 'https://example.com/source.mp4',
        sourceMimeType: 'video/mp4',
        originalPrompt: 'test',
        extensionDirective: 'extend',
        hopIndex: -1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('video at top level (NOT inside config) — verify mock call shape', async () => {
    mock.queueVideoOperation('op-extend-top');
    await extendVideo({
      client: makeClient(mock),
      sourceVideoUri: 'https://example.com/source.mp4',
      sourceMimeType: 'video/mp4',
      originalPrompt: 'A seaside cliff',
      extensionDirective: 'Tilt up to show the sky',
      hopIndex: 3,
    });
    const call = mock.recordedCalls[0];
    const args = call!.args as Record<string, unknown>;
    // video must be a top-level key
    expect(args.video).toBeDefined();
    const video = args.video as Record<string, unknown>;
    expect(video.uri).toBe('https://example.com/source.mp4');
    expect(video.mimeType).toBe('video/mp4');
    // config must NOT have a video key
    const config = args.config as Record<string, unknown>;
    expect(config.video).toBeUndefined();
  });

  it('dryRun=true → returns dryRun:true WITHOUT calling SDK', async () => {
    const spy = vi.spyOn(mock.client.models, 'generateVideos');
    const result = await extendVideo({
      client: makeClient(mock, true),
      sourceVideoUri: 'https://example.com/source.mp4',
      sourceMimeType: 'video/mp4',
      originalPrompt: 'A valley view',
      extensionDirective: 'Fade to black',
      hopIndex: 5,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.operationName).toBe('dry-run-op');
    expect(result.hopIndex).toBe(5);
    expect(result.forcedResolution).toBe('720p');
  });

  it('operation no name → throws ApiError', async () => {
    vi.spyOn(mock.client.models, 'generateVideos').mockResolvedValueOnce({
      name: undefined,
      done: false,
    });
    await expect(
      extendVideo({
        client: makeClient(mock),
        sourceVideoUri: 'https://example.com/source.mp4',
        sourceMimeType: 'video/mp4',
        originalPrompt: 'test',
        extensionDirective: 'extend',
        hopIndex: 1,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
