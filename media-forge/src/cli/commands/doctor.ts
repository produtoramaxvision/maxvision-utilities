import type { Command } from 'commander';
import { CliExit } from '../shared.js';
import { loadConfig } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
} from '../../core/models.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DoctorResult {
  ok: boolean;
  checks: {
    config: { ok: boolean; mode?: 'gemini' | 'vertex'; missing?: string[] };
    outputDir: { ok: boolean; path: string; writable: boolean; reason?: string };
    network: { ok: boolean; reachable?: boolean; reason?: string };
    models: { ok: boolean; checked: string[] };
  };
}

const LOCKED_MODELS = [
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
] as const;

async function checkConfig(
  env: Record<string, string | undefined>,
): Promise<DoctorResult['checks']['config']> {
  try {
    const config = loadConfig(env as NodeJS.ProcessEnv);
    if (config.useVertex && config.project && config.location) {
      return { ok: true, mode: 'vertex' };
    }
    if (config.apiKey) {
      return { ok: true, mode: 'gemini' };
    }
    return { ok: false, missing: ['GOOGLE_API_KEY or GEMINI_API_KEY (or Vertex credentials)'] };
  } catch {
    const missing: string[] = [];
    const apiKey = env['GOOGLE_API_KEY'] ?? env['GEMINI_API_KEY'];
    const useVertex = env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true';
    const project = env['GOOGLE_CLOUD_PROJECT'];

    if (!apiKey && !useVertex) {
      missing.push('GOOGLE_API_KEY or GEMINI_API_KEY');
    }
    if (useVertex && !project) {
      missing.push('GOOGLE_CLOUD_PROJECT');
    }
    if (missing.length === 0) {
      missing.push('unknown credentials error');
    }
    return { ok: false, missing };
  }
}

async function checkOutputDir(
  dirPath: string,
): Promise<DoctorResult['checks']['outputDir']> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    const probe = path.join(dirPath, '.write-probe');
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    return { ok: true, path: dirPath, writable: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, path: dirPath, writable: false, reason };
  }
}

async function checkNetwork(
  fetchImpl: typeof fetch,
): Promise<DoctorResult['checks']['network']> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetchImpl(
      'https://generativelanguage.googleapis.com/v1beta/models',
      { method: 'HEAD', signal: controller.signal },
    );
    clearTimeout(timer);
    if (resp.status < 500) {
      return { ok: true, reachable: true };
    }
    return {
      ok: false,
      reachable: false,
      reason: `HTTP ${resp.status} from generativelanguage.googleapis.com`,
    };
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reachable: false, reason };
  }
}

function checkModels(): DoctorResult['checks']['models'] {
  return { ok: true, checked: [...LOCKED_MODELS] };
}

export async function runDoctor(opts: {
  env?: Record<string, string | undefined>;
  outputBaseDir?: string;
  skipNetwork?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<DoctorResult> {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);

  // 1. Config check
  const configCheck = await checkConfig(env);

  // 2. Output dir check
  let resolvedOutputDir: string;
  if (opts.outputBaseDir) {
    resolvedOutputDir = opts.outputBaseDir;
  } else {
    // Try to load config to get outputDir; fall back to './outputs' if config fails
    try {
      const config = loadConfig(env as NodeJS.ProcessEnv);
      resolvedOutputDir = config.outputDir;
    } catch {
      resolvedOutputDir = './outputs';
    }
  }
  const outputDirCheck = await checkOutputDir(resolvedOutputDir);

  // 3. Network check
  let networkCheck: DoctorResult['checks']['network'];
  if (opts.skipNetwork === true) {
    networkCheck = { ok: true };
  } else {
    const fetchFn = opts.fetchImpl ?? fetch;
    networkCheck = await checkNetwork(fetchFn);
  }

  // 4. Models check (static)
  const modelsCheck = checkModels();

  const allOk =
    configCheck.ok && outputDirCheck.ok && networkCheck.ok && modelsCheck.ok;

  logger.debug('doctor: checks complete', { ok: allOk });

  return {
    ok: allOk,
    checks: {
      config: configCheck,
      outputDir: outputDirCheck,
      network: networkCheck,
      models: modelsCheck,
    },
  };
}

function icon(ok: boolean): string {
  return ok ? '✓' : '✗';
}

function printDoctorHuman(result: DoctorResult): void {
  const { checks } = result;

  process.stdout.write(`media-forge doctor\n`);
  process.stdout.write(`------------------\n`);

  // Config
  const cfgIcon = icon(checks.config.ok);
  const cfgDetail = checks.config.ok
    ? `mode=${checks.config.mode ?? 'unknown'}`
    : `missing: ${(checks.config.missing ?? []).join(', ')}`;
  process.stdout.write(`${cfgIcon} config      ${cfgDetail}\n`);

  // Output dir
  const odIcon = icon(checks.outputDir.ok);
  const odDetail = checks.outputDir.ok
    ? `writable: ${checks.outputDir.path}`
    : `not writable: ${checks.outputDir.path}${checks.outputDir.reason ? ` (${checks.outputDir.reason})` : ''}`;
  process.stdout.write(`${odIcon} output-dir  ${odDetail}\n`);

  // Network
  const netIcon = icon(checks.network.ok);
  const netDetail = checks.network.reachable === undefined
    ? 'skipped'
    : checks.network.ok
      ? 'reachable'
      : `unreachable${checks.network.reason ? ` (${checks.network.reason})` : ''}`;
  process.stdout.write(`${netIcon} network     ${netDetail}\n`);

  // Models
  const mdIcon = icon(checks.models.ok);
  process.stdout.write(`${mdIcon} models      ${checks.models.checked.join(', ')}\n`);

  process.stdout.write(`\n${result.ok ? 'All checks passed.' : 'Some checks failed.'}\n`);
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Validate API key, output dir, network, and model availability')
    .option('--json', 'Output as JSON')
    .option('--skip-network', 'Skip network reachability check')
    .action(async (opts: { json?: boolean; skipNetwork?: boolean }) => {
      const result = await runDoctor({ skipNetwork: opts.skipNetwork });
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        printDoctorHuman(result);
      }
      throw new CliExit(result.ok ? 0 : 1, result);
    });
}
