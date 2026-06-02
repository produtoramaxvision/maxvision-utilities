// src/mcp/handlers.ts
// Registers all MCP tools backed by service implementations.
// Pattern: wrap each service call in wrap() for unified error handling and logging.
// NEVER throw from a handler — always return {isError: true} with message.
// F-C: registerAllTools receives optional tier and skips tools outside the tier gate.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MediaForgeClient } from '../core/client.js';
import type { MediaForgeConfig } from '../core/config.js';
import type { OutputManager } from '../output/output-manager.js';
import type { OutputStorageClient } from '../output/storage.js';
import type { ZodTypeAny } from 'zod';
import { logger } from '../core/logger.js';
import { safeJoin, jobId as generateJobId } from '../utils/paths.js';
import { storeArtifact, presignExistingArtifact } from '../output/output-storage.js';
import { ValidationError } from '../core/errors.js';
import { MCP_TOOLS, type MCPTool } from './schemas.js';
import { isToolAllowed } from '../http/tier-gates.js';

// Strict jobId pattern: starts with alnum, only alnum + `_.-`, max 128 chars.
// Mirrors the format emitted by OutputManager (YYYYMMDDTHHMMSSZ-<random6>-<slug>)
// and explicitly excludes `/`, `\`, `..`, and NUL so user input cannot escape
// the jobs/ root via media_get_job_metadata.
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
import {
  generateImageNanoBananaPro,
  generateImageImagen4Ultra,
  editImage,
  composeScene,
  describeImage,
  extractPalette,
} from '../image/image-service.js';
import {
  generateVideoT2V,
  generateVideoI2V,
  generateVideoInterpolate,
  generateVideoWithRefs,
  extendVideo,
  pollVideoOperation,
  downloadVideo,
} from '../video/video-service.js';
import { OcrValidator, checkBrand } from '../review/review-service.js';
import { estimateImageCost, estimateVideoCost, estimateRefsCost, type RefsEstimate } from '../core/cost.js';
import { createRefsService } from '../refs/refs-service.js';
import type {
  RefsSearchInputT,
  RefsComposeMoodboardInputT,
  RefsPresignInputT,
  RefsIndexInputT,
} from './schemas.js';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
  ASPECT_RATIO_NANO_BANANA,
  ASPECT_RATIO_IMAGEN,
  ASPECT_RATIO_VIDEO,
  IMAGE_SIZE,
  THINKING_LEVELS,
  PERSON_GENERATION_IMAGE,
  PERSON_GENERATION_VIDEO,
  VIDEO_RESOLUTION,
  VIDEO_DURATION_SECONDS,
} from '../core/models.js';
import type { WebhookRouter } from '../video/providers/webhook-router.js';
import { GoogleVeoProvider } from '../video/providers/google-veo.js';
import { VIDEO_MODELS } from '../core/models.js';
import {
  VideoCostEstimateInput,
  type VideoCostEstimateInputT,
  VideoCostReportInput,
  type VideoCostReportInputT,
  VideoRouteInput,
  type VideoRouteInputT,
} from './schemas.js';
import { queryReport, type CostReport } from '../core/cost-tracker.js';
import { normalizeCostUSD } from '../core/pricing.js';
import type { Provider, VideoModelSpec } from '../core/models.js';
import { join } from 'node:path';
import {
  createSoulId,
  listSoulIds,
  findByCharacterName,
  markUsed,
  type SoulIdRecord,
} from '../core/soul-id-cache.js';
import { HiggsfieldSoulIdInput, type HiggsfieldSoulIdInputT } from './schemas.js';
import { HiggsfieldDopInput, type HiggsfieldDopInputT } from './schemas.js';
import { HiggsfieldCinemaStudioInput, type HiggsfieldCinemaStudioInputT } from './schemas.js';
import { HiggsfieldSpeakInput, type HiggsfieldSpeakInputT } from './schemas.js';
import { HiggsfieldMarketingStudioInput, type HiggsfieldMarketingStudioInputT } from './schemas.js';
import { HiggsfieldRecastInput, type HiggsfieldRecastInputT } from './schemas.js';
import { HiggsfieldViralityPredictorInput, type HiggsfieldViralityPredictorInputT } from './schemas.js';
import { HiggsfieldGenerateInput, type HiggsfieldGenerateInputT } from './schemas.js';
import {
  buildHiggsfieldHeaders,
  buildFallbackHeaders,
} from '../video/providers/auth/higgsfield-headers.js';
import { HiggsfieldProvider } from '../video/providers/higgsfield.js';
import { KlingProvider } from '../video/providers/kling.js';
import { KlingMotionBrushInput, type KlingMotionBrushInputT } from './schemas.js';
import {
  KlingElementCreateInput,
  type KlingElementCreateInputT,
  KlingElementListInput,
  type KlingElementListInputT,
  KlingElementDeleteInput,
  type KlingElementDeleteInputT,
  KlingElementsInput,
  type KlingElementsInputT,
  KlingLipSyncInput,
  type KlingLipSyncInputT,
  KlingOmniMultiShotInput,
  type KlingOmniMultiShotInputT,
  KlingVideoExtendInput,
  type KlingVideoExtendInputT,
  KlingPollInput,
  type KlingPollInputT,
  KlingDownloadInput,
  type KlingDownloadInputT,
} from './schemas.js';
import {
  createKlingElement,
  listKlingElementsFromBackend,
  deleteKlingElement,
} from '../video/providers/kling-elements.js';
import { openDb, runMigrations } from '../core/db.js';
import { recordActualCost } from '../core/cost-tracker.js';
import {
  getBytedanceSeedanceProvider,
  type BytedanceSeedanceEnv,
} from '../video/providers/bytedance-seedance.js';
import {
  SeedanceTextToVideoInput,
  type SeedanceTextToVideoInputT,
  SeedanceImageToVideoInput,
  type SeedanceImageToVideoInputT,
  SeedanceMultishotInput,
  type SeedanceMultishotInputT,
  SeedanceReferenceFusionInput,
  type SeedanceReferenceFusionInputT,
} from './schemas.js';
import type { BytedanceSeedanceExtras } from '../video/providers/base.js';
import { isSeedanceEnabled } from '../core/feature-flags.js';

// ---------------------------------------------------------------------------
// ADAPTED_PROVIDERS — routing gate: only providers with a wired adapter here.
// Prevents the router from selecting models that have no execution backend.
//
// P14: HiggsfieldProvider landed in Task 6 — 'higgsfield' enters ADAPTED_PROVIDERS.
// P15: KlingProvider landed in Task 4 — 'kling' enters ADAPTED_PROVIDERS.
// P16: BytedanceSeedanceProvider landed in Task 6 — 'bytedance' enters ADAPTED_PROVIDERS (Task 7).
//      Task 8.5: 'bytedance' is excluded when MEDIA_FORGE_SEEDANCE_ENABLED=false.
// ---------------------------------------------------------------------------
const ADAPTED_PROVIDERS_BASE = new Set<Provider>(['google', 'higgsfield', 'kling']);

/**
 * Returns the active set of adapted providers, excluding 'bytedance' when the
 * MEDIA_FORGE_SEEDANCE_ENABLED feature flag is false. Evaluated at call time
 * (not module load) so tests can toggle the env var per-test.
 */
function getAdaptedProviders(): ReadonlySet<Provider> {
  if (!isSeedanceEnabled()) return ADAPTED_PROVIDERS_BASE;
  // Build on-demand when Seedance is enabled — avoids mutating the base set.
  return new Set<Provider>([...ADAPTED_PROVIDERS_BASE, 'bytedance']);
}

// ---------------------------------------------------------------------------
// Webhook router module-level handle (P13 scaffold for P14+ provider callbacks)
// ---------------------------------------------------------------------------
// Owned by the runtime entrypoint (`startStdioServer` in src/mcp/server.ts) —
// `buildServer()`-based tests do NOT start the router, so the handler reports
// `{ running: false, handlers: [] }` in that path. This keeps the test suite
// from binding TCP ports.
let _webhookRouter: WebhookRouter | undefined;

export function setWebhookRouter(r: WebhookRouter | undefined): void {
  _webhookRouter = r;
}

export interface VideoWebhookStatusResult {
  running: boolean;
  address?: { address: string; port: number };
  handlers: string[];
}

export async function handleVideoWebhookStatus(): Promise<VideoWebhookStatusResult> {
  if (!_webhookRouter) return { running: false, handlers: [] };
  return {
    running: true,
    address: _webhookRouter.address,
    handlers: Array.from(_webhookRouter.handlers.keys()),
  };
}

// ---------------------------------------------------------------------------
// defaultDbPath — resolves the SQLite cost DB path from env or cwd default
// ---------------------------------------------------------------------------

function defaultDbPath(): string {
  const projectDir =
    process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
  return join(projectDir, 'cost.db');
}

// ---------------------------------------------------------------------------
// D-7: lazy singleton — HiggsfieldProvider is constructed on first use and
// cached for the lifetime of the MCP server process. Avoids per-call
// construction overhead AND ensures all handlers share the in-memory
// `provider-request-map` cache + the same HiggsfieldProvider instance.
// ---------------------------------------------------------------------------
let _hfProvider: HiggsfieldProvider | undefined;

function higgsfieldProvider(): HiggsfieldProvider {
  if (_hfProvider) return _hfProvider;
  _hfProvider = new HiggsfieldProvider({
    dbPath: defaultDbPath(),
    publicWebhookBaseUrl: process.env['MEDIA_FORGE_WEBHOOK_PUBLIC_URL'],
  });
  return _hfProvider;
}

/** Test utility — resets the singleton so each test gets a fresh provider bound to the
 *  current dbPath / env. Tests with their own tmp dbPath MUST call this in beforeEach. */
export function _resetHiggsfieldProviderForTests(): void {
  _hfProvider = undefined;
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
export async function handleHiggsfieldGenerate(rawInput: unknown): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
}> {
  const input: HiggsfieldGenerateInputT = HiggsfieldGenerateInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: provider.estimateCostUSD(req),
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

export async function handleHiggsfieldDop(rawInput: unknown): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
}> {
  const input: HiggsfieldDopInputT = HiggsfieldDopInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldCinemaStudio — Cinema Studio 3.5 with 1,296 virtual lenses
// ---------------------------------------------------------------------------

export async function handleHiggsfieldCinemaStudio(rawInput: unknown): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
}> {
  const input: HiggsfieldCinemaStudioInputT = HiggsfieldCinemaStudioInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: provider.estimateCostUSD(req),
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

export async function handleHiggsfieldSpeak(rawInput: unknown): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
}> {
  const input: HiggsfieldSpeakInputT = HiggsfieldSpeakInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldMarketingStudio — Marketing Studio: 9 UGC templates from product URL
// ---------------------------------------------------------------------------

export async function handleHiggsfieldMarketingStudio(rawInput: unknown): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
}> {
  const input: HiggsfieldMarketingStudioInputT = HiggsfieldMarketingStudioInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// ---------------------------------------------------------------------------
// handleHiggsfieldRecast — Recast Studio: swap character in existing video
// ---------------------------------------------------------------------------

export async function handleHiggsfieldRecast(rawInput: unknown): Promise<{
  provider: string;
  jobId: string;
  providerNativeId?: string;
  estimatedCostUSD: number;
}> {
  const input: HiggsfieldRecastInputT = HiggsfieldRecastInput.parse(rawInput);
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
  const handle = await provider.generate(req);
  return {
    provider: handle.provider,
    jobId: handle.jobId,
    providerNativeId: handle.providerNativeId,
    estimatedCostUSD: provider.estimateCostUSD(req),
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
// handleVideoCostEstimate — estimate USD cost for a video generation request
// ---------------------------------------------------------------------------

export async function handleVideoCostEstimate(rawInput: unknown): Promise<{
  estimatedCostUSD: number;
  provider: string;
  modelId: string;
}> {
  const input: VideoCostEstimateInputT = VideoCostEstimateInput.parse(rawInput);
  const spec = VIDEO_MODELS[input.modelId];
  if (!spec) throw new Error(`unknown model: ${input.modelId}`);
  if (spec.provider !== 'google') {
    throw new Error(
      `provider ${spec.provider} not yet wired in P13 — only google/Veo supported`,
    );
  }
  const provider = new GoogleVeoProvider({ dbPath: defaultDbPath() });
  const usd = provider.estimateCostUSD(input);
  return { estimatedCostUSD: usd, provider: spec.provider, modelId: input.modelId };
}

// ---------------------------------------------------------------------------
// handleVideoCostReport — aggregate cost report from the local SQLite ledger
// ---------------------------------------------------------------------------

export async function handleVideoCostReport(rawInput: unknown): Promise<CostReport> {
  const input: VideoCostReportInputT = VideoCostReportInput.parse(rawInput);
  return queryReport({ dbPath: defaultDbPath(), periodDays: input.periodDays });
}

// ---------------------------------------------------------------------------
// handleVideoRoute — pick optimal provider+model for a video generation request
// ---------------------------------------------------------------------------
// Capability-before-cost routing heuristic. P14 adds Higgsfield, P15 adds Kling.
//
// Ranking rules (in priority order):
//   1. preferProvider filter — caller can force a specific provider.
//   2. P15 explicit tier overrides (pickExplicitTier) — certain modes/resolutions
//      are hard-wired to a specific Kling model before cost sort:
//        resolution=4k → kling-v3-master
//        mode=multi-shot → kling-v3-omni
//        mode=motion-brush | elements | lip-sync → kling-v3-pro
//   3. Pure cost sort (cheapest USD-equivalent wins) — google-default tiebreaker
//      removed in P15 (Option A). When preferProvider is 'google', caller must
//      pass it explicitly.
//
// P16: 'bytedance' will integrate here when SeedanceProvider lands.

export interface VideoRouteResult {
  readonly provider: Provider;
  readonly modelId: string;
  readonly mode: string;
  readonly estimatedCostUSD: number;
  readonly rationale: string;
}

export async function handleVideoRoute(rawInput: unknown): Promise<VideoRouteResult> {
  const input: VideoRouteInputT = VideoRouteInput.parse(rawInput);

  const allByMode = Object.values(VIDEO_MODELS)
    .filter((spec) => spec.modes.includes(input.mode as never))
    // Constrain to providers with a wired adapter. Models registered for
    // future providers (Kling P15, Seedance P16) must not be selected until
    // their adapter is available in getAdaptedProviders(). When
    // MEDIA_FORGE_SEEDANCE_ENABLED=false, 'bytedance' is excluded here.
    .filter((spec) => getAdaptedProviders().has(spec.provider))
    // FIX (Codex P2, PR#10): filter candidates by requested duration +
    // resolution BEFORE cost sort. Without this, sorter could pick cheapest
    // model that fails downstream validation (e.g. higgsfield-speak with
    // maxDurationSec=30 cheaper than higgsfield-speak2 maxDurationSec=60 for
    // a 45s lip-sync request → submit rejected). Defensive: spec missing
    // maxDurationSec or resolutions arrays does not filter out.
    .filter((spec) =>
      typeof spec.maxDurationSec === 'number'
        ? spec.maxDurationSec >= input.durationSec
        : true,
    )
    .filter((spec) =>
      Array.isArray(spec.resolutions) && spec.resolutions.length > 0
        ? (spec.resolutions as readonly string[]).includes(input.resolution)
        : true,
    );
  if (allByMode.length === 0) {
    throw new Error(
      `no provider supports mode='${input.mode}' with durationSec=${input.durationSec} resolution=${input.resolution} in current registry`,
    );
  }

  const preferred = input.preferProvider
    ? allByMode.filter((c) => c.provider === input.preferProvider)
    : allByMode;
  if (preferred.length === 0) {
    throw new Error(
      `preferProvider ${input.preferProvider} has no model supporting mode ${input.mode}`,
    );
  }

  // P15: attempt an explicit-tier override before falling back to cost sort.
  // pickExplicitTier hard-wires certain modes/resolutions to a specific Kling model
  // regardless of cost. Only applies when preferProvider is NOT set (caller override wins).
  const explicit = input.preferProvider ? undefined : pickExplicitTier(input, preferred);

  // Sort remaining candidates by USD-equivalent cost ascending.
  // P15 (Option A): google-default tiebreaker removed — pure cost sort.
  const sorted = [...preferred].sort((a, b) => {
    const aUsd = normalizeCostUSDSafe(a, input);
    const bUsd = normalizeCostUSDSafe(b, input);
    return aUsd - bUsd;
  });
  const picked = explicit ?? sorted[0]!;

  const estimatedCostUSD = normalizeCostUSDSafe(picked, input);
  // FIX (Codex P2 round 5, PR#10): when ALL viable candidates ended up
  // unpriced (Infinity), surface the misconfiguration instead of returning a
  // routing decision whose cost is NaN-equivalent. Triggers when all matches
  // are credit-priced AND MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is unset.
  if (!Number.isFinite(estimatedCostUSD)) {
    throw new Error(
      `no priceable provider for mode='${input.mode}' durationSec=${input.durationSec} resolution=${input.resolution}. ` +
        `All candidates are credit-priced and MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is unset/invalid. ` +
        `Set the env var to a positive number (USD per Higgsfield credit) before routing.`,
    );
  }
  const rationale = buildRationale(picked, input, sorted.length, explicit !== undefined);

  return {
    provider: picked.provider,
    modelId: picked.id,
    mode: input.mode,
    estimatedCostUSD,
    rationale,
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

// ---------------------------------------------------------------------------
// handleKlingMotionBrush — Kling V3 Pro motion brush: paint regions with motion vectors (P15 Task 6)
// Per-call KlingProvider construction is intentional: KlingProvider takes env in constructor
// and per-call construction ensures tests using tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export interface KlingHandlerExecOpts {
  readonly fetchImpl?: typeof fetch;
  /** F-B: when present, handleKlingPoll presigns the MinIO artifact uploaded by the webhook handler. */
  readonly storage?: OutputStorageClient;
}

export async function handleKlingMotionBrush(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number }> {
  const input: KlingMotionBrushInputT = KlingMotionBrushInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: input.modelId,
    mode: 'motion-brush' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: '1080p' as const,
    firstFrameImagePath: input.imageUrl,
    extras: {
      providerKind: 'kling' as const,
      motionBrushRegions: input.regions,
      watermarkEnabled: input.watermarkEnabled,
      characterOrientation: input.characterOrientation,
      motionReferenceVideoUrl: input.videoReferenceUrl,
      klingMode: 'pro' as const,
    },
  };
  const handle = await provider.generate(req);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// ---------------------------------------------------------------------------
// handleKlingElementCreate — create element from image URL or base64 (P15 Task 6.5)
// Per-call construction (no singleton) — KlingProvider / kling-elements use env in call.
// ---------------------------------------------------------------------------

export async function handleKlingElementCreate(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ elementId: string; displayName: string; category?: string; createdAt: string }> {
  const input: KlingElementCreateInputT = KlingElementCreateInput.parse(rawInput);
  const meta = await createKlingElement({
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
    imageUrl: input.imageUrl,
    imageBase64: input.imageBase64,
    displayName: input.displayName,
    category: input.category,
  });
  const db = openDb(defaultDbPath());
  runMigrations(db);
  db.prepare(
    `INSERT OR REPLACE INTO kling_elements (element_id, display_name, category, source_url, created_at, last_used_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(meta.elementId, meta.displayName, meta.category ?? null, input.imageUrl ?? null);
  return meta;
}

// ---------------------------------------------------------------------------
// handleKlingElementList — list elements from local cache (+ optional backend sync) (P15 Task 6.6)
// ---------------------------------------------------------------------------

export async function handleKlingElementList(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{
  source: 'cache' | 'cache+backend';
  elements: Array<{ elementId: string; displayName: string; category?: string; createdAt: string; lastUsedAt?: string }>;
}> {
  const input: KlingElementListInputT = KlingElementListInput.parse(rawInput);
  const db = openDb(defaultDbPath());
  runMigrations(db);

  let where = input.includeDeleted ? '1=1' : 'deleted_at IS NULL';
  const params: string[] = [];
  if (input.category) {
    where += ' AND category = ?';
    params.push(input.category);
  }
  const localRows = db.prepare(`SELECT element_id, display_name, category, created_at, last_used_at FROM kling_elements WHERE ${where}`).all(...params) as Array<{
    element_id: string;
    display_name: string;
    category?: string;
    created_at: string;
    last_used_at?: string;
  }>;
  type ElementRow = { elementId: string; displayName: string; category: string | undefined; createdAt: string; lastUsedAt: string | undefined };
  let elements: ElementRow[] = localRows.map((r) => ({
    elementId: r.element_id,
    displayName: r.display_name,
    category: r.category,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));

  if (input.syncWithBackend) {
    const remote = await listKlingElementsFromBackend({ env: process.env as never, fetchImpl: opts.fetchImpl });
    const localById = new Map(elements.map((e) => [e.elementId, e]));
    // Upsert ALL remote rows so the local cache stays complete regardless of
    // caller's category filter — cache freshness is independent of the query.
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO kling_elements (element_id, display_name, category, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const e of remote) {
      upsert.run(e.elementId, e.displayName, e.category ?? null, e.createdAt, localById.get(e.elementId)?.lastUsedAt ?? null);
    }
    // FIX (Codex P2 round 12, PR#11): preserve `input.category` filter when
    // returning the synced list. Round 9 added the local SQL WHERE clause for
    // category, but the sync branch overwrote `elements` with the unfiltered
    // remote map — so `{ category: 'character', syncWithBackend: true }`
    // returned products/locations too. Filter the returned list only; the
    // upsert above keeps the cache fresh either way.
    const remoteMapped = remote.map((r) => ({
      ...r,
      category: r.category,
      lastUsedAt: localById.get(r.elementId)?.lastUsedAt,
    }));
    elements = input.category
      ? remoteMapped.filter((e) => e.category === input.category)
      : remoteMapped;
    return { source: 'cache+backend', elements };
  }
  return { source: 'cache', elements };
}

// ---------------------------------------------------------------------------
// handleKlingElementDelete — soft-delete locally + (default) hard-delete on backend (P15 Task 6.7)
// Requires confirm:true — irreversible on backend.
// ---------------------------------------------------------------------------

export async function handleKlingElementDelete(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ elementId: string; localDeleted: boolean; remoteDeleted: boolean }> {
  const input: KlingElementDeleteInputT = KlingElementDeleteInput.parse(rawInput);
  let remoteDeleted = false;
  if (input.alsoDeleteRemote) {
    await deleteKlingElement({ env: process.env as never, fetchImpl: opts.fetchImpl, elementId: input.elementId });
    remoteDeleted = true;
  }
  const db = openDb(defaultDbPath());
  runMigrations(db);
  const result = db.prepare(`UPDATE kling_elements SET deleted_at = datetime('now') WHERE element_id = ?`).run(input.elementId);
  return { elementId: input.elementId, localDeleted: result.changes > 0, remoteDeleted };
}

// ---------------------------------------------------------------------------
// handleKlingElements — compose up to 4 frame-locked element identities into one shot (P15 Task 7)
// Per-call KlingProvider construction is intentional: KlingProvider takes env in constructor
// and per-call construction ensures tests using tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export async function handleKlingElements(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number }> {
  const input: KlingElementsInputT = KlingElementsInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: input.modelId,
    mode: 'elements' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: '1080p' as const,
    aspectRatio: input.aspectRatio,
    firstFrameImagePath: input.imageUrl,
    extras: {
      providerKind: 'kling' as const,
      elementIds: input.elementIds,
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro' as const,
    },
  };
  const handle = await provider.generate(req);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// ---------------------------------------------------------------------------
// handleKlingLipSync — Kling V3 Pro lip-sync: text or audio driven (P15 Task 8)
// Per-call KlingProvider construction ensures tests with tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export async function handleKlingLipSync(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number }> {
  const input: KlingLipSyncInputT = KlingLipSyncInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: input.modelId,
    mode: 'lip-sync' as const,
    prompt: input.text ?? '(audio-driven lip-sync)',
    durationSec: 5,
    resolution: '1080p' as const,
    extras: {
      providerKind: 'kling' as const,
      lipSync: {
        mode: (input.text ? 'text' : 'audio') as 'text' | 'audio',
        text: input.text,
        audioUrl: input.audioUrl,
        emotion: input.emotion,
      },
      motionReferenceVideoUrl: input.videoUrl,
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro' as const,
    },
  };
  const handle = await provider.generate(req);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// handleKlingOmniMultiShot — Kling V3 Omni multi-shot orchestration (P15 Task 9)
// Single API call generates up to 6 contiguous cuts with per-shot prompt + duration.
// Per-call KlingProvider construction ensures tests with tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export async function handleKlingOmniMultiShot(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number }> {
  const input: KlingOmniMultiShotInputT = KlingOmniMultiShotInput.parse(rawInput);
  const totalDuration = input.shots.reduce((sum, s) => sum + s.duration, 0);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: 'kling-v3-omni' as const,
    mode: 'multi-shot' as const,
    prompt: input.shots.map((s) => s.prompt).join(' | '),
    durationSec: totalDuration,
    resolution: '1080p' as const,
    aspectRatio: input.aspectRatio,
    extras: {
      providerKind: 'kling' as const,
      omniMultiShot: {
        multiPrompt: input.shots,
        imageList: input.imageRefs,
        videoList: input.videoRefs,
      },
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro' as const,
    },
  };
  const handle = await provider.generate(req);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
}

// ---------------------------------------------------------------------------
// handleKlingVideoExtend — Kling V3 Pro video extension: add ~4.5s per hop (P15 Task 10)
// Per-call KlingProvider construction ensures tests with tmp envs get isolated instances.
// ---------------------------------------------------------------------------

/** Duration added per single extend hop, in seconds. */
const KLING_EXTEND_HOP_SEC = 4.5;

export async function handleKlingVideoExtend(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{
  jobId: string;
  provider: string;
  modelId: string;
  estimatedCostUSD: number;
  hopsRemaining: number;
}> {
  const input: KlingVideoExtendInputT = KlingVideoExtendInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const handle = await provider.generate({
    modelId: input.modelId,
    mode: 'extend',
    prompt: input.prompt,
    durationSec: KLING_EXTEND_HOP_SEC,
    resolution: '1080p',
    extras: {
      providerKind: 'kling',
      motionReferenceVideoUrl: input.videoUrl,
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro',
    },
  });
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    // FIX (Codex P2 round 13, PR#11): this handler submits a SINGLE hop per
    // call (durationSec: KLING_EXTEND_HOP_SEC above) and asks the caller to
    // re-invoke for the rest via `hopsRemaining`. The estimate must match
    // what actually goes through recordJob — multiplying by input.hops over-
    // reports the cost on call 1 and under-reports on later calls, breaking
    // any client that sums estimates across the chain.
    estimatedCostUSD: provider.estimateCostUSD({
      modelId: input.modelId,
      mode: 'extend',
      prompt: input.prompt,
      durationSec: KLING_EXTEND_HOP_SEC,
      resolution: '1080p',
    }),
    hopsRemaining: input.hops - 1,
  };
}

// ---------------------------------------------------------------------------
// handleKlingPoll / handleKlingDownload — manual completion path
// FIX (Codex P1 round 6, PR#11): default MCP Kling tools suppress callback_url
// (HMAC mismatch) and the throwaway provider's per-process jobTypeMap dies
// the moment the handler returns. These tools rehydrate the provider state
// from the cost-tracker DB so an operator can drive a submitted job to
// completion without depending on a registered webhook.
// ---------------------------------------------------------------------------

interface KlingPollResult {
  jobId: string;
  state: string;
  assetUrls?: readonly string[];
  url?: string;
  expires_at?: string;
  errorMessage?: string;
  progress?: number;
}

export async function handleKlingPoll(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<KlingPollResult> {
  const input: KlingPollInputT = KlingPollInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  provider.hydrateFromDb(input.jobId);
  const status = await provider.pollStatus(input.jobId);
  // FIX (Codex P2 round 13, PR#11): when callbacks are suppressed (the default
  // for the MCP Kling tools — HMAC mismatch blocks the webhook path) and the
  // task polls as `failed`, the row stays `pending` forever because no other
  // path persists the terminal state. Mirror kling-webhook-handler.ts:
  // UPDATE video_jobs SET status='failed' WHERE status != 'completed'.
  if (status.state === 'failed') {
    const db = openDb(defaultDbPath());
    runMigrations(db);
    db.prepare(
      "UPDATE video_jobs SET status = 'failed', actual_usd = COALESCE(actual_usd, 0), completed_at = ? WHERE id = ? AND status != 'completed'",
    ).run(new Date().toISOString(), input.jobId);
  }

  // F-B: quando completed e storage configurado, presign do artefato já no MinIO
  // (uploaded pelo webhook handler). Se o objeto não existir (webhook não chegou /
  // callback suprimido no path manual), cair no fallback assetUrls do provider.
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
    ...(status.assetUrls ? { assetUrls: status.assetUrls } : {}),
    ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
    ...(typeof status.progress === 'number' ? { progress: status.progress } : {}),
    ...(signedUrl !== undefined ? { url: signedUrl, expires_at: expiresAt } : {}),
  };
}

export async function handleKlingDownload(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{
  jobIdOrUrl: string;
  outputPath: string;
  sizeBytes: number;
  contentType: string;
  actualUsd?: number;
}> {
  const input: KlingDownloadInputT = KlingDownloadInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  // Hydrate only when caller passed a jobId (not a raw URL).
  const looksLikeUrl =
    input.jobIdOrUrl.startsWith('http://') || input.jobIdOrUrl.startsWith('https://');
  if (!looksLikeUrl) provider.hydrateFromDb(input.jobIdOrUrl);
  const asset = await provider.download(input.jobIdOrUrl);

  const projectDir =
    process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
  const outputsDir = process.env['MEDIA_FORGE_OUTPUTS_DIR'] ?? join(projectDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });
  const baseName = looksLikeUrl
    ? `kling-download-${Date.now()}.mp4`
    : `${input.jobIdOrUrl}.mp4`;
  const outputPath = join(outputsDir, baseName);
  writeFileSync(outputPath, asset.buffer);

  // FIX (Codex P1 round 7, PR#11): manual completion path must flip the
  // video_jobs row to terminal. Without this, jobs downloaded via
  // media_kling_download stayed 'pending' forever (symmetric to the round 6
  // webhook-handler bug). Use est_usd as the actualUsd fallback when no
  // explicit duration is available locally.
  //
  // FIX (Codex local round 8, PR#11): emit stderr warnings whenever the
  // cost ledger is touched without authoritative pricing data. Operators
  // pulling the cost-report later need a way to spot rows that were closed
  // with a fallback or skipped entirely; silent 0/skip masked dropped data.
  let actualUsd: number | undefined;
  if (looksLikeUrl) {
    process.stderr.write(
      `[kling-download] raw URL path — no jobId to reconcile; cost-tracker NOT updated for ${input.jobIdOrUrl}\n`,
    );
  } else {
    const db = openDb(defaultDbPath());
    runMigrations(db);
    const row = db
      .prepare('SELECT est_usd FROM video_jobs WHERE id = ?')
      .get(input.jobIdOrUrl) as { est_usd?: number } | undefined;
    if (typeof row?.est_usd === 'number' && Number.isFinite(row.est_usd)) {
      actualUsd = row.est_usd;
    } else {
      actualUsd = 0;
      process.stderr.write(
        `[kling-download] job ${input.jobIdOrUrl} has no est_usd in video_jobs — ` +
          `recording actualUsd=0 to flip terminal status. Cost ledger may underreport.\n`,
      );
    }
    recordActualCost({ dbPath: defaultDbPath(), jobId: input.jobIdOrUrl, actualUsd });
  }

  return {
    jobIdOrUrl: input.jobIdOrUrl,
    outputPath,
    sizeBytes: asset.metadata.sizeBytes ?? asset.buffer.length,
    contentType: asset.metadata.contentType,
    ...(typeof actualUsd === 'number' ? { actualUsd } : {}),
  };
}

function normalizeCostUSDSafe(spec: VideoModelSpec, input: VideoRouteInputT): number {
  try {
    const usdPerCredit = parseFloat(
      process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] ?? 'NaN',
    );
    const result = normalizeCostUSD(spec, {
      durationSec: input.durationSec,
      usdPerCredit,
      // FIX (Codex P2 round 16, PR#12): forward resolution so per-second specs
      // with resolutionMultipliers (Seedance) price 1080p/480p correctly during
      // cross-provider ranking instead of always at 720p baseline.
      resolution: input.resolution,
    });
    // Guard against NaN / ±Infinity from malformed env values (e.g. usdPerCredit=NaN
    // multiplied by rate produces NaN, which breaks sort comparisons).
    return Number.isFinite(result) ? result : Number.POSITIVE_INFINITY;
  } catch {
    // If a credits-per-video spec is missing a valid usdPerCredit, treat it as
    // infinite cost so it never wins ranking against a priced provider. The
    // director surfaces the configuration error to the user separately.
    return Number.POSITIVE_INFINITY;
  }
}

// P15: explicit tier overrides — hard-wire specific modes/resolutions to a Kling model
// before the cost-based sort. Only checked when preferProvider is not set.
function pickExplicitTier(
  input: VideoRouteInputT,
  candidates: ReadonlyArray<VideoModelSpec>,
): VideoModelSpec | undefined {
  // 4K resolution → kling-v3-master (only registered 4K-native provider)
  if (input.resolution === '4k') {
    return candidates.find((c) => c.id === 'kling-v3-master');
  }
  // Multi-shot routing (Codex P2 round 12, PR#12): P15 hard-wired this to
  // kling-v3-omni because Veo + Higgsfield did not support it. P16 added
  // Seedance which advertises 'multi-shot' too. Kling-omni only retains
  // the explicit-tier crown when the request exceeds Seedance's caps
  // (>15s total OR >4 shots — see SeedanceMultishotInput refines).
  // Otherwise fall through to the cost sort so the cheaper provider wins.
  if (input.mode === 'multi-shot') {
    const beyondSeedance = input.durationSec > 15;
    if (beyondSeedance) {
      return candidates.find((c) => c.id === 'kling-v3-omni');
    }
    // For requests within Seedance's range, let the cost sort decide
    // between kling-v3-omni and seedance-2.0-standard/fast.
    return undefined;
  }
  // Motion-brush, elements, and lip-sync are Kling V3 Pro-only modes in the current registry
  if (input.mode === 'motion-brush' || input.mode === 'elements' || input.mode === 'lip-sync') {
    return candidates.find((c) => c.id === 'kling-v3-pro');
  }
  return undefined;
}

function buildRationale(
  picked: VideoModelSpec,
  input: VideoRouteInputT,
  candidateCount: number,
  isExplicitTier: boolean,
): string {
  if (isExplicitTier) {
    return `P15 explicit tier: mode=${input.mode}/resolution=${input.resolution} routes to ${picked.id}.`;
  }
  if (input.mode === 'targeted-edit') {
    // FIX (CodeRabbit round 12, PR#12): stale exclusivity claim. P16 added
    // Seedance Standard/Fast which also support targeted-edit (via i2v.endImageUrl).
    // Reflect provider in the rationale instead of asserting Recast exclusivity.
    if (picked.provider === 'higgsfield') {
      return `higgsfield Recast handles targeted-edit (P14) → ${picked.id}.`;
    }
    if (picked.provider === 'bytedance') {
      return `Seedance absorbs targeted-edit via i2v.endImageUrl (P16) → ${picked.id}.`;
    }
    return `targeted-edit routed to ${picked.id}.`;
  }
  if (input.preferProvider) {
    return `preferProvider=${input.preferProvider} → ${picked.id}.`;
  }
  if (candidateCount === 1) {
    return `${picked.id} is the only candidate for mode ${input.mode}.`;
  }
  return (
    `Cheapest USD-equivalent candidate for mode ${input.mode}: ${picked.id} at ` +
    `$${normalizeCostUSDSafe(picked, input).toFixed(4)}/s. ` +
    `Use preferProvider to override.`
  );
}


// ---------------------------------------------------------------------------
// Seedance 2.0 (ByteDance) handlers — P16 Task 7 (4 tools per A0.5)
// All four reuse the lazy singleton getBytedanceSeedanceProvider() — provider
// is stateful (in-memory routeByJobId + falConfigured flag) so per-call
// construction would lose webhook routing context. The singleton is bound at
// first-use to defaultDbPath()/process.env; tests override via the
// __resetBytedanceSeedanceSingleton() hook before each test runs.
// ---------------------------------------------------------------------------

interface SeedanceHandlerResult {
  jobId: string;
  provider: string;
  model: string;
  mode: string;
  estimatedCostUSD: number;
  providerNativeId?: string;
}

function seedanceProvider(): ReturnType<typeof getBytedanceSeedanceProvider> {
  return getBytedanceSeedanceProvider({
    dbPath: defaultDbPath(),
    env: process.env as unknown as BytedanceSeedanceEnv,
  });
}

function seedanceModelIdFor(tier: 'fast' | 'standard'): 'seedance-2.0-fast' | 'seedance-2.0-standard' {
  return tier === 'fast' ? 'seedance-2.0-fast' : 'seedance-2.0-standard';
}

/**
 * Resolve a duration suitable for cost estimation + the provider request. When
 * the caller leaves `durationSec` unset (default `'auto'` on fal.ai), we fall
 * back to 5s for cost preview — fal.ai's auto-mode typically lands in the 4-6s
 * range and the actual cost is recorded via pollStatus from the per-second
 * registry rate once the job completes.
 *
 * FIX (Codex P2 round 13, PR#12): also return whether the caller opted in to
 * fal.ai auto-mode so `buildFalInput` can omit `duration` from the payload.
 * The previous behavior coerced `undefined → 5` and then always sent
 * `duration: "5"` to fal, fixing the clip length even when the user wanted
 * auto-mode.
 */
function seedanceDurationOrDefault(
  durationSec: number | undefined,
): { value: number; isAuto: boolean } {
  return typeof durationSec === 'number'
    ? { value: durationSec, isAuto: false }
    : { value: 5, isAuto: true };
}

/**
 * The base `VideoGenerationRequest.resolution` union (`'720p'|'1080p'|'2k'|'4k'`)
 * predates Seedance — it does NOT yet include `'480p'`. Seedance providers
 * already accept the string at runtime (bytedance-seedance.ts internally casts
 * to `'480p'|'720p'|'1080p'`). Widening the base contract is deferred to a
 * separate base.ts refactor; for now we cast at the handler boundary. The
 * provider's `pickEndpoint` + `buildFalInput` already validate the runtime
 * value against per-mode capability.
 */
function castSeedanceResolution(r: '480p' | '720p' | '1080p'): '720p' | '1080p' | '2k' | '4k' {
  return r as unknown as '720p' | '1080p' | '2k' | '4k';
}

// ---- 1. handleSeedanceTextToVideo ----

export async function handleSeedanceTextToVideo(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceTextToVideoInputT = SeedanceTextToVideoInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  const duration = seedanceDurationOrDefault(input.durationSec);
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2, PR#12): propagate caller's generateAudio + endUserId.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    ...(duration.isAuto ? { durationAutoMode: true } : {}),
  };
  const req = {
    modelId,
    mode: 't2v' as const,
    prompt: input.prompt,
    durationSec: duration.value,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

// ---- 2. handleSeedanceImageToVideo (absorbs targeted_edit via endImageUrl) ----

export async function handleSeedanceImageToVideo(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceImageToVideoInputT = SeedanceImageToVideoInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  const duration = seedanceDurationOrDefault(input.durationSec);
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2, PR#12): propagate caller's generateAudio + endUserId.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    ...(duration.isAuto ? { durationAutoMode: true } : {}),
  };
  const req = {
    modelId,
    mode: 'i2v' as const,
    prompt: input.prompt,
    durationSec: duration.value,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    firstFrameImagePath: input.imageUrl,
    ...(input.endImageUrl !== undefined ? { lastFrameImagePath: input.endImageUrl } : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

// ---- 3. handleSeedanceMultishot ----

export async function handleSeedanceMultishot(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceMultishotInputT = SeedanceMultishotInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  // FIX (Codex P2 round 5, PR#12): use max(endSec) - min(startSec) for the
  // total elapsed duration instead of summing spans. Catches non-contiguous
  // shots + first shot starting > 0. Without this, cost estimation undershoots
  // and provider receives absolute timestamps inconsistent with reported
  // duration.
  const firstStart = Math.min(...input.shots.map((s) => s.startSec));
  if (firstStart !== 0) {
    throw new Error(
      `Seedance multishot: first shot must start at 0 (got ${firstStart}s). Shots must be contiguous and start from zero.`,
    );
  }
  const sortedShots = [...input.shots].sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < sortedShots.length; i++) {
    if (sortedShots[i]!.startSec !== sortedShots[i - 1]!.endSec) {
      throw new Error(
        `Seedance multishot: shots must be contiguous. Shot ${i} starts at ${sortedShots[i]!.startSec}s but previous shot ends at ${sortedShots[i - 1]!.endSec}s.`,
      );
    }
  }
  const durationSec = Math.max(...input.shots.map((s) => s.endSec));
  // FIX (Codex P2 round 6, PR#12): preserve chronological order in the
  // serialized prompt. Without this, `[5-10, 0-5]` passed contiguity (after
  // sorting) but the timestamp prompt emitted "Shot 1 starts at 5s, Shot 2
  // starts at 0s" — misdirecting Seedance instead of normalizing input.
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    multiShotTimestamps: sortedShots.map((s) => ({
      start: s.startSec,
      end: s.endSec,
      prompt: s.shotPrompt,
    })),
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2 round 2, PR#12): propagate audio + user options for multishot too.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
  };
  const req = {
    modelId,
    mode: 'multi-shot' as const,
    prompt: input.prompt,
    durationSec,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

// ---- 4. handleSeedanceReferenceFusion ----

export async function handleSeedanceReferenceFusion(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceReferenceFusionInputT = SeedanceReferenceFusionInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  const duration = seedanceDurationOrDefault(input.durationSec);
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    functionMode: 'omni_reference',
    ...(input.imageUrls.length > 0 ? { referenceImageUrls: input.imageUrls } : {}),
    ...(input.videoUrls.length > 0 ? { referenceVideoUrls: input.videoUrls } : {}),
    ...(input.audioUrls.length > 0 ? { referenceAudioUrls: input.audioUrls } : {}),
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2 round 2, PR#12): propagate audio + user options for reference_fusion too.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    ...(duration.isAuto ? { durationAutoMode: true } : {}),
  };
  const req = {
    modelId,
    mode: 'with-refs' as const,
    prompt: input.prompt,
    durationSec: duration.value,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

export interface HandlersDeps {
  client: MediaForgeClient;
  config: MediaForgeConfig;
  outputManager?: OutputManager;
  /** F-B: quando presente, artefatos sao enviados para MinIO; resultado retorna url + expires_at. */
  storage?: OutputStorageClient;
  /** F-C: tier do tenant — controla quais tools sao registradas. undefined = 'pro' (backward compat). */
  tier?: import('../http/auth.js').Tier;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

type ToolHandler = (input: unknown) => Promise<ToolResult>;

// Escape hatch type: the SDK's registerTool overload requires ToolCallback<InputArgs>
// which is tightly coupled to the inputSchema generic. Since all our handlers operate
// on `unknown` inputs validated at runtime, we loosen the call-site via this helper.
type LooseRegisterTool = (
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
  },
  cb: ToolHandler,
) => void;

function looseRegister(server: McpServer): LooseRegisterTool {
  return (server as unknown as { registerTool: LooseRegisterTool }).registerTool.bind(server);
}

// ---------------------------------------------------------------------------
// Wrap: unified error handling + logging for every tool handler
// ---------------------------------------------------------------------------

function wrap(name: string, fn: ToolHandler): ToolHandler {
  return async (input) => {
    const start = Date.now();
    try {
      const result = await fn(input);
      logger.debug('mcp tool ok', { name, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logger.warn('mcp tool error', { name, msg, durationMs: Date.now() - start });
      return {
        content: [{ type: 'text' as const, text: msg }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// asResult: uniform structured response wrapper
// ---------------------------------------------------------------------------

function asResult(structured: unknown): {
  content: [{ type: 'text'; text: string }];
  structuredContent: unknown;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// validateInput: use validationSchema (superRefine) when available, else inputSchema
// ---------------------------------------------------------------------------

function validateInput<T>(tool: MCPTool, input: unknown): T {
  const schema: ZodTypeAny = tool.validationSchema ?? tool.inputSchema;
  return schema.parse(input) as T;
}

// ---------------------------------------------------------------------------
// Static capability matrix built from models.ts constants
// ---------------------------------------------------------------------------

const CAPABILITY_MATRIX = {
  [IMAGE_MODEL_NANO_BANANA_PRO]: {
    type: 'image',
    aspectRatios: ASPECT_RATIO_NANO_BANANA,
    imageSizes: IMAGE_SIZE,
    thinkingLevels: THINKING_LEVELS,
    personGeneration: PERSON_GENERATION_IMAGE,
    supportsComposition: true,
    supportsEditing: true,
    maxReferenceImages: 14,
  },
  [IMAGE_MODEL_IMAGEN_4_ULTRA]: {
    type: 'image',
    aspectRatios: ASPECT_RATIO_IMAGEN,
    supportsNegativePrompt: true,
    supportsSeed: true,
    personGeneration: PERSON_GENERATION_IMAGE,
    maxImagesPerRequest: 4,
  },
  [VIDEO_MODEL_VEO_3_1_PRO]: {
    type: 'video',
    aspectRatios: ASPECT_RATIO_VIDEO,
    resolutions: VIDEO_RESOLUTION,
    durationSeconds: VIDEO_DURATION_SECONDS,
    personGeneration: PERSON_GENERATION_VIDEO,
    supportsAudio: true,
    supportsI2V: true,
    supportsInterpolation: true,
    supportsExtension: true,
    maxExtensionHops: 20,
    extensionResolution: '720p',
  },
} as const;

// ---------------------------------------------------------------------------
// Tool help text (static per tool, or listing all tools)
// ---------------------------------------------------------------------------

function buildHelpText(topic: string | undefined): string {
  if (!topic) {
    const lines = ['media-forge MCP tools:', ''];
    for (const tool of MCP_TOOLS) {
      lines.push(`  ${tool.name}  —  ${tool.description}`);
    }
    lines.push('');
    lines.push('Use topic="<tool_name>" for detailed help on a specific tool.');
    return lines.join('\n');
  }

  const tool = MCP_TOOLS.find((t) => t.name === topic);
  if (!tool) {
    return `Unknown tool: "${topic}". Call media_help with no topic to list all tools.`;
  }

  return [
    `Tool: ${tool.name}`,
    `Description: ${tool.description}`,
    '',
    'Input schema (Zod): see MCP_TOOLS registry in schemas.ts',
    '',
    'Usage example: call this tool via MCP with the required parameters.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// registerAllTools — main export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F-B: image artifact upload helper
// ---------------------------------------------------------------------------
// The image services return { base64, mimeType, ... } (NOT a Buffer and NOT a
// jobId). When storage is configured and the result carries real image bytes
// (not a dry-run), decode base64 -> Buffer, mint a deterministic jobId via the
// shared minter, upload to MinIO and return signed { url, expires_at } merged
// into the result. Graceful degradation: no storage / dry-run / empty bytes ->
// the original result passes through unchanged (F-A behaviour).
type ImageGenResult = {
  base64: string;
  mimeType: string;
  dryRun?: boolean;
};

async function maybeStoreImageArtifact(
  result: ImageGenResult,
  storage: OutputStorageClient | undefined,
  prefix: string,
): Promise<unknown> {
  if (!storage || result.dryRun || !result.base64) {
    return result;
  }
  try {
    const id = generateJobId(prefix);
    const bytes = Buffer.from(result.base64, 'base64');
    const artifact = await storeArtifact({
      storage,
      jobId: id,
      bytes,
      contentType: result.mimeType,
    });
    return { ...result, job_id: id, url: artifact.url, expires_at: artifact.expiresAt };
  } catch (err) {
    // Best-effort: upload failure must not drop the generated image. Surface the
    // base64 result (F-A path) so the caller still receives the artifact.
    process.stderr.write(
      `[image-storage] upload failed (${prefix}): ${(err as Error).message}\n`,
    );
    return result;
  }
}

export function registerAllTools(server: McpServer, deps: HandlersDeps): void {
  const { client, config, storage } = deps;
  const reg = looseRegister(server);

  // F-C: tier gating — pula o registro de tools fora do gate do tier.
  // undefined/missing tier = 'pro' (backward compat para stdio + testes existentes).
  const effectiveTier = deps.tier ?? 'pro';
  function regIfAllowed(name: string, cfg: Parameters<LooseRegisterTool>[1], cb: Parameters<LooseRegisterTool>[2]): void {
    if (!isToolAllowed(effectiveTier, name)) return;
    reg(name, cfg, cb);
  }

  function getTool(name: string) {
    const t = MCP_TOOLS.find((tool) => tool.name === name);
    if (!t) throw new Error(`BUG: tool ${name} not found in MCP_TOOLS registry`);
    return t;
  }

  // ---- Image tools (6) ----

  {
    const t = getTool('media_generate_image');
    regIfAllowed(
      t.name,
      { title: 'Generate Image (Nano Banana Pro)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const result = await generateImageNanoBananaPro(validateInput(t, input), client);
        return asResult(await maybeStoreImageArtifact(result, storage, 'nano-banana-pro'));
      }),
    );
  }

  {
    const t = getTool('media_generate_imagen');
    regIfAllowed(
      t.name,
      { title: 'Generate Image (Imagen 4 Ultra)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const result = await generateImageImagen4Ultra(input as never, client);
        return asResult(await maybeStoreImageArtifact(result, storage, 'imagen-4-ultra'));
      }),
    );
  }

  {
    const t = getTool('media_edit_image');
    regIfAllowed(
      t.name,
      { title: 'Edit Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await editImage(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_compose_scene');
    regIfAllowed(
      t.name,
      { title: 'Compose Scene', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await composeScene(input as never, client))),
    );
  }

  {
    const t = getTool('media_describe_image');
    regIfAllowed(
      t.name,
      { title: 'Describe Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await describeImage(input as never, client))),
    );
  }

  {
    const t = getTool('media_extract_palette');
    regIfAllowed(
      t.name,
      { title: 'Extract Color Palette', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await extractPalette(input as never))),
    );
  }

  // ---- Video tools (7) ----

  {
    const t = getTool('media_generate_video_t2v');
    regIfAllowed(
      t.name,
      { title: 'Generate Video (Text to Video)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoT2V(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_i2v');
    regIfAllowed(
      t.name,
      { title: 'Generate Video (Image to Video)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoI2V(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_interpolate');
    regIfAllowed(
      t.name,
      { title: 'Generate Video (Interpolate)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoInterpolate(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_with_refs');
    regIfAllowed(
      t.name,
      { title: 'Generate Video With References', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoWithRefs(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_extend_video');
    // Adapter: ExtendVideoInput → ExtendOpts
    // v0.1.0 limitation: treats sourceVideoPath as sourceVideoUri, prompt as both
    // originalPrompt and extensionDirective (no separate directive field in schema).
    regIfAllowed(
      t.name,
      { title: 'Extend Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as {
          sourceVideoPath: string;
          prompt: string;
          hopIndex: number;
          dryRun?: boolean;
        };
        return asResult(
          await extendVideo({
            client,
            sourceVideoUri: inp.sourceVideoPath,
            sourceMimeType: 'video/mp4',
            originalPrompt: inp.prompt,
            extensionDirective: inp.prompt,
            hopIndex: inp.hopIndex ?? 0,
          }),
        );
      }),
    );
  }

  {
    const t = getTool('media_poll_video_operation');
    regIfAllowed(
      t.name,
      { title: 'Poll Video Operation', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { operationName: string; intervalMs?: number; timeoutMs?: number };
        const intervalMs = inp.intervalMs ?? 10000;
        // Round UP so a non-multiple timeout (e.g. timeoutMs=119999 / intervalMs=60000)
        // still gets the caller's full requested wait window. Math.floor would chop
        // off the partial last attempt. Matches the CLI poll/wait derivation.
        const maxAttempts = Math.ceil((inp.timeoutMs ?? 900000) / intervalMs);
        return asResult(
          await pollVideoOperation({
            client,
            operationName: inp.operationName,
            intervalMs,
            maxAttempts,
          }),
        );
      }),
    );
  }

  {
    const t = getTool('media_download_video');
    // v0.1.0: downloadVideo requires a direct videoUri (not an operationName).
    // If caller passes an operation name instead of a resolved URI, return a
    // structured error note rather than making a broken HTTP request.
    regIfAllowed(
      t.name,
      { title: 'Download Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as {
          operationName: string;
          outputDir?: string;
          filename?: string;
        };
        // downloadVideo uses fetch() under the hood and only supports HTTP(S)
        // URIs in this runtime. gs:// URIs (common in Vertex outputs) would
        // need to be signed first; reject with a clear actionable error
        // instead of failing late inside fetch.
        const isHttpUri =
          inp.operationName.startsWith('https://') || inp.operationName.startsWith('http://');
        const isGsUri = inp.operationName.startsWith('gs://');
        if (isGsUri) {
          return asResult({
            ok: false,
            note: 'media_download_video does not yet support gs:// URIs. Sign the GCS object to an https:// URL first (gsutil signurl or Cloud Storage signed URL API) and pass that here.',
            operationName: inp.operationName,
          });
        }
        if (!isHttpUri) {
          return asResult({
            ok: false,
            note: 'media_download_video requires a resolved https:// video URI. Re-poll the operation with media_poll_video_operation to get the videoUri from the response, then call this tool.',
            operationName: inp.operationName,
          });
        }
        return asResult(
          await downloadVideo({
            client,
            videoUri: inp.operationName,
            apiKey: config.apiKey,
            outputDir: inp.outputDir ?? config.outputDir,
            filename: inp.filename,
          }),
        );
      }),
    );
  }

  // ---- Pipeline / Utility tools (8) ----

  {
    const t = getTool('media_dry_run_payload');
    regIfAllowed(
      t.name,
      { title: 'Dry Run Payload', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { op: string; params: Record<string, unknown> };
        return asResult({ dryRun: true, payload: inp });
      }),
    );
  }

  {
    const t = getTool('media_estimate_cost');
    regIfAllowed(
      t.name,
      { title: 'Estimate Cost', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { items: Array<{ op: string; params: Record<string, unknown> }> };
        let totalUsd = 0;
        const perItem: Array<{ op: string; usd: number; breakdown: string; refsBreakdown?: unknown }> = [];
        for (const item of inp.items) {
          let usd = 0;
          let breakdown = `Unknown op: ${item.op}`;
          let refsBreakdown: RefsEstimate | undefined;

          const op = item.op.toLowerCase();

          // Refs/moodboard operations — checked before generic image/video branches.
          // Triggered when params.refMode is set (MOODBOARD | SUBJECT_REF | TEXT_ONLY).
          const params_r = item.params as {
            refMode?: string;
            refCount?: number;
            subjectCount?: number;
            outputSize?: string;
            searchMode?: string;
          };
          if (params_r.refMode) {
            const mode = (['MOODBOARD', 'SUBJECT_REF', 'TEXT_ONLY'].includes(params_r.refMode ?? '')
              ? params_r.refMode
              : 'TEXT_ONLY') as 'MOODBOARD' | 'SUBJECT_REF' | 'TEXT_ONLY';
            const est = estimateRefsCost({
              mode,
              refCount: params_r.refCount ?? 0,
              subjectCount: params_r.subjectCount ?? 0,
              outputSize: (['1024', '2048', '4096'].includes(params_r.outputSize ?? '') ? params_r.outputSize : '2048') as '1024' | '2048' | '4096',
              searchMode: (params_r.searchMode === 'semantic' ? 'semantic' : 'tag'),
            });
            usd = est.totalUsd;
            breakdown = `refs/${mode}: lookup=$${est.refsLookupUsd.toFixed(4)} compose=$${est.moodboardComposeUsd.toFixed(4)} total=$${est.totalUsd.toFixed(4)}`;
            refsBreakdown = est;
          // Imagen takes priority over the generic generate_image fallback so
          // ops like `media_generate_image_imagen4_ultra` route to the Imagen
          // estimator instead of being mispriced as Nano Banana Pro.
          } else if (op.includes('imagen')) {
            const params = item.params as { numberOfImages?: number };
            const est = estimateImageCost({
              model: IMAGE_MODEL_IMAGEN_4_ULTRA,
              numberOfImages: params.numberOfImages ?? 1,
            });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('nano-banana') || op.includes('nano_banana') || op.includes('generate_image')) {
            const params = item.params as { imageSize?: string };
            const imageSize = (params.imageSize as '1K' | '2K' | '4K') ?? '4K';
            const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('video') || op.includes('veo') || op.includes('t2v') || op.includes('i2v')) {
            const params = item.params as { resolution?: string; generateAudio?: boolean };
            const est = estimateVideoCost({
              model: VIDEO_MODEL_VEO_3_1_PRO,
              resolution: (params.resolution as '720p' | '1080p' | '4k') ?? '720p',
              generateAudio: params.generateAudio ?? true,
            });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('image')) {
            // fallback: treat as nano-banana-pro
            const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize: '4K' });
            usd = est.usd;
            breakdown = est.breakdown;
          }

          totalUsd += usd;
          const entry: { op: string; usd: number; breakdown: string; refsBreakdown?: unknown } = { op: item.op, usd, breakdown };
          if (refsBreakdown !== undefined) entry.refsBreakdown = refsBreakdown;
          perItem.push(entry);
        }
        return asResult({ totalUsd, perItem });
      }),
    );
  }

  {
    const t = getTool('media_validate_environment');
    regIfAllowed(
      t.name,
      { title: 'Validate Environment', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (_input) => {
        const missing: string[] = [];
        const hasApiKey = Boolean(config.apiKey);
        const hasVertex = config.useVertex && Boolean(config.project);

        if (!hasApiKey && !hasVertex) {
          missing.push('GOOGLE_API_KEY (or GEMINI_API_KEY, or GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT)');
        }

        // Reachability check: confirm each LOCKED model id is reported by the
        // SDK's models.list endpoint. Catches the "valid key but model not
        // enabled / wrong region" false positive that pure credential checks
        // miss. If list itself fails (network/quota/403) record the error
        // rather than silently flipping ok=true.
        const lockedModels = [
          IMAGE_MODEL_NANO_BANANA_PRO,
          IMAGE_MODEL_IMAGEN_4_ULTRA,
          VIDEO_MODEL_VEO_3_1_PRO,
        ];
        const unreachable: string[] = [];
        let modelsListError: string | undefined;
        if (missing.length === 0) {
          try {
            const seen = new Set<string>();
            const pager = await client.ai.models.list();
            const page = pager as unknown as { page?: Array<{ name?: string }> };
            for (const m of page.page ?? []) {
              if (m.name) seen.add(m.name.replace(/^models\//, ''));
            }
            for (const id of lockedModels) {
              if (!seen.has(id)) unreachable.push(id);
            }
          } catch (err) {
            modelsListError = err instanceof Error ? err.message : String(err);
          }
        }

        const ok = missing.length === 0 && unreachable.length === 0 && !modelsListError;
        return asResult({
          ok,
          missing,
          ...(unreachable.length > 0 ? { unreachableModels: unreachable } : {}),
          ...(modelsListError ? { modelsListError } : {}),
        });
      }),
    );
  }

  {
    const t = getTool('media_capability_matrix');
    regIfAllowed(
      t.name,
      { title: 'Capability Matrix', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { model?: string };
        if (inp.model) {
          const entry = (CAPABILITY_MATRIX as Record<string, unknown>)[inp.model];
          if (!entry) {
            return asResult({ error: `Unknown model: ${inp.model}` });
          }
          return asResult({ [inp.model]: entry });
        }
        return asResult(CAPABILITY_MATRIX);
      }),
    );
  }

  {
    const t = getTool('media_list_outputs');
    regIfAllowed(
      t.name,
      { title: 'List Outputs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { project?: string; limit?: number };
        const limit = Math.max(1, Math.min(1000, inp.limit ?? 100));
        const jobsDir = path.join(config.projectDir, 'jobs');
        try {
          const entries = await fs.readdir(jobsDir);
          // Collect EVERY directory matching the OutputManager jobId pattern
          // before truncating. fs.readdir() does not promise chronological
          // ordering, so applying the limit during collection could drop the
          // newest jobs when more than `limit` entries exist on disk. Sort
          // first (jobId starts with ISO-like timestamp → reverse-lex ≈
          // newest-first) and slice afterwards.
          const all: Array<{ jobId: string; jobDir: string }> = [];
          for (const entry of entries) {
            if (!JOB_ID_PATTERN.test(entry)) continue;
            const jobDir = path.join(jobsDir, entry);
            const stat = await fs.stat(jobDir).catch(() => null);
            if (stat?.isDirectory()) {
              all.push({ jobId: entry, jobDir });
            }
          }
          all.sort((a, b) => b.jobId.localeCompare(a.jobId));
          const jobs = all.slice(0, limit);
          return asResult({ jobs, count: jobs.length, total: all.length, jobsDir });
        } catch (err) {
          // Directory missing simply means no jobs run yet — return empty.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return asResult({ jobs: [], count: 0, jobsDir });
          }
          throw err;
        }
      }),
    );
  }

  {
    const t = getTool('media_get_job_metadata');
    regIfAllowed(
      t.name,
      { title: 'Get Job Metadata', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { jobId: string };
        if (!JOB_ID_PATTERN.test(inp.jobId)) {
          throw new ValidationError(
            'Invalid jobId: must match [A-Za-z0-9][A-Za-z0-9_.-]{0,127}',
            { jobId: inp.jobId },
          );
        }
        // safeJoin throws FileSystemError if the resolved path escapes projectDir/jobs.
        const jobDir = safeJoin(config.projectDir, 'jobs', inp.jobId);

        // OutputManager persists artifacts in <jobDir>/v<N>/. Pick the latest
        // version (matches src/cli/commands/audit.ts behavior); fall back to
        // the job root when no version dirs exist (e.g. dry-run failure).
        const dirEntries = await fs.readdir(jobDir).catch(() => [] as string[]);
        const versions = dirEntries
          .filter((e) => /^v\d+$/.test(e))
          .map((e) => ({ name: e, n: parseInt(e.slice(1), 10) }))
          .sort((a, b) => b.n - a.n);
        const targetDir = versions.length > 0 ? path.join(jobDir, versions[0]!.name) : jobDir;

        const result: Record<string, unknown> = {
          jobId: inp.jobId,
          jobDir,
          ...(targetDir !== jobDir
            ? { versionDir: targetDir, version: path.basename(targetDir) }
            : {}),
        };

        // Read metadata.json from the version directory
        const metadataPath = path.join(targetDir, 'metadata.json');
        try {
          const raw = await fs.readFile(metadataPath, 'utf8');
          result['metadata'] = JSON.parse(raw) as unknown;
        } catch {
          result['metadata'] = null;
        }

        // Read trace.jsonl from the version directory
        const tracePath = path.join(targetDir, 'trace.jsonl');
        try {
          const raw = await fs.readFile(tracePath, 'utf8');
          result['trace'] = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => {
              try {
                return JSON.parse(l) as unknown;
              } catch {
                return l;
              }
            });
        } catch {
          result['trace'] = [];
        }

        // Read lineage.jsonl (lineage is per-job, not per-version, so stays at jobDir)
        const lineagePath = path.join(jobDir, 'lineage.jsonl');
        try {
          const raw = await fs.readFile(lineagePath, 'utf8');
          result['lineage'] = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => {
              try {
                return JSON.parse(l) as unknown;
              } catch {
                return l;
              }
            });
        } catch {
          result['lineage'] = [];
        }

        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_run_ocr');
    regIfAllowed(
      t.name,
      { title: 'Run OCR', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { imagePath: string; languages?: string[] };
        const validator = new OcrValidator({ backend: config.ocrBackend });
        const result = await validator.validateText({
          imagePath: inp.imagePath,
          requiredText: '',
          hasTextIntent: true,
          // Forward caller-supplied BCP-47 language hints to Cloud Vision so
          // multilingual assets get accurate detection. Dropping this field
          // silently degrades recognition while appearing to honor the input.
          ...(inp.languages !== undefined ? { languages: inp.languages } : {}),
        });
        return asResult({
          imagePath: inp.imagePath,
          detectedText: result.detectedText,
          backend: result.backend,
          skipped: result.skipped,
        });
      }),
    );
  }

  {
    const t = getTool('media_check_brand_compliance');
    regIfAllowed(
      t.name,
      { title: 'Check Brand Compliance', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { imagePath: string; brandGuidelinesPath: string };
        return asResult(
          await checkBrand({
            imagePath: inp.imagePath,
            guidelinesPath: inp.brandGuidelinesPath,
            // Full brand compliance: include logo identity check when
            // guidelines.logo is set in brand-guidelines.yml. checkBrand
            // no-ops the logo branch when guidelines.logo is absent, so
            // non-logo brands are unaffected.
            enableLogoDetection: true,
          }),
        );
      }),
    );
  }

  // ---- Help (1) ----

  {
    const t = getTool('media_help');
    regIfAllowed(
      t.name,
      { title: 'Help', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { topic?: string };
        const text = buildHelpText(inp.topic);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: { topic: inp.topic ?? null, text },
        };
      }),
    );
  }

  // ---- Refs tools (Phase 1+) ----

  const refsCfg = {
    endpoint: deps.config.minioEndpoint ?? '',
    region: deps.config.minioRegion,
    bucket: deps.config.minioBucket,
    accessKey: deps.config.minioAccessKey,
    secretKey: deps.config.minioSecretKey,
    useSsl: deps.config.minioUseSsl,
  };
  const refsService = createRefsService(refsCfg, deps.client, {
    pgvectorUrl: deps.config.pgvectorUrl,
    voyageApiKey: deps.config.voyageApiKey,
    projectDir: deps.config.projectDir,
  });

  {
    const t = getTool('media_refs_search');
    regIfAllowed(
      t.name,
      { title: 'Search reference assets in media-forge-refs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<RefsSearchInputT>(t, input);
        // Coalesce snake_case alias (from hook / prompt-engineer) with camelCase field.
        // Default for refsDisabled is false, so we must OR both fields (not ??) to avoid
        // clobbering a refs_disabled=true that got parsed alongside a default-false refsDisabled.
        if (parsed.refsDisabled === true || parsed.refs_disabled === true) {
          return asResult({ enabled: true, refs: [], reason: 'refs_disabled=true on this call' });
        }
        if (!deps.config.refsEnabled) {
          return asResult({ enabled: false, refs: [], reason: 'MEDIA_FORGE_REFS_ENABLED=false' });
        }
        const refs = await refsService.searchRefs(parsed);
        return asResult({ enabled: true, refs });
      }),
    );
  }

  {
    const t = getTool('media_refs_compose_moodboard');
    regIfAllowed(
      t.name,
      { title: 'Compose a moodboard keyframe from refs + subject images', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<RefsComposeMoodboardInputT>(t, input);
        const result = await refsService.composeMoodboardFromKeys(parsed);
        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_refs_presign');
    regIfAllowed(
      t.name,
      { title: 'Generate presigned URLs for ref objects', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<RefsPresignInputT>(t, input);
        const items = await refsService.presignKeys(parsed);
        return asResult({ items });
      }),
    );
  }

  {
    const t = getTool('media_refs_index');
    regIfAllowed(
      t.name,
      { title: 'Index refs bucket into pgvector (Phase 2)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const _parsed = validateInput<RefsIndexInputT>(t, input);
        return asResult({
          enabled: false,
          reason: 'Phase 2 not yet implemented. Tool reserved for future indexer.',
        });
      }),
    );
  }

  // ---- Webhook (1 — P13 scaffold for P14+ provider callbacks) ----
  //
  // Status-only tool. The router itself is started in `startStdioServer()` from
  // env vars (MEDIA_FORGE_WEBHOOK_PORT + MEDIA_FORGE_WEBHOOK_SECRET) — kept out
  // of `buildServer()` so tests that instantiate via buildServer() do not need
  // to bind a TCP port. When secret is unset, the router stays off and this tool
  // reports `{ running: false, handlers: [] }`.
  {
    const t = getTool('media_video_webhook_status');
    regIfAllowed(
      t.name,
      { title: 'Webhook Router Status', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async () => asResult(await handleVideoWebhookStatus())),
    );
  }

  // ---- Cost estimation (2 — P13 provider-registry cost tools) ----

  {
    const t = getTool('media_video_cost_estimate');
    regIfAllowed(
      t.name,
      { title: 'Video Cost Estimate', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoCostEstimate(input))),
    );
  }

  {
    const t = getTool('media_video_cost_report');
    regIfAllowed(
      t.name,
      { title: 'Video Cost Report', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoCostReport(input))),
    );
  }

  // ---- Routing (1 — P13 cross-provider routing heuristic; Veo-only today) ----

  {
    const t = getTool('media_video_route');
    regIfAllowed(
      t.name,
      { title: 'Video Provider Routing', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoRoute(input))),
    );
  }

  // ---- Higgsfield Soul ID (1 — P14 character training cache) ----

  {
    const t = getTool('media_higgsfield_soul_id');
    regIfAllowed(
      t.name,
      {
        title: 'Higgsfield Soul ID',
        description: t.description,
        inputSchema: t.inputSchema as never,
      },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldSoulId(input))),
    );
  }

  // ---- Higgsfield DoP (1 — P14 image-to-video with WAN Camera Control verbs) ----

  {
    const t = getTool('media_higgsfield_dop');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield DoP', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldDop(input))),
    );
  }

  // ---- Higgsfield Cinema Studio (1 — P14 1,296 virtual lenses, focal/aperture/sensor/grading) ----

  {
    const t = getTool('media_higgsfield_cinema_studio');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Cinema Studio', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldCinemaStudio(input))),
    );
  }

  // ---- Higgsfield Speak (1 — P14 Task 11 lip-sync: portrait + audio → talking head) ----

  {
    const t = getTool('media_higgsfield_speak');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Speak', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldSpeak(input))),
    );
  }

  // ---- Higgsfield Marketing Studio (1 — P14 Task 12 UGC templates from product URL) ----

  {
    const t = getTool('media_higgsfield_marketing_studio');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Marketing Studio', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldMarketingStudio(input))),
    );
  }

  // ---- Higgsfield Recast (1 — P14 Task 13 character swap in existing video) ----

  {
    const t = getTool('media_higgsfield_recast');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Recast', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldRecast(input))),
    );
  }

  // ---- Higgsfield Virality Predictor (1 — P14 Task 14 score asset viral/audience/hook) ----

  {
    const t = getTool('media_higgsfield_virality_predictor');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Virality Predictor', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldViralityPredictor(input))),
    );
  }

  // ---- Higgsfield Generate (Codex P2 round 7 PR#10 — generic Soul/Soul2 submit) ----
  {
    const t = getTool('media_higgsfield_generate');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Generate', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldGenerate(input))),
    );
  }

  // ---- Higgsfield Poll + Download (Codex P2 round 5 PR#10 — async lifecycle) ----
  {
    const t = getTool('media_higgsfield_poll');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Poll', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldPoll(input, { storage }))),
    );
  }
  {
    const t = getTool('media_higgsfield_download');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Download', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldDownload(input))),
    );
  }

  // ---- Kling Motion Brush (1 — P15 Task 6: paint regions of still image with motion vectors) ----

  {
    const t = getTool('media_kling_motion_brush');
    regIfAllowed(
      t.name,
      { title: 'Kling Motion Brush', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingMotionBrush(input))),
    );
  }

  // ---- Kling Elements CRUD (3 — P15 Tasks 6.5 / 6.6 / 6.7) ----

  {
    const t = getTool('media_kling_element_create');
    regIfAllowed(
      t.name,
      { title: 'Kling Element Create', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElementCreate(input))),
    );
  }

  {
    const t = getTool('media_kling_element_list');
    regIfAllowed(
      t.name,
      { title: 'Kling Element List', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElementList(input))),
    );
  }

  {
    const t = getTool('media_kling_element_delete');
    regIfAllowed(
      t.name,
      { title: 'Kling Element Delete', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElementDelete(input))),
    );
  }

  // ---- Kling Elements composition (1 — P15 Task 7: compose up to 4 frame-locked identities into one shot) ----

  {
    const t = getTool('media_kling_elements');
    regIfAllowed(
      t.name,
      { title: 'Kling Elements', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElements(input))),
    );
  }

  // ---- Kling Lip-Sync (1 — P15 Task 8: text or audio driven lip-sync) ----

  {
    const t = getTool('media_kling_lip_sync');
    regIfAllowed(
      t.name,
      { title: 'Kling Lip-Sync', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingLipSync(input))),
    );
  }

  // ---- Kling Omni Multi-Shot (1 — P15 Task 9: single-API multi-cut orchestration) ----

  {
    const t = getTool('media_kling_omni_multishot');
    regIfAllowed(
      t.name,
      { title: 'Kling Omni Multi-Shot', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingOmniMultiShot(input))),
    );
  }

  // ---- Kling Video Extend (1 — P15 Task 10: add ~4.5s continuation per hop, up to 4 hops ~18s) ----

  {
    const t = getTool('media_kling_video_extend');
    regIfAllowed(
      t.name,
      { title: 'Kling Video Extend', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingVideoExtend(input))),
    );
  }

  // ---- Kling lifecycle (2 — Codex P1 round 6 PR#11: manual completion path) ----

  {
    const t = getTool('media_kling_poll');
    regIfAllowed(
      t.name,
      { title: 'Kling Poll', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingPoll(input, { storage }))),
    );
  }

  {
    const t = getTool('media_kling_download');
    regIfAllowed(
      t.name,
      { title: 'Kling Download', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingDownload(input))),
    );
  }

  // ---- Seedance 2.0 (ByteDance) — P16 Task 7 (4 tools: t2v / i2v / multishot / reference-fusion) ----
  // Task 8.5: all 4 tools are conditionally registered based on MEDIA_FORGE_SEEDANCE_ENABLED flag.
  // When the flag is false, none of these tools appear in the MCP tool surface and the router
  // excludes 'bytedance' via getAdaptedProviders(). Default: enabled.

  if (isSeedanceEnabled()) {
    {
      const t = getTool('media_seedance_text_to_video');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Text-to-Video', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => asResult(await handleSeedanceTextToVideo(input))),
      );
    }

    {
      const t = getTool('media_seedance_image_to_video');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Image-to-Video', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => asResult(await handleSeedanceImageToVideo(input))),
      );
    }

    {
      const t = getTool('media_seedance_multishot');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Multi-Shot', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => asResult(await handleSeedanceMultishot(input))),
      );
    }

    {
      const t = getTool('media_seedance_reference_fusion');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Reference Fusion', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => asResult(await handleSeedanceReferenceFusion(input))),
      );
    }
  }
}
