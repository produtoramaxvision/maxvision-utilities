import { describe, it, expect, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { createClient } from '../../../src/core/client.js';
import { ConfigError } from '../../../src/core/errors.js';
import type { MediaForgeConfig } from '../../../src/core/config.js';

// Minimal config factory — only the fields createClient cares about
function makeConfig(overrides: Partial<MediaForgeConfig> = {}): MediaForgeConfig {
  return {
    apiKey: 'test-api-key',
    useVertex: false,
    project: undefined,
    location: 'us-central1',
    outputDir: './outputs',
    projectDir: './.media-forge',
    logLevel: 'info',
    logFormat: 'json',
    dryRun: false,
    pollIntervalMs: 10000,
    pollMaxAttempts: 90,
    runLiveTests: false,
    runEvals: false,
    dailyCapUsd: 25,
    confirmThresholdUsd: 0.5,
    blockThresholdUsd: 2.0,
    retryBudgetMultiplier: 3,
    showRetryBudget: true,
    ocrBackend: 'cloud-vision',
    ocrGoogleVisionKey: undefined,
    reviewThreshold: 7.5,
    maxFixAttempts: 3,
    skipOcrWhenNoTextIntent: true,
    region: undefined,
    ...overrides,
  };
}

// Minimal spy GoogleGenAI class
class SpyGenAI {
  static lastInit: unknown = null;
  models = { generateContent: vi.fn(), generateImages: vi.fn(), generateVideos: vi.fn() };
  operations = { getVideosOperation: vi.fn() };
  files = { download: vi.fn() };

  constructor(init: unknown) {
    SpyGenAI.lastInit = init;
  }
}

describe('createClient', () => {
  it('mode=gemini when apiKey provided', () => {
    const client = createClient({
      config: makeConfig({ apiKey: 'MY_KEY', useVertex: false }),
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    expect(client.mode).toBe('gemini');
    expect(SpyGenAI.lastInit).toMatchObject({ apiKey: 'MY_KEY' });
  });

  it('mode=vertex when useVertex=true and project set', () => {
    const client = createClient({
      config: makeConfig({ apiKey: undefined, useVertex: true, project: 'my-proj', location: 'us-east1' }),
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    expect(client.mode).toBe('vertex');
    expect(SpyGenAI.lastInit).toMatchObject({ vertexai: true, project: 'my-proj', location: 'us-east1' });
  });

  it('throws ConfigError when neither apiKey nor vertex configured', () => {
    expect(() =>
      createClient({
        config: makeConfig({ apiKey: undefined, useVertex: false }),
        _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
      }),
    ).toThrow(ConfigError);
  });

  it('vertex wins when both apiKey and useVertex are set', () => {
    const client = createClient({
      config: makeConfig({ apiKey: 'KEY', useVertex: true, project: 'proj' }),
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    expect(client.mode).toBe('vertex');
  });

  it('dryRun=true → generateContent returns dryRunPayload', async () => {
    const client = createClient({
      config: makeConfig(),
      dryRun: true,
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    expect(client.dryRun).toBe(true);
    const payload = { model: 'test', contents: ['hello'] };
    const result = await (client.ai.models.generateContent as (req: unknown) => Promise<unknown>)(payload);
    expect(result).toMatchObject({ candidates: [], dryRunPayload: payload });
  });

  it('dryRun=true → generateImages returns generatedImages:[] + dryRunPayload', async () => {
    const client = createClient({
      config: makeConfig(),
      dryRun: true,
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    const payload = { model: 'imagen', prompt: 'a cat' };
    const result = await (client.ai.models.generateImages as (req: unknown) => Promise<unknown>)(payload);
    expect(result).toMatchObject({ generatedImages: [], dryRunPayload: payload });
  });

  it('dryRun=false → real SDK instance is used (spy constructor invoked)', () => {
    SpyGenAI.lastInit = null;
    const client = createClient({
      config: makeConfig({ apiKey: 'REAL_KEY' }),
      dryRun: false,
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    expect(SpyGenAI.lastInit).not.toBeNull();
    expect(client.dryRun).toBe(false);
  });

  it('dryRun defaults to false when not provided', () => {
    const client = createClient({
      config: makeConfig(),
      _GoogleGenAIClass: SpyGenAI as unknown as new (init: unknown) => GoogleGenAI,
    });
    expect(client.dryRun).toBe(false);
  });
});
