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
// NEITHER has been exercised against a real endpoint from this repo. MuAPI needs
// a MUAPI_API_KEY this repo does not have; Wan2GP needs a local server the
// operator chose not to install. Every test here injects fetch. That is a weaker
// claim than the Kling work, where the live API answered, and it is stated rather
// than left for someone to assume from a green suite.

import { ValidationError } from '../../core/errors.js';
import {
  MuapiModelsInput,
  MuapiGenerateInput,
  type MuapiGenerateInputT,
  Wan2gpGenerateInput,
  type Wan2gpGenerateInputT,
} from '../schemas.js';
import { MuapiProvider, buildMuapiParams, type MuapiOptions } from '../../video/providers/muapi.js';
import {
  Wan2gpProvider,
  isWan2gpEnabled,
  wan2gpBaseUrl,
  WAN2GP_RATE_USD,
  type Wan2gpOptions,
} from '../../video/providers/wan2gp.js';
import type { VideoGenerationRequest } from '../../video/providers/base.js';

export interface OptInHandlerOpts {
  readonly fetchImpl?: typeof fetch;
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
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number }> {
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
  const handle = await provider.generate(req);

  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD,
  };
}

function providerOpts(opts: OptInHandlerOpts): MuapiOptions {
  return opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {};
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
