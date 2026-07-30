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
import { HiggsfieldRecastInput, type HiggsfieldRecastInputT } from '../schemas.js';
import { HiggsfieldViralityPredictorInput, type HiggsfieldViralityPredictorInputT } from '../schemas.js';
import { HiggsfieldGenerateInput, type HiggsfieldGenerateInputT } from '../schemas.js';
import {
  buildHiggsfieldHeaders,
  buildFallbackHeaders,
} from '../../video/providers/auth/higgsfield-headers.js';
import { defaultDbPath, higgsfieldProvider } from './shared.js';
import { assertPromptWithinBudget } from '../../core/prompt-budget.js';

// ---------------------------------------------------------------------------
// T15 part B (2026-07-29) — cost-guard + credit-preflight hooks for the 6
// Higgsfield submit handlers below (DoP, Cinema Studio, Speak, Marketing
// Studio, Recast, Generate). Mirrors KlingHandlerExecOpts/runCostGuards in
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
   * provider.generate() to narrow (not close — see preflightVideoCredit's own
   * doc comment in billing.ts) the reserve-after-submit credit gap: the
   * actual reserve still runs in register.ts AFTER generate() returns, keyed
   * on the jobId the Higgsfield platform accepted (recordJob only writes on a
   * successful submit — see HiggsfieldProvider.generate()). Throws
   * InsufficientCreditError on insufficient balance; no-op when omitted.
   */
  readonly preflightCredit?: (estimateUsd: number) => Promise<void>;
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
  costWarning?: string;
}> {
  const input: HiggsfieldGenerateInputT = HiggsfieldGenerateInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldCinemaStudio — Cinema Studio 3.5 with 1,296 virtual lenses
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
  const provider = higgsfieldProvider();
  const req = {
    modelId: 'higgsfield-cinema-studio-3.5',
    mode: 'i2v' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    firstFrameImagePath: input.firstFrameImagePath,
    extras: {
      providerKind: 'higgsfield' as const,
      cinemaStudioParams: {
        focalLengthMm: input.focalLengthMm,
        apertureFStop: input.apertureFStop,
        sensorSize: input.sensorSize,
        colorGrading: input.colorGrading,
        lensId: input.lensId,
      },
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldMarketingStudio — Marketing Studio: 9 UGC templates from product URL
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
  const provider = higgsfieldProvider();
  const req = {
    modelId: 'higgsfield-marketing-studio',
    mode: 't2v' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    extras: {
      providerKind: 'higgsfield' as const,
      marketingStudioTemplate: input.template,
      marketingStudioProductUrl: input.productUrl,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldRecast — Recast Studio: swap character in existing video
// ---------------------------------------------------------------------------

export async function handleHiggsfieldRecast(
  rawInput: unknown,
  opts: HiggsfieldHandlerExecOpts = {},
): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const input: HiggsfieldRecastInputT = HiggsfieldRecastInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'higgsfield', prompt: input.prompt, field: 'prompt' });
  const provider = higgsfieldProvider();
  const req = {
    modelId: 'higgsfield-recast',
    mode: 'targeted-edit' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    firstFrameImagePath: input.sourceVideoPath, // platform reads first_frame_url as source ref
    extras: {
      providerKind: 'higgsfield' as const,
      recastTargetCharacterPath: input.targetCharacterImagePath,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldViralityPredictor — score an asset (viral/audience-fit/hook-strength)
// Uses fetch DIRECTLY — no provider generate cycle, just a scoring POST.
// ---------------------------------------------------------------------------

export async function handleHiggsfieldViralityPredictor(rawInput: unknown): Promise<{
  viralityScore: number;
  audienceFit?: number;
  hookStrength?: number;
  raw: Record<string, unknown>;
}> {
  const input: HiggsfieldViralityPredictorInputT = HiggsfieldViralityPredictorInput.parse(rawInput);
  // FIX (Codex P2 round 12, PR#11): every other Higgsfield endpoint
  // (HiggsfieldProvider.generate / pollStatus / etc.) does a primary→fallback
  // auth handshake on 401/403 — virality_predictor was missed in the round 5
  // hardening, so it fails outright in deployments accepting only the
  // fallback scheme. Mirror the same retry-once pattern here.
  const url = 'https://platform.higgsfield.ai/higgsfield-ai/virality-predictor';
  const body = JSON.stringify({ asset_url: input.assetUrl, platform: input.platform });
  const primaryHeaders = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...buildHiggsfieldHeaders(),
  };
  let res = await fetch(url, { method: 'POST', headers: primaryHeaders, body });
  if (res.status === 401 || res.status === 403) {
    process.stderr.write(
      `[higgsfield-auth] virality_predictor primary auth rejected (status=${res.status}) — retrying once with fallback scheme.\n`,
    );
    process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'] = 'true';
    const fallbackHeaders = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...buildFallbackHeaders(),
    };
    res = await fetch(url, { method: 'POST', headers: fallbackHeaders, body });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Higgsfield virality predictor failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = data[k];
    return typeof v === 'number' ? v : undefined;
  };
  const score = num('virality_score');
  if (typeof score !== 'number') {
    throw new Error('virality predictor response missing virality_score');
  }
  return {
    viralityScore: score,
    audienceFit: num('audience_fit'),
    hookStrength: num('hook_strength'),
    raw: data,
  };
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
