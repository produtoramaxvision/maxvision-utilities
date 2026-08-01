import * as fs from 'node:fs/promises';
import type { OutputStorageClient } from '../../output/storage.js';
import { presignExistingArtifact } from '../../output/output-storage.js';
import {
  createSoulId,
  listSoulIds,
  findByCharacterName,
  markUsed,
  type SoulIdRecord,
} from '../../core/soul-id-cache.js';
import { HiggsfieldSoulIdInput, type HiggsfieldSoulIdInputT } from '../schemas.js';
import { HiggsfieldDopInput, type HiggsfieldDopInputT } from '../schemas.js';
import { HiggsfieldCinemaStudioInput, type HiggsfieldCinemaStudioInputT } from '../schemas.js';
import { HiggsfieldSpeakInput, type HiggsfieldSpeakInputT } from '../schemas.js';
import { HiggsfieldMarketingStudioInput, type HiggsfieldMarketingStudioInputT } from '../schemas.js';
import { HiggsfieldGenerateInput, type HiggsfieldGenerateInputT } from '../schemas.js';
import { VIDEO_MODELS, type ModelOutputType } from '../../core/models.js';
import { ValidationError } from '../../core/errors.js';
import { defaultDbPath, higgsfieldProvider, higgsfieldCliProvider } from './shared.js';
import { assertPromptWithinBudget } from '../../core/prompt-budget.js';
import type { VideoLedgerHooks } from '../../video/providers/base.js';

// ---------------------------------------------------------------------------
// T15 part B (2026-07-29) — cost-guard + credit-preflight hooks for the 6
// Higgsfield submit handlers below (DoP, Cinema Studio, Speak, Marketing
// Studio, Generate). Mirrors KlingHandlerExecOpts/runCostGuards in
// kling.ts exactly, same shape: both hooks are optional so every handler
// below is still callable directly with a single argument (e.g. the existing
// higgsfield-*-handler.test.ts files), and both run BEFORE provider.generate()
// ever reaches the Higgsfield platform.
// ---------------------------------------------------------------------------

export interface HiggsfieldHandlerExecOpts {
  /**
   * Cost-guard hook (media-forge cost guards). Called SYNCHRONOUSLY with the
   * pure cost estimate, BEFORE provider.generate() ever submits to the
   * Higgsfield platform. Throws CostGuardError to block the call; returns
   * `{ costWarning }` to surface a non-blocking warning in the tool response;
   * returns undefined to allow silently. Optional — handlers called directly
   * without this hook behave exactly as before T15 part B.
   */
  readonly checkCostGuard?: (estimateUsd: number) => { costWarning?: string } | undefined;
  /**
   * Credit preflight hook (media-forge cost guards). Called BEFORE
   * provider.generate() — a cheap balance read that fails fast without
   * building the request body. Throws InsufficientCreditError on
   * insufficient balance; no-op when omitted. Distinct from `ledgerHooks`
   * below: this only READS the balance; `ledgerHooks.beforeSubmit` is the
   * REAL reserve, keyed on the jobId HiggsfieldProvider.generate() mints
   * internally, and runs BEFORE the platform submit too (A5, 2026-07-30) —
   * it also throws InsufficientCreditError on a race that slips past this
   * pre-check.
   */
  readonly preflightCredit?: (estimateUsd: number) => Promise<void>;
  /**
   * A5 (2026-07-30): reserve-BEFORE-submit ledger hooks, forwarded verbatim
   * to `HiggsfieldProvider.generate()` as its second argument — see
   * `VideoLedgerHooks` in base.ts for the contract. Optional so every
   * existing direct-provider test / direct handler call keeps working
   * unchanged when omitted, same as `checkCostGuard`/`preflightCredit` above.
   */
  readonly ledgerHooks?: VideoLedgerHooks;
}

/**
 * Shared cost-guard + credit-preflight gate run by every Higgsfield submit
 * handler below, BEFORE provider.generate() ever reaches the network.
 * Identical shape to kling.ts's runCostGuards.
 */
async function runCostGuards(
  estimateUsd: number,
  opts: HiggsfieldHandlerExecOpts,
): Promise<string | undefined> {
  const costWarning = opts.checkCostGuard?.(estimateUsd)?.costWarning;
  if (opts.preflightCredit) {
    await opts.preflightCredit(estimateUsd);
  }
  return costWarning;
}

/** Drops undefined entries so an absent optional never becomes a `--flag undefined`. */
function compactCliParams(
  params: Record<string, string | number | boolean | ReadonlyArray<string> | undefined>,
): Record<string, string | number | boolean | ReadonlyArray<string>> {
  const out: Record<string, string | number | boolean | ReadonlyArray<string>> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

interface StudioJobInput {
  readonly modelId: string;
  readonly mode: 't2v' | 'i2v';
  readonly prompt: string;
  readonly durationSec: number;
  readonly resolution: '480p' | '720p' | '1080p';
  readonly aspectRatio: '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' | 'auto';
  readonly startImagePath?: string;
  readonly endImagePath?: string;
  readonly imageReferencePaths?: ReadonlyArray<string>;
  readonly cliParams: Record<string, string | number | boolean | ReadonlyArray<string>>;
  readonly opts: HiggsfieldHandlerExecOpts;
}

/**
 * Shared submit path for the two Studio job types, over the CLI transport.
 *
 * The cost step is the reason this is not a copy of the HTTP handlers above.
 * `HiggsfieldCliProvider.estimateCostUSD` is synchronous by the VideoProvider
 * contract but has no local price table to answer from — deliberately, so a
 * stale rate can never be enforced by the cost guard. `fetchCostCredits` runs
 * first, asking `higgsfield generate cost` for the price of THESE parameters (a
 * read that spends nothing), and the synchronous method then reads that cached
 * answer. Skipping the fetch makes estimateCostUSD throw rather than guess.
 */
async function submitStudioJob(input: StudioJobInput): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const provider = higgsfieldCliProvider();
  const req = {
    modelId: input.modelId,
    mode: input.mode,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    ...(input.startImagePath ? { firstFrameImagePath: input.startImagePath } : {}),
    ...(input.endImagePath ? { lastFrameImagePath: input.endImagePath } : {}),
    ...(input.imageReferencePaths ? { referenceImagePaths: input.imageReferencePaths } : {}),
    extras: {
      providerKind: 'higgsfield' as const,
      cliParams: input.cliParams,
    },
  };

  await provider.fetchCostCredits(req);
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, input.opts);
  const handle = await provider.generate(req, input.opts.ledgerHooks);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldPoll / handleHiggsfieldDownload — async job lifecycle for the
// 7 Higgsfield generation tools (Codex P2 round 5 PR#10).
// ---------------------------------------------------------------------------

interface HiggsfieldPollResult {
  jobId: string;
  state: string;
  progress?: number;
  assetUrls?: ReadonlyArray<string>;
  url?: string;
  expires_at?: string;
  errorMessage?: string;
}

export async function handleHiggsfieldPoll(
  rawInput: unknown,
  opts: { storage?: OutputStorageClient } = {},
): Promise<HiggsfieldPollResult> {
  const input = rawInput as { jobId?: unknown };
  if (typeof input?.jobId !== 'string' || input.jobId.length === 0) {
    throw new Error('media_higgsfield_poll requires { jobId: string }');
  }
  const provider = higgsfieldProvider();
  const status = await provider.pollStatus(input.jobId);

  // F-B: quando completed e storage configurado, tentar presign do objeto já no
  // MinIO (uploaded pelo webhook handler). NOTA: o handler de webhook da
  // Higgsfield é um logging stub sem buffer — na prática o objeto não existe e
  // presignExistingArtifact retorna null, caindo no fallback assetUrls do
  // provider. O branch fica aqui para simetria com Kling/Seedance.
  let signedUrl: string | undefined;
  let expiresAt: string | undefined;
  if (status.state === 'completed' && opts.storage) {
    const artifact = await presignExistingArtifact({
      storage: opts.storage,
      jobId: input.jobId,
      contentType: 'video/mp4',
    }).catch(() => null);
    if (artifact) {
      signedUrl = artifact.url;
      expiresAt = artifact.expiresAt;
    }
  }

  return {
    jobId: status.jobId,
    state: status.state,
    ...(status.progress !== undefined ? { progress: status.progress } : {}),
    ...(status.assetUrls ? { assetUrls: status.assetUrls } : {}),
    ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
    ...(signedUrl !== undefined ? { url: signedUrl, expires_at: expiresAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldGenerate — generic Soul / Soul2 / aesthetic submit
// (Codex P2 round 7 PR#10): closes the doc-vs-implementation gap where the
// director routed Soul t2v through media_video_route (a decision-only tool)
// with no actual submit path.
// ---------------------------------------------------------------------------
export async function handleHiggsfieldGenerate(
  rawInput: unknown,
  opts: HiggsfieldHandlerExecOpts = {},
): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  outputType: ModelOutputType;
  costWarning?: string;
}> {
  const input: HiggsfieldGenerateInputT = HiggsfieldGenerateInput.parse(rawInput);
  // The three models this tool accepts are ALL `text2image` on the platform, and
  // it takes `mode: 't2v' | 'i2v'` and a `durationSec`. A caller reading only the
  // schema would expect a video back.
  //
  // handleVideoRoute can no longer select them (they are filtered on outputType),
  // but this tool names them explicitly, so the mismatch has to be answered here
  // rather than routed around. It is answered by SAYING SO: the result declares
  // what the endpoint returns, and buildRequestBody drops `duration` for image
  // models instead of sending a number nothing will honour.
  //
  // The registry lookup is not defensive dressing — it is the single place this
  // fact lives, so the tool cannot drift from it.
  const spec = VIDEO_MODELS[input.modelId];
  if (spec === undefined) {
    throw new ValidationError(
      `${input.modelId} is not in the model registry; media_higgsfield_generate cannot price or submit it`,
      { field: 'modelId' },
    );
  }
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });
  const provider = higgsfieldProvider();
  const req = {
    modelId: input.modelId,
    mode: input.mode,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.firstFrameImagePath ? { firstFrameImagePath: input.firstFrameImagePath } : {}),
    ...(input.referenceImagePaths ? { referenceImagePaths: input.referenceImagePaths } : {}),
    extras: {
      providerKind: 'higgsfield' as const,
      ...(input.soulId ? { soulId: input.soulId } : {}),
    },
  };
  // Cost-guard + credit-preflight run BEFORE generate() submits to the
  // Higgsfield platform — estimateCostUSD is pure (no I/O).
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    outputType: spec.outputType,
    ...(costWarning ? { costWarning } : {}),
  };
}

export async function handleHiggsfieldDownload(rawInput: unknown): Promise<{
  bytes: number;
  contentType: string;
  cdnUrl?: string;
}> {
  const input = rawInput as { jobIdOrUrl?: unknown };
  if (typeof input?.jobIdOrUrl !== 'string' || input.jobIdOrUrl.length === 0) {
    throw new Error('media_higgsfield_download requires { jobIdOrUrl: string }');
  }
  const provider = higgsfieldProvider();
  const asset = await provider.download(input.jobIdOrUrl);
  return {
    bytes: asset.buffer.length,
    contentType: asset.metadata.contentType,
    ...(asset.metadata.cdnUrl ? { cdnUrl: asset.metadata.cdnUrl } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldDop — DoP image-to-video with WAN Camera Control verbs
// ---------------------------------------------------------------------------

export async function handleHiggsfieldDop(
  rawInput: unknown,
  opts: HiggsfieldHandlerExecOpts = {},
): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const input: HiggsfieldDopInputT = HiggsfieldDopInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });
  const provider = higgsfieldProvider();
  const req = {
    modelId: input.modelId,
    mode: 'i2v' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    firstFrameImagePath: input.firstFrameImagePath,
    extras: {
      providerKind: 'higgsfield' as const,
      dopCameraVerbs: input.cameraVerbs,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldCinemaStudio — Cinematic Studio 3.5, over the CLI transport
//
// Repointed 2026-08-01. This dispatched to /higgsfield-ai/cinema-studio/3.5,
// which answers 404 model_not_found: the Cloud API does not resell the product.
// It resolves on the CLI surface as job type `cinematic_studio_video_3_5`, so
// the tool name and its place in the toolset are unchanged and only the
// transport moved.
//
// The old input modelled a "1,296 virtual lens" dictionary — focalLengthMm,
// apertureFStop, sensorSize, lensId. None of those is a field on any Higgsfield
// endpoint. What the product publishes instead is a set of named creative
// presets (camera_style, light_scheme, color_grading, genre), which the schema
// now mirrors from `higgsfield model get`.
// ---------------------------------------------------------------------------

export async function handleHiggsfieldCinemaStudio(
  rawInput: unknown,
  opts: HiggsfieldHandlerExecOpts = {},
): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const input: HiggsfieldCinemaStudioInputT = HiggsfieldCinemaStudioInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });
  return submitStudioJob({
    modelId: 'cinematic_studio_video_3_5',
    mode: input.startImagePath ? 'i2v' : 't2v',
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    startImagePath: input.startImagePath,
    endImagePath: input.endImagePath,
    imageReferencePaths: input.imageReferencePaths,
    cliParams: compactCliParams({
      camera_style: input.cameraStyle,
      color_grading: input.colorGrading,
      light_scheme: input.lightScheme,
      genre: input.genre,
      style_prompt: input.stylePrompt,
      generate_audio: input.generateAudio,
      multi_shots: input.multiShots,
    }),
    opts,
  });
}

// ---------------------------------------------------------------------------
// handleHiggsfieldSpeak — Speak / Speak 2.0 lip-sync: portrait + audio → talking head
// Task 1.5 audio mode wiring: MEDIA_FORGE_HF_SPEAK_AUDIO_MODE controls how the
// audio reference is resolved before the generate request is submitted.
//   'URL' (default / unset): audioReference = input.audioPath (pass-through)
//   'SIGNED_UPLOAD': upload audio bytes to Higgsfield — NOT implemented (PRELIMINAR_URL
//     per intel/2026-05-27-higgsfield-speak-audio-decision.md). Throws if set.
// ---------------------------------------------------------------------------

export async function handleHiggsfieldSpeak(
  rawInput: unknown,
  opts: HiggsfieldHandlerExecOpts = {},
): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const input: HiggsfieldSpeakInputT = HiggsfieldSpeakInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });
  const provider = higgsfieldProvider();

  // Task 1.5 decision wiring: when SIGNED_UPLOAD was the empirical outcome, the local
  // audio file must be uploaded to a Higgsfield-managed URL before submitting the generate
  // request. When URL was the outcome, the local path is passed through (the platform
  // expects a publicly fetchable HTTP URL — the caller is responsible for hosting it).
  // The decision is read from MEDIA_FORGE_HF_SPEAK_AUDIO_MODE env var ('URL' | 'SIGNED_UPLOAD'),
  // which `commands/setup.md` writes after the operator records the Task 1.5 outcome.
  let audioReference = input.audioPath;
  const mode = process.env['MEDIA_FORGE_HF_SPEAK_AUDIO_MODE'] ?? 'URL';
  if (mode === 'SIGNED_UPLOAD') {
    if (typeof (provider as unknown as { uploadAudio?: (b: Buffer) => Promise<string> }).uploadAudio !== 'function') {
      throw new Error(
        'MEDIA_FORGE_HF_SPEAK_AUDIO_MODE=SIGNED_UPLOAD but HiggsfieldProvider.uploadAudio() is not implemented. ' +
          'Re-run Task 1.5 probe + update Task 6 per .maxvision/intel/2026-05-27-higgsfield-speak-audio-decision.md.',
      );
    }
    // FIX (CodeRabbit round 9, PR#10): use async fs.readFile — readFileSync
    // stalls the event loop for multi-MB audio uploads, blocking every other
    // concurrent MCP request. `fs` (promises API) is already imported above.
    const buf = await fs.readFile(input.audioPath);
    audioReference = await (provider as unknown as { uploadAudio: (b: Buffer) => Promise<string> }).uploadAudio(buf);
  } else if (mode !== 'URL') {
    throw new Error(
      `MEDIA_FORGE_HF_SPEAK_AUDIO_MODE='${mode}' invalid. Must be 'URL' or 'SIGNED_UPLOAD' (set by setup wizard after Task 1.5).`,
    );
  }

  const req = {
    modelId: input.modelId,
    mode: 'lip-sync' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    firstFrameImagePath: input.portraitImagePath,
    extras: {
      providerKind: 'higgsfield' as const,
      speakAudioPath: audioReference,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldMarketingStudio — Marketing Studio, over the CLI transport
//
// Repointed 2026-08-01, same reason as Cinematic Studio:
// /higgsfield-ai/marketing-studio/standard answers 404, and the product resolves
// on the CLI as job type `marketing_studio_video`.
//
// The old input took `template` (nine hand-written names) and `productUrl`.
// Neither is a parameter of this product. What it actually takes is `mode`
// (default 'ugc'), 9:16 by default, and IDS resolved from the account —
// avatars, hooks, settings, products — which `media_higgsfield_ms_assets` lists.
// ---------------------------------------------------------------------------

export async function handleHiggsfieldMarketingStudio(
  rawInput: unknown,
  opts: HiggsfieldHandlerExecOpts = {},
): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const input: HiggsfieldMarketingStudioInputT = HiggsfieldMarketingStudioInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });
  return submitStudioJob({
    modelId: 'marketing_studio_video',
    mode: input.startImagePath ? 'i2v' : 't2v',
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    startImagePath: input.startImagePath,
    endImagePath: input.endImagePath,
    imageReferencePaths: input.imageReferencePaths,
    cliParams: compactCliParams({
      mode: input.mode,
      specific_mode: input.specificMode,
      avatar_ids: input.avatarIds,
      product_ids: input.productIds,
      web_product_ids: input.webProductIds,
      web_product_type: input.webProductType,
      hook_id: input.hookId,
      setting_id: input.settingId,
      storyboard_id: input.storyboardId,
      ad_reference_id: input.adReferenceId,
      generate_audio: input.generateAudio,
    }),
    opts,
  });
}



// ---------------------------------------------------------------------------
// handleHiggsfieldSoulId — Soul ID lifecycle for Higgsfield character cache
// ---------------------------------------------------------------------------

export async function handleHiggsfieldSoulId(rawInput: unknown): Promise<
  | { ok: true; id: string }
  | { records: SoulIdRecord[] }
  | { record: SoulIdRecord | undefined }
> {
  const input: HiggsfieldSoulIdInputT = HiggsfieldSoulIdInput.parse(rawInput);
  const dbPath = defaultDbPath();
  switch (input.action) {
    case 'create':
      createSoulId({
        dbPath,
        id: input.id,
        provider: 'higgsfield',
        characterName: input.characterName,
        assetPaths: input.assetPaths,
      });
      return { ok: true, id: input.id };
    case 'list':
      return { records: listSoulIds({ dbPath, provider: 'higgsfield' }) };
    case 'find':
      return {
        record: findByCharacterName({
          dbPath,
          characterName: input.characterName,
          provider: 'higgsfield',
        }),
      };
    case 'markUsed':
      markUsed({ dbPath, id: input.id });
      return { ok: true, id: input.id };
  }
}
