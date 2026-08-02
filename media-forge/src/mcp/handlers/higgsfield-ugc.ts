// src/mcp/handlers/higgsfield-ugc.ts
// Marketing Studio catalogue + the two backend-enhanced image products.
//
// All three live on the CLI transport. The Cloud API does not resell any of
// them — /higgsfield-ai/marketing-studio/standard answers 404 — which is why the
// whole UGC surface was invisible to this plugin until now.
//
// The catalogue call is a READ and costs nothing. The two generators default to
// `--enhance-only`, which returns the prompts Higgsfield's backend assembles
// WITHOUT submitting a job, so the default path is also free and the caller sees
// what would be generated before paying for it.

import { ValidationError } from '../../core/errors.js';
import {
  HiggsfieldMarketingAssetsInput,
  HiggsfieldProductPhotoshootInput,
  HiggsfieldMarketplaceCardsInput,
  type HiggsfieldMarketingAssetsInputT,
  type HiggsfieldProductPhotoshootInputT,
  type HiggsfieldMarketplaceCardsInputT,
  HiggsfieldVoicesInput,
  HiggsfieldPresetsInput,
  HiggsfieldDtcAdInput,
  type HiggsfieldVoicesInputT,
  type HiggsfieldPresetsInputT,
  type HiggsfieldDtcAdInputT,
} from '../schemas.js';
import { higgsfieldCliProvider } from './shared.js';
import { assertPromptWithinBudget } from '../../core/prompt-budget.js';

/**
 * One asset shape for every group, because the CLI does not have one.
 *
 * `avatars` and `ad-formats` answer with a bare array; `hooks`, `settings`,
 * `brand-kits` and `ad-references` answer with `{items,…}`; and the name field
 * is `name` on some and `display_name` on others. Normalising here means the
 * tool's output shape is stable across groups even though its input is not.
 */
export interface MarketingStudioAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** Everything the platform returned, unmodified — nothing is hidden. */
  readonly raw: Record<string, unknown>;
}

function unwrapList(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed !== null && typeof parsed === 'object') {
    const items = (parsed as { items?: unknown }).items;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
  }
  return [];
}

function assetName(row: Record<string, unknown>): string {
  for (const key of ['name', 'display_name', 'title']) {
    const v = row[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '(unnamed)';
}

export async function handleHiggsfieldMarketingAssets(rawInput: unknown): Promise<{
  kind: string;
  count: number;
  assets: ReadonlyArray<MarketingStudioAsset>;
}> {
  const input: HiggsfieldMarketingAssetsInputT = HiggsfieldMarketingAssetsInput.parse(rawInput);
  const provider = higgsfieldCliProvider();

  const rows = unwrapList(
    await provider.runReadJson(['marketing-studio', input.kind, 'list', '--json']),
  );

  const needle = input.query?.toLowerCase();
  const assets = rows
    .map((row) => ({
      id: String(row['id'] ?? ''),
      name: assetName(row),
      kind: input.kind,
      raw: row,
    }))
    .filter((a) => needle === undefined || a.name.toLowerCase().includes(needle))
    .slice(0, input.limit);

  return { kind: input.kind, count: assets.length, assets };
}

/**
 * Shared shape for the two backend-enhanced image tools.
 *
 * `submitted` is reported rather than left implicit: `enhanceOnly` is the
 * difference between reading and spending, and a caller looking only at the
 * returned prompts cannot tell the two apart.
 */
interface EnhancedImageResult {
  readonly submitted: boolean;
  readonly enhancedPrompts: ReadonlyArray<string>;
  readonly jobIds: ReadonlyArray<string>;
  readonly raw: unknown;
}

function collectPrompts(parsed: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k.includes('prompt') && typeof val === 'string' && val.length > 0) out.push(val);
        else walk(val);
      }
    }
  };
  walk(parsed);
  return out;
}

function collectJobIds(parsed: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if ((k === 'id' || k === 'job_id') && typeof val === 'string') out.push(val);
        else walk(val);
      }
    }
  };
  walk(parsed);
  return out;
}

export async function handleHiggsfieldProductPhotoshoot(
  rawInput: unknown,
): Promise<EnhancedImageResult> {
  const input: HiggsfieldProductPhotoshootInputT =
    HiggsfieldProductPhotoshootInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });

  const args = [
    'product-photoshoot',
    'create',
    '--mode',
    input.mode,
    '--prompt',
    input.prompt,
    '--count',
    String(input.count),
  ];
  for (const p of input.imagePaths) args.push('--image', p);
  if (input.aspectRatio) args.push('--aspect_ratio', input.aspectRatio);
  if (input.brandContext) args.push('--brand_context', input.brandContext);
  if (input.productContext) args.push('--product_context', input.productContext);
  if (input.enhanceOnly) args.push('--enhance-only');

  return runEnhancedImageTool(args, input.enhanceOnly);
}

export async function handleHiggsfieldMarketplaceCards(
  rawInput: unknown,
): Promise<EnhancedImageResult> {
  const input: HiggsfieldMarketplaceCardsInputT = HiggsfieldMarketplaceCardsInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });

  if (input.mainJobId !== undefined && input.scope === 'main') {
    throw new ValidationError(
      'mainJobId chains secondary / A+ assets off an existing main image, so scope must be ' +
        '"product-images", "aplus" or "full-set" — not "main".',
      { field: 'mainJobId' },
    );
  }

  const args = ['marketplace-cards', 'create', '--scope', input.scope, '--prompt', input.prompt];
  for (const p of input.imagePaths) args.push('--image', p);
  if (input.category) args.push('--category', input.category);
  if (input.visualStyle) args.push('--visual_style', input.visualStyle);
  if (input.productUrl) args.push('--product_url', input.productUrl);
  if (input.brandContext) args.push('--brand_context', input.brandContext);
  if (input.productContext) args.push('--product_context', input.productContext);
  if (input.mainJobId) args.push('--main-job', input.mainJobId);
  if (input.enhanceOnly) args.push('--enhance-only');

  return runEnhancedImageTool(args, input.enhanceOnly);
}

async function runEnhancedImageTool(
  args: string[],
  enhanceOnly: boolean,
): Promise<EnhancedImageResult> {
  const provider = higgsfieldCliProvider();
  // Two entry points, not one with a flag: the read path is the one the
  // test-runner guard lets through, and routing a real submit through it would
  // defeat that guard. The distinction is the same one `submitted` reports.
  const parsed = enhanceOnly
    ? await provider.runReadJson([...args, '--json'])
    : await provider.runWriteJson([...args, '--json']);

  return {
    submitted: !enhanceOnly,
    enhancedPrompts: collectPrompts(parsed),
    jobIds: enhanceOnly ? [] : collectJobIds(parsed),
    raw: parsed,
  };
}

// ---------------------------------------------------------------------------
// Voices / Presets / DTC Ads — the last three CLI surfaces without a tool.
//
// The first two are pure reads. The third can spend, and defaults not to.
// ---------------------------------------------------------------------------

export interface HiggsfieldVoice {
  readonly id: string;
  readonly name: string;
  /** `preset` (built-in) or `element` (cloned). This IS the --voice-type value. */
  readonly voiceType: string;
  readonly raw: Record<string, unknown>;
}

export async function handleHiggsfieldVoices(rawInput: unknown): Promise<{
  count: number;
  total: number;
  voices: ReadonlyArray<HiggsfieldVoice>;
}> {
  const input: HiggsfieldVoicesInputT = HiggsfieldVoicesInput.parse(rawInput);
  const provider = higgsfieldCliProvider();

  const parsed = await provider.runReadJson(['voices', 'list', '--json']);
  const rows = unwrapList(parsed);
  // `total` is the platform's own count of the catalogue, distinct from how many
  // survive the local filters below. Reporting only the filtered number would
  // make a typo'd query indistinguishable from an empty catalogue.
  const total =
    parsed !== null && typeof parsed === 'object' && typeof (parsed as { total?: unknown }).total === 'number'
      ? (parsed as { total: number }).total
      : rows.length;

  const needle = input.query?.toLowerCase();
  const voices = rows
    .map((row) => ({
      id: String(row['id'] ?? ''),
      name: assetName(row),
      voiceType: String(row['voice_type'] ?? ''),
      raw: row,
    }))
    .filter((v) => input.voiceType === undefined || v.voiceType === input.voiceType)
    .filter((v) => needle === undefined || v.name.toLowerCase().includes(needle))
    .slice(0, input.limit);

  return { count: voices.length, total, voices };
}

export async function handleHiggsfieldPresets(rawInput: unknown): Promise<{
  type: string;
  resolved: boolean;
  count: number;
  raw: unknown;
}> {
  const input: HiggsfieldPresetsInputT = HiggsfieldPresetsInput.parse(rawInput);
  const provider = higgsfieldCliProvider();

  if (input.resolveId !== undefined) {
    if (input.type !== 'video-explainer') {
      throw new ValidationError(
        `preset resolve is documented for video-explainer only ("Resolve a video-explainer ` +
          `preset into its workspace-scoped style media input"). Got type="${input.type}". ` +
          `Drop resolveId to list instead.`,
        { field: 'resolveId' },
      );
    }
    const parsed = await provider.runReadJson([
      'preset',
      'resolve',
      input.type,
      input.resolveId,
      '--json',
    ]);
    return { type: input.type, resolved: true, count: 1, raw: parsed };
  }

  const args = ['preset', 'list', input.type];
  // group/category/limit are animation-action filters. Sending them for
  // video-explainer would earn an `Unknown params` refusal on a call that would
  // otherwise have worked, so they are gated on the type rather than forwarded
  // and hoped for.
  if (input.type === 'animation-action') {
    if (input.query) args.push('--query', input.query);
    if (input.group) args.push('--group', input.group);
    if (input.category) args.push('--category', input.category);
    args.push('--limit', String(input.limit));
  }

  const parsed = await provider.runReadJson([...args, '--json']);
  const rows = unwrapList(parsed);
  // video-explainer has no server-side search, so the filter runs here for it.
  const needle = input.type === 'video-explainer' ? input.query?.toLowerCase() : undefined;
  const filtered =
    needle === undefined
      ? rows
      : rows.filter((r) => assetName(r).toLowerCase().includes(needle));

  return {
    type: input.type,
    resolved: false,
    count: Math.min(filtered.length, input.limit),
    raw: filtered.slice(0, input.limit),
  };
}

export async function handleHiggsfieldDtcAd(rawInput: unknown): Promise<{
  submitted: boolean;
  credits?: number;
  jobIds: ReadonlyArray<string>;
  raw: unknown;
}> {
  const input: HiggsfieldDtcAdInputT = HiggsfieldDtcAdInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });

  const args = [
    'marketing-studio',
    'dtc-ads',
    'generate',
    '--prompt',
    input.prompt,
    '--format-id',
    input.formatId,
    '--aspect-ratio',
    input.aspectRatio,
    '--quality',
    input.quality,
    '--resolution',
    input.resolution,
    '--batch-size',
    String(input.batchSize),
  ];
  if (input.brandKitId) args.push('--brand-kit-id', input.brandKitId);
  if (input.avatarId) args.push('--avatar', input.avatarId);
  if (input.productId) args.push('--product', input.productId);
  if (input.costOnly) args.push('--cost-only');

  const provider = higgsfieldCliProvider();
  // Same split as runEnhancedImageTool: --cost-only is a read and goes through
  // the path the test-runner guard permits; a real submit does not.
  const parsed = input.costOnly
    ? await provider.runReadJson([...args, '--json'])
    : await provider.runWriteJson([...args, '--json']);

  const credits =
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (parsed as { credits?: unknown }).credits === 'number'
      ? (parsed as { credits: number }).credits
      : undefined;

  return {
    submitted: !input.costOnly,
    ...(credits !== undefined ? { credits } : {}),
    jobIds: input.costOnly ? [] : collectJobIds(parsed),
    raw: parsed,
  };
}
