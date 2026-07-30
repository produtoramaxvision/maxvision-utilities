// src/mcp/handlers/optional-providers.ts
// Entry points for the opt-in providers.
//
// Three adapters shipped tested and unreachable — the same defect the narrative
// planner had. `fallow audit --production` names them, and the fix is the same:
// a tool, or the code is not a feature.
//
//   media_image_codex               T17, the Codex image adapter
//   media_higgsfield_soul_id_train  T6, on the plan's own checklist
//   media_higgsfield_soul_id_list   T6, likewise
//
// T6 is worth calling out: the plan lists both soul-id tools explicitly, the
// soul-id CACHE and its migration have existed since P14, and the CLI module
// landed in PR6 — but nothing ever exposed them. The cache had no way to be
// populated.

import { z } from 'zod';
import { ValidationError } from '../../core/errors.js';
import { defaultDbPath } from './shared.js';
import { createSoulId, listSoulIds } from '../../core/soul-id-cache.js';
import {
  CodexImageProvider,
  CODEX_IMAGE_SIZES,
  resolveCodexImageMode,
} from '../../image/codex-image.js';
import {
  trainSoulId,
  listRemoteSoulIds,
  reconcileSoulIds,
  SOUL_VARIANTS,
  SOUL_MIN_IMAGES,
  SOUL_MAX_IMAGES,
} from '../../video/providers/higgsfield-soul-cli.js';
import type { CliRunner } from '../../video/providers/higgsfield-cli.js';

// ---------------------------------------------------------------------------
// T17 — Codex image generation
// ---------------------------------------------------------------------------

export const CodexImageInput = z.object({
  prompt: z.string().min(1),
  size: z.enum(CODEX_IMAGE_SIZES).default('1024x1024'),
  outputDir: z.string().min(1),
  fileName: z.string().min(1).optional(),
});

export interface CodexImageHandlerOpts {
  readonly provider?: CodexImageProvider;
  /** Set by the hosted server. Blocks the OAuth path — see assertModeAllowed. */
  readonly isMultiTenant?: boolean;
}

export async function handleCodexImage(
  rawInput: unknown,
  opts: CodexImageHandlerOpts = {},
): Promise<{ path: string; mode: string; estimateUsd: number; model: string }> {
  const input = CodexImageInput.parse(rawInput);
  const provider = opts.provider ?? new CodexImageProvider();

  const result = await provider.generate(
    {
      prompt: input.prompt,
      size: input.size,
      outputDir: input.outputDir,
      ...(input.fileName ? { fileName: input.fileName } : {}),
    },
    { isMultiTenant: opts.isMultiTenant ?? false },
  );

  return { ...result, model: 'gpt-image-2' };
}

/** Reports which credential path would run, without generating anything. */
export function codexImageMode(): { mode: string; requiresApiKey: boolean } {
  const mode = resolveCodexImageMode();
  return { mode, requiresApiKey: mode === 'cli' };
}

// ---------------------------------------------------------------------------
// T6 — Higgsfield Soul-ID
// ---------------------------------------------------------------------------

export const SoulIdTrainInput = z.object({
  name: z.string().min(1),
  imagePaths: z.array(z.string().min(1)).min(SOUL_MIN_IMAGES).max(SOUL_MAX_IMAGES),
  variant: z.enum(SOUL_VARIANTS).default('soul-2'),
});

export interface SoulIdHandlerOpts {
  readonly runner?: CliRunner;
  readonly dbPath?: string;
}

/**
 * Trains a Soul-ID and records it locally.
 *
 * The local write happens AFTER the remote call succeeds. Recording first would
 * leave a cache entry for a training run that never started, and nothing
 * downstream distinguishes a real id from a phantom one.
 */
export async function handleSoulIdTrain(
  rawInput: unknown,
  opts: SoulIdHandlerOpts = {},
): Promise<{ id: string; name: string; status: string }> {
  const input = SoulIdTrainInput.parse(rawInput);
  if (opts.runner === undefined) {
    throw new ValidationError(
      'Soul-ID training needs the Higgsfield CLI. Enable it with ' +
        'MEDIA_FORGE_HF_CLI_ENABLED=true and run `higgsfield auth login`.',
    );
  }

  const record = await trainSoulId(opts.runner, {
    name: input.name,
    imagePaths: input.imagePaths,
    variant: input.variant,
  });

  createSoulId({
    dbPath: opts.dbPath ?? defaultDbPath(),
    id: record.id,
    provider: 'higgsfield',
    characterName: input.name,
    assetPaths: input.imagePaths,
  });

  return record;
}

/**
 * Lists Soul-IDs, reconciling the local cache against the account.
 *
 * Reports differences instead of resolving them. A local id missing remotely
 * might have been deleted in the web app, or the listing might be paginated, or
 * the call might have hit a different workspace — deleting cache rows on that
 * evidence would discard a record of training the user paid for.
 */
export async function handleSoulIdList(
  _rawInput: unknown,
  opts: SoulIdHandlerOpts = {},
): Promise<{
  local: Array<{ id: string; characterName: string }>;
  remote: Array<{ id: string; name: string; status: string }>;
  inBoth: string[];
  localOnly: string[];
  remoteOnly: string[];
}> {
  const local = listSoulIds({ dbPath: opts.dbPath ?? defaultDbPath() }).map((r) => ({
    id: r.id,
    characterName: r.characterName,
  }));

  if (opts.runner === undefined) {
    // Local-only is a legitimate answer when the CLI is off, not an error. The
    // empty remote lists say plainly that no comparison was made.
    return { local, remote: [], inBoth: [], localOnly: local.map((l) => l.id), remoteOnly: [] };
  }

  const remote = await listRemoteSoulIds(opts.runner);
  return { local, remote, ...reconcileSoulIds({ local, remote }) };
}
