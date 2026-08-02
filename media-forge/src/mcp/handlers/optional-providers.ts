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
  CODEX_IMAGE_QUALITIES,
  CODEX_IMAGE_OUTPUT_FORMATS,
  CODEX_IMAGE_MODERATIONS,
  CODEX_PROMPT_SLOTS,
  CODEX_IMAGE_MODEL,
  resolveCodexImageMode,
} from '../../image/codex-image.js';
import type { CodexPromptSlot } from '../../image/codex-image.js';
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

// Every option below was read off the installed CLI on 2026-08-02 — `--help`
// plus `--dry-run`, which prints the exact API payload and needs neither key nor
// network. Nothing here is transcribed from a docs cache.
//
// Two flags the CLI HAS and this schema deliberately does NOT expose, because
// `references/cli.md` forbids both for gpt-image-2:
//   --input-fidelity  "this model always uses high fidelity for image inputs"
//   --background      "Do not use --background transparent with gpt-image-2"
// and one it has that would reopen a closed decision:
//   --model           gpt-image-1.5 is excluded from this repo; alpha routes to
//                     Nano Banana Pro or Imagen 4 Ultra, which do it natively.
export const _CodexImageBase = z.object({
  prompt: z.string().min(1),
  size: z.enum(CODEX_IMAGE_SIZES).default('1024x1024'),
  outputDir: z.string().min(1),
  fileName: z.string().min(1).optional(),

  /**
   * 'edit' is the CLI's ONLY reference-image path — `generate` accepts no image
   * input at all. Confirmed by dry-run: edit posts to /v1/images/edits with
   * `image` as an array.
   */
  op: z.enum(['generate', 'edit']).default('generate'),
  /** Required when op='edit'. Repeatable — the endpoint takes an array. */
  imagePaths: z.array(z.string().min(1)).max(16).optional(),
  /** op='edit' only. Transparent areas mark what may change. */
  maskPath: z.string().min(1).optional(),

  /** 'low' for drafts, 'high' for finals. Default stays 'high'. */
  quality: z.enum(CODEX_IMAGE_QUALITIES).default('high'),
  /**
   * Variants OF ONE PROMPT, not a way to make N different assets — the skill is
   * explicit: "For many distinct assets, do not use `n` as a substitute for
   * separate prompts."
   */
  n: z.number().int().min(1).max(10).default(1),
  outputFormat: z.enum(CODEX_IMAGE_OUTPUT_FORMATS).default('png'),
  /** jpeg/webp only — rejected against png below rather than silently ignored. */
  outputCompression: z.number().int().min(0).max(100).optional(),
  moderation: z.enum(CODEX_IMAGE_MODERATIONS).optional(),
  /**
   * Let the CLI expand a thin prompt into a fuller brief, or forbid it from
   * touching a finished one. Unset leaves the CLI's own default in charge.
   */
  augment: z.boolean().optional(),
  downscaleMaxDim: z.number().int().positive().optional(),
  downscaleSuffix: z.string().min(1).optional(),

  /**
   * The CLI's labelled brief slots. It assembles them server-side into
   * "Use case: … / Primary request: … / Subject: … / Style/medium: …", so
   * writing the same thing by hand into `prompt` produces a different string.
   */
  useCase: z.string().min(1).optional(),
  scene: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  style: z.string().min(1).optional(),
  composition: z.string().min(1).optional(),
  lighting: z.string().min(1).optional(),
  palette: z.string().min(1).optional(),
  materials: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  constraints: z.string().min(1).optional(),
  negative: z.string().min(1).optional(),
});

export const CodexImageInput = _CodexImageBase.superRefine((v, ctx) => {
  if (v.op === 'edit' && (v.imagePaths === undefined || v.imagePaths.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['imagePaths'],
      message: 'op="edit" posts to /v1/images/edits, which has nothing to edit without imagePaths.',
    });
  }
  if (v.op === 'generate' && v.imagePaths !== undefined && v.imagePaths.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['imagePaths'],
      message:
        'generate takes no image input on this CLI — the images would be dropped in silence. ' +
        'Use op="edit" to reference them.',
    });
  }
  if (v.op === 'generate' && v.maskPath !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maskPath'],
      message: 'a mask only means something against an image being edited. Set op="edit".',
    });
  }
  if (v.outputCompression !== undefined && v.outputFormat === 'png') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputCompression'],
      message:
        'outputCompression applies to jpeg and webp. PNG is lossless, so the value would be ' +
        'accepted and have no effect.',
    });
  }
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

  // Collected rather than spread field-by-field: eleven optional slots enumerated
  // by hand is eleven chances to add a twelfth to the schema and forget it here,
  // which is how a caller-supplied option becomes silently inert.
  const promptSlots: Partial<Record<CodexPromptSlot, string>> = {};
  for (const slot of CODEX_PROMPT_SLOTS) {
    const value = input[slot];
    if (typeof value === 'string') promptSlots[slot] = value;
  }

  const result = await provider.generate(
    {
      prompt: input.prompt,
      size: input.size,
      outputDir: input.outputDir,
      op: input.op,
      quality: input.quality,
      n: input.n,
      outputFormat: input.outputFormat,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.imagePaths ? { imagePaths: input.imagePaths } : {}),
      ...(input.maskPath ? { maskPath: input.maskPath } : {}),
      ...(input.outputCompression !== undefined
        ? { outputCompression: input.outputCompression }
        : {}),
      ...(input.moderation ? { moderation: input.moderation } : {}),
      ...(input.augment !== undefined ? { augment: input.augment } : {}),
      ...(input.downscaleMaxDim !== undefined
        ? { downscaleMaxDim: input.downscaleMaxDim }
        : {}),
      ...(input.downscaleSuffix ? { downscaleSuffix: input.downscaleSuffix } : {}),
      ...(Object.keys(promptSlots).length > 0 ? { promptSlots } : {}),
    },
    { isMultiTenant: opts.isMultiTenant ?? false },
  );

  // CODEX_IMAGE_MODEL, not a literal. The two agreed, but nothing tied them
  // together: renaming the constant would have left this reporting a model the
  // adapter no longer sends, and the caller has no way to notice.
  return { ...result, model: CODEX_IMAGE_MODEL };
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
