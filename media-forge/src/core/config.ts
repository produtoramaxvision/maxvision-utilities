import 'dotenv/config';
import { ConfigError } from './errors.js';

export interface MediaForgeConfig {
  readonly apiKey: string | undefined;
  readonly useVertex: boolean;
  readonly project: string | undefined;
  readonly location: string;
  readonly outputDir: string;
  readonly projectDir: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly logFormat: 'json' | 'pretty';
  readonly dryRun: boolean;
  readonly pollIntervalMs: number;
  readonly pollMaxAttempts: number;
  readonly runLiveTests: boolean;
  readonly runEvals: boolean;
  readonly dailyCapUsd: number;
  readonly confirmThresholdUsd: number;
  readonly blockThresholdUsd: number;
  readonly retryBudgetMultiplier: number;
  readonly showRetryBudget: boolean;
  readonly ocrBackend: 'cloud-vision' | 'paddleocr-wasm';
  readonly ocrGoogleVisionKey: string | undefined;
  readonly reviewThreshold: number;
  readonly maxFixAttempts: number;
  readonly skipOcrWhenNoTextIntent: boolean;
  readonly region: string | undefined;
}

function envStr(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return v && v.length > 0 ? v : undefined;
}

function envBool(env: NodeJS.ProcessEnv, name: string, defaultValue: boolean): boolean {
  const v = envStr(env, name);
  if (v === undefined) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes';
}

function envInt(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const v = envStr(env, name);
  if (v === undefined) return defaultValue;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function envFloat(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const v = envStr(env, name);
  if (v === undefined) return defaultValue;
  const n = parseFloat(v);
  return Number.isNaN(n) ? defaultValue : n;
}

function envEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const v = envStr(env, name);
  if (v === undefined) return defaultValue;
  return (allowed as readonly string[]).includes(v) ? (v as T) : defaultValue;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MediaForgeConfig {
  // Read API key with fallback chain
  const apiKey = env['GOOGLE_API_KEY'] || env['GEMINI_API_KEY'] || undefined;
  const useVertex = (env['GOOGLE_GENAI_USE_VERTEXAI'] ?? 'false') === 'true';
  const project = env['GOOGLE_CLOUD_PROJECT'] || undefined;

  // Validate
  if (!apiKey && !useVertex) {
    throw new ConfigError(
      'Missing API key. Set GOOGLE_API_KEY or GEMINI_API_KEY, or enable Vertex AI with GOOGLE_GENAI_USE_VERTEXAI=true.',
      { hasApiKey: false, useVertex },
    );
  }
  if (useVertex && !project) {
    throw new ConfigError(
      'Vertex AI mode requires GOOGLE_CLOUD_PROJECT.',
      { useVertex, hasProject: false },
    );
  }

  return Object.freeze({
    apiKey,
    useVertex,
    project,
    location: env['GOOGLE_CLOUD_LOCATION'] || 'us-central1',
    outputDir: env['MEDIA_FORGE_OUTPUT_DIR'] || './outputs',
    projectDir: env['MEDIA_FORGE_PROJECT_DIR'] || './.media-forge',
    logLevel: envEnum(env, 'MEDIA_FORGE_LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    logFormat: envEnum(env, 'MEDIA_FORGE_LOG_FORMAT', ['json', 'pretty'] as const, 'json'),
    dryRun: envBool(env, 'MEDIA_FORGE_DRY_RUN', false),
    pollIntervalMs: envInt(env, 'MEDIA_FORGE_POLL_INTERVAL_MS', 10000),
    pollMaxAttempts: envInt(env, 'MEDIA_FORGE_POLL_MAX_ATTEMPTS', 90),
    runLiveTests: envBool(env, 'MEDIA_FORGE_RUN_LIVE_TESTS', false),
    runEvals: envBool(env, 'MEDIA_FORGE_RUN_EVALS', false),
    dailyCapUsd: envFloat(env, 'MEDIA_FORGE_DAILY_CAP_USD', 25),
    confirmThresholdUsd: envFloat(env, 'MEDIA_FORGE_CONFIRM_THRESHOLD_USD', 0.5),
    blockThresholdUsd: envFloat(env, 'MEDIA_FORGE_BLOCK_THRESHOLD_USD', 2.0),
    retryBudgetMultiplier: envInt(env, 'MEDIA_FORGE_RETRY_BUDGET_MULTIPLIER', 3),
    showRetryBudget: envBool(env, 'MEDIA_FORGE_SHOW_RETRY_BUDGET', true),
    ocrBackend: envEnum(env, 'MEDIA_FORGE_OCR', ['cloud-vision', 'paddleocr-wasm'] as const, 'cloud-vision'),
    ocrGoogleVisionKey: env['MEDIA_FORGE_OCR_GOOGLE_VISION_KEY'] || undefined,
    reviewThreshold: envFloat(env, 'MEDIA_FORGE_REVIEW_THRESHOLD', 7.5),
    maxFixAttempts: envInt(env, 'MEDIA_FORGE_MAX_FIX_ATTEMPTS', 3),
    skipOcrWhenNoTextIntent: envBool(env, 'MEDIA_FORGE_SKIP_OCR_WHEN_NO_TEXT_INTENT', true),
    region: env['MEDIA_FORGE_REGION'] || undefined,
  });
}
