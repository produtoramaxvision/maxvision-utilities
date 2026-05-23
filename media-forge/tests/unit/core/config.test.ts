import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../../src/core/config.js';
import { ConfigError } from '../../../src/core/errors.js';

const BASE_ENV = {
  GOOGLE_API_KEY: 'AIzaSyTEST',
  GOOGLE_CLOUD_LOCATION: 'us-central1',
};

describe('loadConfig validation', () => {
  it('accepts empty env for dry-run / --help / doctor paths (credential check deferred to createClient)', () => {
    const c = loadConfig({});
    expect(c.apiKey).toBeUndefined();
    expect(c.useVertex).toBe(false);
  });

  it('throws ConfigError when Vertex mode without project', () => {
    expect(() =>
      loadConfig({ GOOGLE_GENAI_USE_VERTEXAI: 'true' }),
    ).toThrow(ConfigError);
  });

  it('accepts GOOGLE_API_KEY', () => {
    const c = loadConfig({ GOOGLE_API_KEY: 'key1' });
    expect(c.apiKey).toBe('key1');
    expect(c.useVertex).toBe(false);
  });

  it('accepts GEMINI_API_KEY as fallback', () => {
    const c = loadConfig({ GEMINI_API_KEY: 'gemkey' });
    expect(c.apiKey).toBe('gemkey');
  });

  it('GOOGLE_API_KEY takes precedence over GEMINI_API_KEY', () => {
    const c = loadConfig({ GOOGLE_API_KEY: 'gkey', GEMINI_API_KEY: 'gemkey' });
    expect(c.apiKey).toBe('gkey');
  });

  it('accepts Vertex AI mode with project', () => {
    const c = loadConfig({
      GOOGLE_GENAI_USE_VERTEXAI: 'true',
      GOOGLE_CLOUD_PROJECT: 'my-project',
    });
    expect(c.useVertex).toBe(true);
    expect(c.project).toBe('my-project');
  });
});

describe('loadConfig defaults', () => {
  it('applies sensible defaults when only API key given', () => {
    const c = loadConfig({ ...BASE_ENV });
    expect(c.location).toBe('us-central1');
    expect(c.outputDir).toBe('./outputs');
    expect(c.projectDir).toBe('./.media-forge');
    expect(c.logLevel).toBe('info');
    expect(c.logFormat).toBe('json');
    expect(c.dryRun).toBe(false);
    expect(c.pollIntervalMs).toBe(10000);
    expect(c.pollMaxAttempts).toBe(90);
    expect(c.dailyCapUsd).toBe(25);
    expect(c.confirmThresholdUsd).toBe(0.5);
    expect(c.blockThresholdUsd).toBe(2.0);
    expect(c.retryBudgetMultiplier).toBe(3);
    expect(c.showRetryBudget).toBe(true);
    expect(c.ocrBackend).toBe('cloud-vision');
    expect(c.reviewThreshold).toBe(7.5);
    expect(c.maxFixAttempts).toBe(3);
    expect(c.skipOcrWhenNoTextIntent).toBe(true);
  });

  it('respects env overrides for numbers + bools + enums', () => {
    const c = loadConfig({
      ...BASE_ENV,
      MEDIA_FORGE_LOG_LEVEL: 'debug',
      MEDIA_FORGE_LOG_FORMAT: 'pretty',
      MEDIA_FORGE_DRY_RUN: 'true',
      MEDIA_FORGE_POLL_INTERVAL_MS: '5000',
      MEDIA_FORGE_POLL_MAX_ATTEMPTS: '60',
      MEDIA_FORGE_DAILY_CAP_USD: '10.5',
      MEDIA_FORGE_OCR: 'paddleocr-wasm',
      MEDIA_FORGE_REVIEW_THRESHOLD: '8.0',
    });
    expect(c.logLevel).toBe('debug');
    expect(c.logFormat).toBe('pretty');
    expect(c.dryRun).toBe(true);
    expect(c.pollIntervalMs).toBe(5000);
    expect(c.pollMaxAttempts).toBe(60);
    expect(c.dailyCapUsd).toBe(10.5);
    expect(c.ocrBackend).toBe('paddleocr-wasm');
    expect(c.reviewThreshold).toBe(8.0);
  });

  it('falls back to default on invalid enum', () => {
    const c = loadConfig({ ...BASE_ENV, MEDIA_FORGE_LOG_LEVEL: 'bogus' });
    expect(c.logLevel).toBe('info');
  });

  it('falls back to default on invalid number', () => {
    const c = loadConfig({ ...BASE_ENV, MEDIA_FORGE_POLL_INTERVAL_MS: 'not-a-number' });
    expect(c.pollIntervalMs).toBe(10000);
  });

  it('config object is frozen', () => {
    const c = loadConfig({ ...BASE_ENV });
    expect(Object.isFrozen(c)).toBe(true);
  });
});
