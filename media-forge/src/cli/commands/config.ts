import type { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { safeJoin } from '../../utils/paths.js';
import { ApiFieldError } from '../../core/errors.js';

// Whitelisted config keys with declared value types. The type drives how
// `config set key=value` coerces the raw string: string-typed keys stay raw
// (e.g. outputBaseDir="2026" must NOT become a number), boolean-typed keys
// accept the string 'true'/'false', number-typed keys parse via Number().
const KEY_TYPES = {
  apiKey: 'string',
  useVertex: 'boolean',
  project: 'string',
  location: 'string',
  outputBaseDir: 'string',
  reviewThreshold: 'number',
  maxFixAttempts: 'number',
  ocrBackend: 'string',
} as const;

const ALLOWED_KEYS = Object.keys(KEY_TYPES) as Array<keyof typeof KEY_TYPES>;

type AllowedKey = (typeof ALLOWED_KEYS)[number];

function isAllowedKey(key: string): key is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

export function getConfigDir(): string {
  const override = process.env['MEDIA_FORGE_CONFIG_HOME'];
  if (override) return override;
  return path.join(os.homedir(), '.media-forge');
}

export function getConfigPath(): string {
  return safeJoin(getConfigDir(), 'config.json');
}

async function readConfig(): Promise<Record<string, unknown>> {
  const configPath = getConfigPath();
  const raw = await fs.readFile(configPath, 'utf8').catch(() => null);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeConfig(data: Record<string, unknown>): Promise<void> {
  const configPath = getConfigPath();
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function configGet(key: string): Promise<unknown> {
  if (!isAllowedKey(key)) {
    throw new ApiFieldError(key, `'${key}' is not a recognized config key`);
  }
  const config = await readConfig();
  return config[key];
}

export async function configSet(keyValue: string): Promise<void> {
  const eqIdx = keyValue.indexOf('=');
  if (eqIdx === -1) {
    throw new ApiFieldError('key', `config set requires key=value format, got '${keyValue}'`);
  }
  const key = keyValue.slice(0, eqIdx);
  const value = keyValue.slice(eqIdx + 1);
  if (!isAllowedKey(key)) {
    throw new ApiFieldError(key, `'${key}' is not a recognized config key`);
  }
  const config = await readConfig();
  // Type-driven coercion: keep strings raw, parse only when the declared
  // type matches. Prevents string-valued keys (e.g. outputBaseDir) from being
  // silently turned into numbers when their value happens to look numeric.
  const expectedType = KEY_TYPES[key];
  let coerced: unknown = value;
  if (expectedType === 'boolean') {
    if (value === 'true') coerced = true;
    else if (value === 'false') coerced = false;
    else {
      throw new ApiFieldError(key, `'${key}' expects boolean 'true' or 'false', got '${value}'`);
    }
  } else if (expectedType === 'number') {
    const n = Number(value);
    if (Number.isNaN(n) || value.trim() === '') {
      throw new ApiFieldError(key, `'${key}' expects a number, got '${value}'`);
    }
    coerced = n;
  } // else: 'string' → keep raw value verbatim

  config[key] = coerced;
  await writeConfig(config);
}

export async function configUnset(key: string): Promise<void> {
  if (!isAllowedKey(key)) {
    throw new ApiFieldError(key, `'${key}' is not a recognized config key`);
  }
  const config = await readConfig();
  delete config[key];
  await writeConfig(config);
}

export function registerConfigCommand(program: Command): void {
  const cfg = program.command('config').description('Read and write persistent config (~/.media-forge/config.json)');

  // get
  cfg
    .command('get')
    .description('Get a config value')
    .argument('<key>', `Config key (allowed: ${ALLOWED_KEYS.join(', ')})`)
    .option('--json', 'Emit JSON')
    .action(async (key: string, opts: { json?: boolean }) => {
      try {
        const value = await configGet(key);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ key, value }, null, 2)}\n`);
        } else {
          process.stdout.write(`${key}: ${value !== undefined ? String(value) : '(not set)'}\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        process.stderr.write(`error: ${msg}\n`);
        process.exit(1);
      }
    });

  // set
  cfg
    .command('set')
    .description('Set a config value (format: key=value)')
    .argument('<keyValue>', 'Key=value pair')
    .option('--json', 'Emit JSON')
    .action(async (keyValue: string, opts: { json?: boolean }) => {
      try {
        await configSet(keyValue);
        const [key] = keyValue.split('=');
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ key, status: 'set' }, null, 2)}\n`);
        } else {
          process.stdout.write(`set: ${key ?? keyValue}\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ error: msg }, null, 2)}\n`);
        } else {
          process.stderr.write(`error: ${msg}\n`);
        }
        process.exit(1);
      }
    });

  // unset
  cfg
    .command('unset')
    .description('Remove a config key')
    .argument('<key>', 'Config key to remove')
    .option('--json', 'Emit JSON')
    .action(async (key: string, opts: { json?: boolean }) => {
      try {
        await configUnset(key);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ key, status: 'unset' }, null, 2)}\n`);
        } else {
          process.stdout.write(`unset: ${key}\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ error: msg }, null, 2)}\n`);
        } else {
          process.stderr.write(`error: ${msg}\n`);
        }
        process.exit(1);
      }
    });
}
