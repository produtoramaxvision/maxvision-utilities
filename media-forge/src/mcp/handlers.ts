// src/mcp/handlers.ts
// Registers all 22 MCP tools backed by service implementations.
// Pattern: wrap each service call in wrap() for unified error handling and logging.
// NEVER throw from a handler — always return {isError: true} with message.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MediaForgeClient } from '../core/client.js';
import type { MediaForgeConfig } from '../core/config.js';
import type { OutputManager } from '../output/output-manager.js';
import type { ZodTypeAny } from 'zod';
import { logger } from '../core/logger.js';
import { safeJoin } from '../utils/paths.js';
import { ValidationError } from '../core/errors.js';
import { MCP_TOOLS, type MCPTool } from './schemas.js';

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
import type { Provider } from '../core/models.js';
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
import { HiggsfieldProvider } from '../video/providers/higgsfield.js';

// ---------------------------------------------------------------------------
// ADAPTED_PROVIDERS — routing gate: only providers with a wired adapter here.
// Prevents the router from selecting models that have no execution backend.
//
// P14: Higgsfield enters ADAPTED_PROVIDERS in Task 6 once HiggsfieldProvider lands.
// P15: 'kling' will be appended when KlingProvider lands.
// P16: 'bytedance' will be appended when SeedanceProvider lands.
// ---------------------------------------------------------------------------
const ADAPTED_PROVIDERS = new Set<Provider>(['google']);

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
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(input.audioPath);
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
// Cross-provider routing heuristic. In P13 the registry contains only Veo, so
// every supported-mode call resolves to `google/veo-3.1-generate-preview`.
// P14-P16 will add Higgsfield (credits-per-video), Kling (usd-per-second), and
// Seedance (usd-per-video) — the sort already uses `normalizeCostUSD` so cross-
// unit comparison stays correct without re-architecture.

export interface VideoRouteResult {
  readonly provider: Provider;
  readonly modelId: string;
  readonly mode: string;
  readonly estimatedCostUSD: number;
  readonly rationale: string;
}

export async function handleVideoRoute(rawInput: unknown): Promise<VideoRouteResult> {
  const input: VideoRouteInputT = VideoRouteInput.parse(rawInput);

  const candidates = Object.values(VIDEO_MODELS)
    .filter((spec) => spec.modes.includes(input.mode as never))
    // Constrain to providers with a wired adapter. Models registered for
    // future providers (Higgsfield P14, Kling P15, Seedance P16) must not
    // be selected until their adapter is available in ADAPTED_PROVIDERS.
    .filter((spec) => ADAPTED_PROVIDERS.has(spec.provider));
  if (candidates.length === 0) {
    throw new Error(`no provider supports mode ${input.mode} in current registry`);
  }
  const filtered = input.preferProvider
    ? candidates.filter((c) => c.provider === input.preferProvider)
    : candidates;
  if (filtered.length === 0) {
    throw new Error(
      `preferProvider ${input.preferProvider} has no model supporting mode ${input.mode}`,
    );
  }

  // Sort by USD-equivalent cost (cross-unit aware via normalizeCostUSD).
  // For credits-per-video providers (P14+ Higgsfield), the caller can pass
  // input.usdPerCredit in extras; for P13 (Veo only, usd-per-second) the helper
  // is duration-aware and produces a meaningful sort. Sorting by raw
  // `pricing.rate` would silently mis-rank across providers with heterogeneous
  // units the moment P14+ adapters land — never reintroduce that shortcut.
  const sorted = [...filtered].sort(
    (a, b) =>
      normalizeCostUSD(a, { durationSec: input.durationSec }) -
      normalizeCostUSD(b, { durationSec: input.durationSec }),
  );
  const picked = sorted[0]!;

  const provider = new GoogleVeoProvider({ dbPath: defaultDbPath() });
  const estimatedCostUSD =
    picked.provider === 'google'
      ? provider.estimateCostUSD({
          modelId: picked.id,
          mode: input.mode as never,
          prompt: input.prompt,
          durationSec: input.durationSec,
          resolution: input.resolution,
        })
      : normalizeCostUSD(picked, { durationSec: input.durationSec });

  return {
    provider: picked.provider,
    modelId: picked.id,
    mode: input.mode,
    estimatedCostUSD,
    rationale: `P13: only google/Veo is wired. Selected ${picked.id} for mode ${input.mode}.`,
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

export interface HandlersDeps {
  client: MediaForgeClient;
  config: MediaForgeConfig;
  outputManager?: OutputManager;
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

export function registerAllTools(server: McpServer, deps: HandlersDeps): void {
  const { client, config } = deps;
  const reg = looseRegister(server);

  function getTool(name: string) {
    const t = MCP_TOOLS.find((tool) => tool.name === name);
    if (!t) throw new Error(`BUG: tool ${name} not found in MCP_TOOLS registry`);
    return t;
  }

  // ---- Image tools (6) ----

  {
    const t = getTool('media_generate_image');
    reg(
      t.name,
      { title: 'Generate Image (Nano Banana Pro)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateImageNanoBananaPro(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_imagen');
    reg(
      t.name,
      { title: 'Generate Image (Imagen 4 Ultra)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateImageImagen4Ultra(input as never, client))),
    );
  }

  {
    const t = getTool('media_edit_image');
    reg(
      t.name,
      { title: 'Edit Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await editImage(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_compose_scene');
    reg(
      t.name,
      { title: 'Compose Scene', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await composeScene(input as never, client))),
    );
  }

  {
    const t = getTool('media_describe_image');
    reg(
      t.name,
      { title: 'Describe Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await describeImage(input as never, client))),
    );
  }

  {
    const t = getTool('media_extract_palette');
    reg(
      t.name,
      { title: 'Extract Color Palette', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await extractPalette(input as never))),
    );
  }

  // ---- Video tools (7) ----

  {
    const t = getTool('media_generate_video_t2v');
    reg(
      t.name,
      { title: 'Generate Video (Text to Video)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoT2V(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_i2v');
    reg(
      t.name,
      { title: 'Generate Video (Image to Video)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoI2V(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_interpolate');
    reg(
      t.name,
      { title: 'Generate Video (Interpolate)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoInterpolate(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_with_refs');
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
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
    reg(
      t.name,
      { title: 'Webhook Router Status', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async () => asResult(await handleVideoWebhookStatus())),
    );
  }

  // ---- Cost estimation (2 — P13 provider-registry cost tools) ----

  {
    const t = getTool('media_video_cost_estimate');
    reg(
      t.name,
      { title: 'Video Cost Estimate', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoCostEstimate(input))),
    );
  }

  {
    const t = getTool('media_video_cost_report');
    reg(
      t.name,
      { title: 'Video Cost Report', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoCostReport(input))),
    );
  }

  // ---- Routing (1 — P13 cross-provider routing heuristic; Veo-only today) ----

  {
    const t = getTool('media_video_route');
    reg(
      t.name,
      { title: 'Video Provider Routing', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoRoute(input))),
    );
  }

  // ---- Higgsfield Soul ID (1 — P14 character training cache) ----

  {
    const t = getTool('media_higgsfield_soul_id');
    reg(
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
    reg(
      t.name,
      { title: 'Higgsfield DoP', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldDop(input))),
    );
  }

  // ---- Higgsfield Cinema Studio (1 — P14 1,296 virtual lenses, focal/aperture/sensor/grading) ----

  {
    const t = getTool('media_higgsfield_cinema_studio');
    reg(
      t.name,
      { title: 'Higgsfield Cinema Studio', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldCinemaStudio(input))),
    );
  }

  // ---- Higgsfield Speak (1 — P14 Task 11 lip-sync: portrait + audio → talking head) ----

  {
    const t = getTool('media_higgsfield_speak');
    reg(
      t.name,
      { title: 'Higgsfield Speak', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldSpeak(input))),
    );
  }

  // ---- Higgsfield Marketing Studio (1 — P14 Task 12 UGC templates from product URL) ----

  {
    const t = getTool('media_higgsfield_marketing_studio');
    reg(
      t.name,
      { title: 'Higgsfield Marketing Studio', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldMarketingStudio(input))),
    );
  }
}
