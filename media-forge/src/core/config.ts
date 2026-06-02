import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigError } from './errors.js';

/**
 * Reads the persisted CLI config written by `media-forge config set` at
 * `~/.media-forge/config.json` (or `$MEDIA_FORGE_CONFIG_HOME/config.json`).
 * Returns an empty object on any read/parse failure so loadConfig keeps
 * working in environments where the file doesn't exist yet.
 */
function readPersistedConfig(): Record<string, unknown> {
  const home = process.env['MEDIA_FORGE_CONFIG_HOME'] || path.join(os.homedir(), '.media-forge');
  const file = path.join(home, 'config.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function pickString(envVal: string | undefined, fileVal: unknown): string | undefined {
  if (envVal !== undefined && envVal.length > 0) return envVal;
  if (typeof fileVal === 'string' && fileVal.length > 0) return fileVal;
  return undefined;
}

function pickBool(envVal: string | undefined, fileVal: unknown, defaultValue: boolean): boolean {
  if (envVal !== undefined) return envVal === 'true' || envVal === '1' || envVal === 'yes';
  if (typeof fileVal === 'boolean') return fileVal;
  return defaultValue;
}

function pickNumber(envVal: string | undefined, fileVal: unknown, defaultValue: number): number {
  if (envVal !== undefined) {
    const n = parseFloat(envVal);
    if (!Number.isNaN(n)) return n;
  }
  if (typeof fileVal === 'number' && !Number.isNaN(fileVal)) return fileVal;
  return defaultValue;
}

function pickEnum<T extends string>(
  envVal: string | undefined,
  fileVal: unknown,
  allowed: readonly T[],
  defaultValue: T,
): T {
  if (envVal !== undefined && (allowed as readonly string[]).includes(envVal)) return envVal as T;
  if (typeof fileVal === 'string' && (allowed as readonly string[]).includes(fileVal)) return fileVal as T;
  return defaultValue;
}

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

  // Refs / MinIO (Phase 1+)
  readonly minioEndpoint: string | undefined;
  readonly minioRegion: string;
  readonly minioBucket: string;
  readonly minioAccessKey: string | undefined;
  readonly minioSecretKey: string | undefined;
  readonly minioUseSsl: boolean;

  // Semantic search (Phase 2)
  readonly voyageApiKey: string | undefined;
  readonly pgvectorUrl: string | undefined;

  // Runtime toggles
  readonly refsEnabled: boolean;
  readonly refMatchEnabled: boolean;
  readonly refMatchThreshold: number;

  // License C1 self-host gating (F-F). Reintroduzidas com consumidor real
  // (src/license/*). Default OFF → modo hosted (B) não é afetado.
  readonly licenseCheckEnabled: boolean;
  readonly licenseServerUrl: string | undefined;
  readonly licenseKey: string | undefined;
  readonly licenseInstanceId: string | undefined;
  readonly licenseRevalidateMs: number;
  readonly licenseGraceMs: number;
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
  // Persisted CLI config (~/.media-forge/config.json written by
  // `media-forge config set`). Env vars always take precedence so existing
  // shell-based workflows are unchanged; the file fills in keys the env
  // omits. See src/cli/commands/config.ts for the writer side.
  const file = readPersistedConfig();

  const apiKey =
    env['GOOGLE_API_KEY'] || env['GEMINI_API_KEY'] || (typeof file['apiKey'] === 'string' ? file['apiKey'] : undefined);
  const useVertex = pickBool(env['GOOGLE_GENAI_USE_VERTEXAI'], file['useVertex'], false);
  const project = pickString(env['GOOGLE_CLOUD_PROJECT'], file['project']);

  // Credential validation is deferred to createClient so that dry-run, --help,
  // --version, and `media-forge doctor` work without auth. createClient throws
  // ConfigError when no credentials are present AND dryRun === false.
  // Vertex misconfig (useVertex without project) is still caught here because
  // it indicates a broken env regardless of dryRun.
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
    location: pickString(env['GOOGLE_CLOUD_LOCATION'], file['location']) ?? 'us-central1',
    outputDir:
      env['MEDIA_FORGE_OUTPUT_DIR'] ||
      (typeof file['outputBaseDir'] === 'string' ? file['outputBaseDir'] : undefined) ||
      './outputs',
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
    ocrBackend: pickEnum(
      env['MEDIA_FORGE_OCR'],
      file['ocrBackend'],
      ['cloud-vision', 'paddleocr-wasm'] as const,
      'cloud-vision',
    ),
    ocrGoogleVisionKey: env['MEDIA_FORGE_OCR_GOOGLE_VISION_KEY'] || undefined,
    reviewThreshold: pickNumber(env['MEDIA_FORGE_REVIEW_THRESHOLD'], file['reviewThreshold'], 7.5),
    maxFixAttempts: pickNumber(env['MEDIA_FORGE_MAX_FIX_ATTEMPTS'], file['maxFixAttempts'], 3),
    skipOcrWhenNoTextIntent: envBool(env, 'MEDIA_FORGE_SKIP_OCR_WHEN_NO_TEXT_INTENT', true),
    region: env['MEDIA_FORGE_REGION'] || undefined,

    // Refs / MinIO (Phase 1+)
    minioEndpoint: envStr(env, 'MINIO_ENDPOINT'),
    minioRegion: envStr(env, 'MINIO_REGION') ?? 'us-east-1',
    minioBucket: envStr(env, 'MINIO_BUCKET') ?? 'media-forge-refs',
    minioAccessKey: envStr(env, 'MINIO_ACCESS_KEY'),
    minioSecretKey: envStr(env, 'MINIO_SECRET_KEY'),
    minioUseSsl: envBool(env, 'MINIO_USE_SSL', true),

    // Semantic search (Phase 2)
    voyageApiKey: envStr(env, 'VOYAGE_API_KEY'),
    pgvectorUrl: envStr(env, 'PGVECTOR_URL'),

    // Runtime toggles
    refsEnabled: envBool(env, 'MEDIA_FORGE_REFS_ENABLED', true),
    refMatchEnabled: envBool(env, 'MEDIA_FORGE_REF_MATCH_ENABLED', false),
    refMatchThreshold: envFloat(env, 'MEDIA_FORGE_REF_MATCH_THRESHOLD', 0.65),

    // License C1 (F-F)
    licenseCheckEnabled: envBool(env, 'LICENSE_CHECK_ENABLED', false),
    licenseServerUrl: envStr(env, 'MAXVISION_LICENSE_SERVER_URL'),
    licenseKey: envStr(env, 'MEDIA_FORGE_LICENSE_KEY'),
    licenseInstanceId: envStr(env, 'MEDIA_FORGE_LICENSE_INSTANCE_ID'),
    licenseRevalidateMs: envInt(env, 'MEDIA_FORGE_LICENSE_REVALIDATE_MS', 3_600_000),
    licenseGraceMs: envInt(env, 'MEDIA_FORGE_LICENSE_GRACE_MS', 259_200_000),
  });
}
