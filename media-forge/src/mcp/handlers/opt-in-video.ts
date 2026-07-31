// src/mcp/handlers/opt-in-video.ts
// Entry points for the two opt-in video providers.
//
// Both adapters shipped complete and tested — MuAPI in PR7 (`5aeb25a`), Wan2GP in
// PR8 (`cf6f19b`) — and neither had an MCP tool, so neither could be reached from
// the surface users actually call. Same defect the narrative planner, the Codex
// image adapter and the two Kling billing methods had on this branch: a tool, or
// the code is not a feature.
//
// ## Why these are direct-access and not router entries
//
// Not an oversight, and not a smaller version of routing. Both have a genuinely
// DYNAMIC catalogue:
//
//   muapi    GET /api/v1/models at request time; some models carry
//            `dynamic_pricing`, so even the price is a call, not a constant
//   wan2gp   whatever weights the operator downloaded onto their own machine
//
// `handleVideoRoute` ranks a static registry synchronously. Ranking these would
// mean making routing async and catalogue-aware, which touches every routing test
// — a separate change, not an extension of this one.
//
// For opt-in providers, explicit selection is also the RIGHT behaviour rather
// than a limitation. A $0 local server wins every ascending cost sort; a caller
// who enables Wan2GP to try it has not asked for their whole pipeline to move
// onto their GPU. The zero-cost routing guard (isOptInOnlyProvider) exists for
// exactly that reason, and these tools are the deliberate door it leaves open.
//
// ## Verification status
//
// NEITHER has been exercised against a real endpoint from this repo, and that
// includes the poll and download tools added later. MuAPI needs a MUAPI_API_KEY
// this repo does not have; Wan2GP needs a local server the operator chose not to
// install. Every test here injects fetch. That is a weaker claim than the Kling
// work, where the live API answered, and it is stated rather than left for
// someone to assume from a green suite.
//
// What IS verified is the wire contract, read from muapi.ai/docs via context7 on
// 2026-07-31 rather than guessed: the submit and poll bodies both carry a `cost`
// object with `amount_usd` and `refunded`, and the poll endpoint is keyed on
// MuAPI's `request_id`. The shapes below follow those docs. Documented shape is
// stronger than a guess and weaker than a response.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationError } from '../../core/errors.js';
import {
  MuapiModelsInput,
  MuapiGenerateInput,
  type MuapiGenerateInputT,
  MuapiPollInput,
  type MuapiPollInputT,
  MuapiDownloadInput,
  type MuapiDownloadInputT,
  Wan2gpGenerateInput,
  type Wan2gpGenerateInputT,
} from '../schemas.js';
import { defaultDbPath } from './shared.js';
import { MuapiProvider, buildMuapiParams, type MuapiOptions } from '../../video/providers/muapi.js';
import {
  Wan2gpProvider,
  isWan2gpEnabled,
  wan2gpBaseUrl,
  WAN2GP_RATE_USD,
  type Wan2gpOptions,
} from '../../video/providers/wan2gp.js';
import type { VideoGenerationRequest, VideoLedgerHooks } from '../../video/providers/base.js';

export interface OptInHandlerOpts {
  readonly fetchImpl?: typeof fetch;
  /** Cost-tracker database. Defaults to the project DB; overridden in tests. */
  readonly dbPath?: string;
  /**
   * Cost-guard hook, run BEFORE the network submit. Throws CostGuardError to
   * block; returns `{ costWarning }` for a non-blocking warning. Same shape the
   * Kling and Higgsfield handlers take.
   */
  readonly checkCostGuard?: (estimateUsd: number) => { costWarning?: string } | undefined;
  /** Cheap balance read that fails fast before the request body is built. */
  readonly preflightCredit?: (estimateUsd: number) => Promise<void>;
  /**
   * Reserve-before-submit hooks, forwarded into `MuapiProvider.generate()`.
   *
   * Omitting these was the gap that made MuAPI the one paid provider whose
   * spend reached no reservation, no cost guard and no daily cap — every other
   * paid handler here forwards them, and a green suite over a handler that
   * simply never called them looks identical to one that does.
   */
  readonly ledgerHooks?: VideoLedgerHooks;
}

/**
 * Builds the provider request shared by both tools.
 *
 * `mode` is derived from whether a first frame was given rather than asked for:
 * a caller who supplies an image and says `t2v` has contradicted themselves, and
 * silently honouring the wrong one drops the image without a word.
 */
function toRequest(input: {
  modelId: string;
  prompt: string;
  durationSec: number;
  resolution: '720p' | '1080p' | '2k' | '4k';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4';
  firstFrameImagePath?: string;
}): VideoGenerationRequest {
  return {
    modelId: input.modelId,
    mode: input.firstFrameImagePath !== undefined ? 'i2v' : 't2v',
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: input.resolution,
    ...(input.aspectRatio !== undefined ? { aspectRatio: input.aspectRatio } : {}),
    ...(input.firstFrameImagePath !== undefined
      ? { firstFrameImagePath: input.firstFrameImagePath }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// MuAPI
// ---------------------------------------------------------------------------

export interface MuapiCatalogueEntry {
  readonly name: string;
  readonly costUsd: number;
  readonly currency: string;
  readonly dynamicPricing: boolean;
  readonly endpoint: string;
}

/**
 * Lists the MuAPI catalogue.
 *
 * This is the ONLY source of MuAPI prices — media-forge keeps no local rate table
 * for it, deliberately, because an aggregator's markup is its own and hardcoding
 * it here would produce a confidently wrong estimate for every model it resells.
 *
 * `dynamicPricing` is surfaced per entry because it changes what `costUsd` means:
 * on those models the catalogue number is a floor, and the real figure comes from
 * the model's estimate endpoint at request time.
 */
export async function handleMuapiModels(
  _rawInput: unknown,
  opts: OptInHandlerOpts = {},
): Promise<{ models: ReadonlyArray<MuapiCatalogueEntry>; count: number }> {
  MuapiModelsInput.parse(_rawInput ?? {});
  const provider = new MuapiProvider(providerOpts(opts));
  const catalogue = await provider.fetchCatalogue();

  const models = [...catalogue.values()].map((entry) => ({
    name: entry.name,
    costUsd: entry.cost,
    currency: entry.cost_currency,
    dynamicPricing: entry.dynamic_pricing,
    endpoint: entry.endpoint,
  }));
  return { models, count: models.length };
}

export async function handleMuapiGenerate(
  rawInput: unknown,
  opts: OptInHandlerOpts = {},
): Promise<{
  jobId: string;
  requestId: string;
  provider: string;
  modelId: string;
  estimatedCostUSD: number;
  costWarning?: string;
}> {
  const input: MuapiGenerateInputT = MuapiGenerateInput.parse(rawInput);
  const provider = new MuapiProvider(providerOpts(opts));

  const req = toRequest({ ...input, modelId: input.modelName });

  // buildMuapiParams(req), NOT a hand-built object.
  //
  // The first version of this handler passed { prompt, duration, resolution }
  // while generate() prices internally with buildMuapiParams(req) — which also
  // carries aspect_ratio and image_url. On a dynamic_pricing model the two
  // bodies produce two different numbers, and the one returned to the caller was
  // the one computed for a request that was never submitted. A price for the
  // wrong request is worse than no price: it looks authoritative and it is the
  // number the caller budgets against.
  //
  // MuAPI's estimate endpoint is consulted twice as a result — once here for the
  // number the caller sees, once inside generate(). Identical bodies, so
  // identical answers. Deduplicating means threading the estimate out through
  // JobHandle, which is the shared cross-provider interface; that is a wider
  // change than this defect warrants.
  const params = buildMuapiParams(req);

  // Priced BEFORE submit, from MuAPI itself. The adapter throws on a shape it
  // cannot read rather than returning a number — a fabricated estimate would
  // pass the cost guard and land in the ledger looking authoritative.
  const estimatedCostUSD = await provider.fetchCostUsd(input.modelName, params);

  // Guards run on the SAME number the caller is quoted, and before the submit.
  const costWarning = opts.checkCostGuard?.(estimatedCostUSD)?.costWarning;
  await opts.preflightCredit?.(estimatedCostUSD);

  const handle = await provider.generate(req, opts.ledgerHooks);

  // `providerNativeId` is MuAPI's request_id and the ONLY key its poll endpoint
  // accepts. Returning just `jobId` — the local `muapi-{ts}-{rand}` ledger key —
  // handed callers an id MuAPI has never heard of, which made every submitted
  // job unretrievable. Both are returned, and named for what each opens.
  if (handle.providerNativeId === undefined) {
    throw new ValidationError(
      'MuAPI accepted the job but returned no request_id, so it cannot be polled. ' +
        `The generation is running and billing under ledger id ${handle.jobId}; ` +
        'reconcile from the MuAPI dashboard.',
    );
  }

  return {
    jobId: handle.jobId,
    requestId: handle.providerNativeId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD,
    ...(costWarning !== undefined ? { costWarning } : {}),
  };
}

function providerOpts(opts: OptInHandlerOpts): MuapiOptions {
  return {
    // The cost-tracker row is what makes a MuAPI job visible to the cost report
    // and settleable at completion. Every other paid provider gets one.
    dbPath: opts.dbPath ?? defaultDbPath(),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  };
}

export interface MuapiPollResult {
  readonly requestId: string;
  readonly state: string;
  readonly assetUrls?: ReadonlyArray<string>;
  readonly errorMessage?: string;
  readonly actualUsd?: number;
  readonly refunded?: boolean;
  readonly settled?: boolean;
}

/**
 * Polls a MuAPI request and settles the ledger once it reaches a terminal state.
 *
 * `MuapiProvider.pollStatus` and `.download` shipped complete, tested, and with
 * no caller anywhere — every submitted MuAPI job was therefore unretrievable.
 * That is the same defect class as the Codex image adapter and the two Kling
 * billing methods on this branch: a tool, or the code is not a feature.
 *
 * Settlement lives here rather than inside the provider because a poll is a read
 * and callers run it repeatedly; making the write explicit at the tool boundary
 * keeps the side effect where an operator can see it. `recordActualCost` is
 * idempotent (`AND actual_usd IS NULL`), so repeated polls of a completed job
 * settle exactly once.
 */
export async function handleMuapiPoll(
  rawInput: unknown,
  opts: OptInHandlerOpts = {},
): Promise<MuapiPollResult> {
  const input: MuapiPollInputT = MuapiPollInput.parse(rawInput);
  const provider = new MuapiProvider(providerOpts(opts));
  const status = await provider.pollStatus(input.requestId);

  // Settled only when BOTH the state is terminal and MuAPI reported a figure.
  // Recording a 0 for "no cost field in this response" would close the row at
  // zero and silently under-count the daily cap for a job that was billed.
  let settled = false;
  const terminal = status.state === 'completed' || status.state === 'failed';
  if (terminal && status.actualUsd !== undefined && input.jobId !== undefined) {
    await provider.recordActualCostUSD(input.jobId, status.actualUsd);
    settled = true;
  }

  return {
    requestId: input.requestId,
    state: status.state,
    ...(status.assetUrls !== undefined ? { assetUrls: status.assetUrls } : {}),
    ...(status.errorMessage !== undefined ? { errorMessage: status.errorMessage } : {}),
    ...(status.actualUsd !== undefined ? { actualUsd: status.actualUsd } : {}),
    ...(status.refunded !== undefined ? { refunded: status.refunded } : {}),
    ...(terminal ? { settled } : {}),
  };
}

/**
 * Downloads a completed MuAPI output to the local outputs directory.
 *
 * Mirrors `handleKlingDownload`'s destination logic so MuAPI files land beside
 * every other provider's rather than in a second place nobody looks.
 */
export async function handleMuapiDownload(
  rawInput: unknown,
  opts: OptInHandlerOpts = {},
): Promise<{
  requestId: string;
  outputPath: string;
  sizeBytes: number;
  contentType: string;
}> {
  const input: MuapiDownloadInputT = MuapiDownloadInput.parse(rawInput);
  const provider = new MuapiProvider(providerOpts(opts));
  const asset = await provider.download(input.requestId);

  const projectDir = process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
  const outputsDir = process.env['MEDIA_FORGE_OUTPUTS_DIR'] ?? join(projectDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });

  // Extension from what MuAPI actually served. The catalogue spans video AND
  // image models, so a hardcoded .mp4 would mislabel every image output.
  const contentType = asset.metadata.contentType;
  const ext = contentType.startsWith('image/')
    ? (contentType.split('/')[1] ?? 'png').split(';')[0]
    : 'mp4';
  const outputPath = join(outputsDir, `muapi-${input.requestId}.${ext}`);
  writeFileSync(outputPath, asset.buffer);

  return {
    requestId: input.requestId,
    outputPath,
    sizeBytes: asset.metadata.sizeBytes ?? asset.buffer.length,
    contentType,
  };
}

// ---------------------------------------------------------------------------
// Wan2GP
// ---------------------------------------------------------------------------

export async function handleWan2gpGenerate(
  rawInput: unknown,
  opts: OptInHandlerOpts = {},
): Promise<{
  jobId: string;
  provider: string;
  modelId: string;
  estimatedCostUSD: number;
  baseUrl: string;
}> {
  const input: Wan2gpGenerateInputT = Wan2gpGenerateInput.parse(rawInput);

  // Checked here as well as inside preflight() so the refusal names the flag
  // before any network attempt. The confusing failure this avoids is a
  // connection error from deep inside a fetch when the real cause is a flag the
  // operator never set.
  if (!isWan2gpEnabled()) {
    throw new ValidationError(
      'Wan2GP is not enabled. It runs on your own machine and is off by default: ' +
        'run `media-forge setup wan2gp` for the requirements, start the server, then ' +
        'set MEDIA_FORGE_WAN2GP_ENABLED=true.',
    );
  }

  // Refused, not silently honoured. buildGradioPayload sends a POSITIONAL array
  // — [prompt, duration, resolution, aspectRatio] — with no slot for an image,
  // so an i2v request would reach the operator's server looking exactly like a
  // t2v one and come back without the reference, with nothing reported.
  //
  // Guessing an index is not an option: the position is defined by whatever
  // Gradio app the operator is running, and a wrong index silently corrupts a
  // different argument. Until that payload is confirmed against a real server,
  // refusing is the honest answer. This handler is the first production caller
  // of Wan2GP, so the drop was unreachable before today rather than tolerated.
  if (input.firstFrameImagePath !== undefined) {
    throw new ValidationError(
      'Wan2GP image-to-video is not wired yet. The Gradio payload this adapter sends is a ' +
        'positional array with no image slot, and the correct position depends on the app ' +
        'you are running — sending the request anyway would drop your reference image ' +
        'without saying so. Omit firstFrameImagePath for text-to-video.',
    );
  }

  const wan2gpOpts: Wan2gpOptions = opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {};
  const provider = new Wan2gpProvider(wan2gpOpts);
  const handle = await provider.generate(toRequest(input));

  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    // Zero, and returned anyway. A local render costs no credits, but the field
    // is what makes it appear in the cost report alongside paid work instead of
    // vanishing from the record.
    estimatedCostUSD: WAN2GP_RATE_USD,
    baseUrl: wan2gpBaseUrl(),
  };
}
