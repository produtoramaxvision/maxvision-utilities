// src/video/providers/higgsfield-soul-cli.ts
// T6 — Soul-ID training and listing through the Higgsfield CLI.
//
// Soul IDs are trained character references: you upload 5–20 photos of a person
// and Higgsfield returns an id that later generations use to keep that person
// consistent across shots. The local cache (migrations/sqlite/002-soul-ids.sql,
// src/core/soul-id-cache.ts) already existed with no way to populate it — this
// is what fills it.
//
// Every flag below was read off `higgsfield 1.1.20` on 2026-07-30 via
// `higgsfield soul-id --help` and `higgsfield soul-id create --help`, not from
// documentation.
//
// Subcommands: create | get | list | wait. Used here: create and list.
//
//   soul-id create --name string          character name (required)
//                  --image stringArray    upload UUID or local path (repeatable, 5–20)
//                  --soul-2               train Soul 2.0 model
//                  --soul-cinematic       train Soul Cinematic model
//   soul-id list                          existing references
//
// The 5–20 bound is the CLI's own, quoted verbatim in its help text. It is
// enforced locally as well so a caller learns before uploading twenty files and
// waiting on a round trip that rejects them.

import { ApiError, ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import type { CliResult, CliRunner } from './higgsfield-cli.js';

/** The two trainable Soul variants the CLI exposes. */
export const SOUL_VARIANTS = ['soul-2', 'soul-cinematic'] as const;
export type SoulVariant = (typeof SOUL_VARIANTS)[number];

/** From the CLI's own help text: "(repeatable, 5–20)". */
export const SOUL_MIN_IMAGES = 5;
export const SOUL_MAX_IMAGES = 20;

const SOUL_TIMEOUT_MS = 5 * 60 * 1000;

export interface SoulIdTrainInput {
  readonly name: string;
  readonly imagePaths: ReadonlyArray<string>;
  readonly variant: SoulVariant;
}

export interface SoulIdRecordFromCli {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

/**
 * Validates against the CLI's published bounds before spending an upload.
 *
 * Uploading twenty images and then being rejected costs bandwidth and time on
 * every attempt; the bound is documented, so there is no reason to learn it from
 * the server.
 */
export function assertSoulImageCount(imagePaths: ReadonlyArray<string>): void {
  if (imagePaths.length < SOUL_MIN_IMAGES || imagePaths.length > SOUL_MAX_IMAGES) {
    throw new ValidationError(
      `Soul-ID training needs between ${SOUL_MIN_IMAGES} and ${SOUL_MAX_IMAGES} images ` +
        `(got ${imagePaths.length}). This is the higgsfield CLI's own bound, enforced here ` +
        `so the upload is not spent on a request that will be refused.`,
    );
  }
}

/** Builds the argv. Discrete elements, never a joined string — see higgsfield-cli.ts. */
export function buildSoulTrainArgs(input: SoulIdTrainInput): string[] {
  assertSoulImageCount(input.imagePaths);

  const args = ['soul-id', 'create', '--name', input.name, `--${input.variant}`];
  for (const path of input.imagePaths) {
    args.push('--image', path);
  }
  args.push('--json');
  return args;
}

/**
 * Starts a Soul-ID training run and returns the provisional id.
 *
 * Returns as soon as the CLI accepts the job rather than blocking on training,
 * which takes minutes. Callers poll with `higgsfield soul-id wait` or the list
 * reconciliation below.
 */
export async function trainSoulId(
  runner: CliRunner,
  input: SoulIdTrainInput,
): Promise<SoulIdRecordFromCli> {
  const result = await runner(buildSoulTrainArgs(input), SOUL_TIMEOUT_MS);
  assertOk(result, 'soul-id create');

  const parsed = parseSoul(result, 'a trained Soul id');
  const id = parsed.id ?? parsed.soul_id;
  if (id === undefined) {
    throw new ApiError(
      `higgsfield soul-id create returned no id: ${result.stdout.slice(0, 200)}`,
      'API',
      { provider: 'higgsfield-cli' },
    );
  }

  logger.info('higgsfield-cli: soul-id training started', { id, name: input.name });
  return { id, name: input.name, status: parsed.status ?? 'training' };
}

/** Lists the Soul IDs the account actually holds. A read; spends nothing. */
export async function listRemoteSoulIds(runner: CliRunner): Promise<SoulIdRecordFromCli[]> {
  const result = await runner(['soul-id', 'list', '--json'], SOUL_TIMEOUT_MS);
  assertOk(result, 'soul-id list');

  // Wrapped like every other parse in this module. A bare JSON.parse here would
  // throw a context-free SyntaxError, discarding the stdout that says WHY it
  // failed — typically an auth prompt or an error banner printed as plain text.
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new ApiError(
      `could not parse the Soul-ID listing from the higgsfield CLI: ` +
        `${result.stdout.slice(0, 400)}`,
      'API',
      { provider: 'higgsfield-cli' },
    );
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed as { items?: unknown[] }).items ?? []);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r['id'] ?? r['soul_id'] ?? ''),
    name: String(r['name'] ?? ''),
    status: String(r['status'] ?? 'unknown'),
  }));
}

/**
 * Compares the local cache against what the account actually holds.
 *
 * Deliberately reports rather than mutates. A Soul ID missing remotely might
 * have been deleted in the web app, or the listing might be paginated, or the
 * call might have hit the wrong workspace — deleting local rows on that evidence
 * would discard training the user paid for. The caller decides.
 */
export function reconcileSoulIds(args: {
  readonly local: ReadonlyArray<{ id: string; characterName: string }>;
  readonly remote: ReadonlyArray<SoulIdRecordFromCli>;
}): {
  readonly inBoth: string[];
  readonly localOnly: string[];
  readonly remoteOnly: string[];
} {
  const remoteIds = new Set(args.remote.map((r) => r.id));
  const localIds = new Set(args.local.map((l) => l.id));

  return {
    inBoth: [...localIds].filter((id) => remoteIds.has(id)),
    localOnly: [...localIds].filter((id) => !remoteIds.has(id)),
    remoteOnly: [...remoteIds].filter((id) => !localIds.has(id)),
  };
}

function assertOk(result: CliResult, what: string): void {
  if (result.exitCode !== 0) {
    throw new ApiError(
      `higgsfield ${what} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`,
      'API',
      { provider: 'higgsfield-cli' },
    );
  }
}

function parseSoul(
  result: CliResult,
  what: string,
): { id?: string; soul_id?: string; status?: string } {
  try {
    return JSON.parse(result.stdout) as { id?: string; soul_id?: string; status?: string };
  } catch {
    throw new ApiError(
      `could not parse ${what} from the higgsfield CLI: ${result.stdout.slice(0, 400)}`,
      'API',
      { provider: 'higgsfield-cli' },
    );
  }
}
