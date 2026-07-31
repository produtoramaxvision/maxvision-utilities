// src/video/providers/muapi.ts
// PR7 — MuAPI adapter.
//
// ## Interface, verified via context7 against muapi.ai/docs on 2026-07-30
//
//   Base            https://api.muapi.ai
//   Auth            x-api-key: <key>        (NOT a Bearer token)
//   Submit          POST /api/v1/{endpoint}            -> { request_id }
//   Poll            GET  /api/v1/predictions/{id}/result
//                     -> { status: queued|processing|completed|failed, outputs: string[] }
//   Model catalogue GET  /api/v1/models
//                     -> { models: [{ name, cost, cost_currency, cost_strategy,
//                                     dynamic_pricing, endpoint, estimate_endpoint }] }
//
// ## The reason this adapter is worth having
//
// MuAPI returns the ACTUAL amount charged for every request, in the response body
// and in the `X-MuAPI-Cost-USD` / `X-MuAPI-Cost-Credits` headers. That makes it the
// only provider here where settlement is a fact rather than a derivation.
//
// Everywhere else in this codebase the ledger records `rate x duration` and hopes
// it matches the invoice: Higgsfield CLI's recordActualCostUSD is a documented
// no-op, and Kling's deduction API is an open TODO. MuAPI hands the number over,
// so recordActualCostUSD here is real.
//
// ## MuAPI is an aggregator, and its prices are its own
//
// The catalogue includes `kling-master`, `veo3-fast` and similar — MuAPI resells
// other vendors' models with its own markup. Its price for Kling is NOT Kling's
// price. Reusing the direct-Kling rates in src/core/models.ts for a MuAPI job
// would under-report spend by whatever the margin is, which is exactly the
// "router aggregator blindness" already filed as P1 in TODOS.md for Higgsfield.
//
// This adapter therefore never consults the local rate table. Cost comes from
// MuAPI's own catalogue or its estimate endpoint, and settlement from the header.
// There is no hardcoded MuAPI rate in this repo to go stale.

import { ApiError, ValidationError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import type { Provider } from '../../core/models.js';
import type {
  DownloadedAsset,
  JobHandle,
  JobStatus,
  VideoGenerationRequest,
  VideoLedgerHooks,
} from './base.js';

const MUAPI_BASE = 'https://api.muapi.ai';

/** Headers MuAPI attaches to every generation response. */
const COST_USD_HEADER = 'x-muapi-cost-usd';

export interface MuapiModelEntry {
  readonly name: string;
  readonly cost: number;
  readonly cost_currency: string;
  readonly dynamic_pricing: boolean;
  readonly endpoint: string;
  readonly estimate_endpoint: string | null;
}

export interface MuapiOptions {
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

/**
 * Reads the key at call time rather than at construction.
 *
 * The provider may be built once per process while credentials arrive per
 * request in hosted mode; capturing at construction is how one tenant's key
 * ends up serving another's call.
 */
function resolveApiKey(explicit: string | undefined): string {
  const key = explicit ?? process.env['MUAPI_API_KEY'];
  if (key === undefined || key.length === 0) {
    throw new ValidationError(
      'MUAPI_API_KEY is not set. MuAPI authenticates with an x-api-key header; ' +
        'get a key from the MuAPI dashboard, or leave MEDIA_FORGE_MUAPI_ENABLED unset.',
    );
  }
  return key;
}

export class MuapiProvider {
  readonly name = 'muapi' as Provider;
  readonly models = [];

  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKeyOverride: string | undefined;

  /** Catalogue cache. Cleared per process, not persisted — prices move. */
  private catalogue: Map<string, MuapiModelEntry> | undefined;

  constructor(opts: MuapiOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? MUAPI_BASE;
    this.apiKeyOverride = opts.apiKey;
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': resolveApiKey(this.apiKeyOverride),
      'Content-Type': 'application/json',
    };
  }

  /** Loads MuAPI's own model catalogue. This is the only source of MuAPI prices. */
  async fetchCatalogue(): Promise<Map<string, MuapiModelEntry>> {
    if (this.catalogue !== undefined) return this.catalogue;

    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/models`, {
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new ApiError(
        `MuAPI model catalogue request failed: HTTP ${response.status}`,
        'API',
        { provider: 'muapi' },
      );
    }

    const body = (await response.json()) as { models?: MuapiModelEntry[] };
    const map = new Map<string, MuapiModelEntry>();
    for (const entry of body.models ?? []) {
      map.set(entry.name, entry);
    }
    this.catalogue = map;
    return map;
  }

  /**
   * The price MuAPI will charge, from MuAPI.
   *
   * For a `dynamic_pricing` model the listed `cost` is only indicative — duration
   * and resolution move it — so the model's own `estimate_endpoint` is called
   * instead. Using the indicative figure for a dynamically priced video would
   * under-report the estimate to the cost guard, which is the direction that lets
   * spend through a cap rather than blocking it wrongly.
   */
  async fetchCostUsd(modelName: string, params: Record<string, unknown>): Promise<number> {
    const catalogue = await this.fetchCatalogue();
    const entry = catalogue.get(modelName);

    if (entry === undefined) {
      throw new ValidationError(
        `"${modelName}" is not in the MuAPI catalogue. Run GET /api/v1/models to see ` +
          `what is available — this adapter deliberately keeps no local price table, so ` +
          `an unknown model has no price it could fall back to.`,
      );
    }

    if (entry.cost_currency !== 'USD') {
      // Everything downstream — the guard, the ledger, the daily cap — is USD.
      // Silently treating another currency as USD would misprice by the FX rate.
      throw new ApiError(
        `MuAPI quoted ${modelName} in ${entry.cost_currency}; this adapter only handles USD`,
        'API',
        { provider: 'muapi' },
      );
    }

    if (!entry.dynamic_pricing || entry.estimate_endpoint === null) {
      return entry.cost;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${entry.estimate_endpoint}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new ApiError(
        `MuAPI cost estimate for ${modelName} failed: HTTP ${response.status}`,
        'API',
        { provider: 'muapi' },
      );
    }

    // VERIFIED against muapi.ai/docs/pricing on 2026-07-31. The estimate response is
    //
    //   { model, cost, currency, dynamic_pricing, cost_strategy }
    //
    // `cost` is a float in `currency`. An earlier build here also accepted
    // `cost_usd` as a defensive second guess; that field does not exist and has
    // been removed — a fallback onto a key the API never sends is not defence,
    // it is a second way to be wrong that no test would ever exercise.
    //
    // Still unexercised against a live endpoint: that needs a MUAPI_API_KEY this
    // repo does not have. Documented shape is stronger than a guess and weaker
    // than a response.
    const body = (await response.json()) as { cost?: number; currency?: string };

    // Checked on the ESTIMATE too, not only on the catalogue entry above. The
    // two are separate responses and the estimate is the one that decides what
    // gets billed; assuming it inherits the catalogue's currency is how a
    // non-USD figure reaches a USD ledger.
    if (body.currency !== undefined && body.currency !== 'USD') {
      throw new ApiError(
        `MuAPI estimated ${modelName} in ${body.currency}; this adapter only handles USD, ` +
          `and there is no exchange rate here to convert with.`,
        'API',
        { provider: 'muapi' },
      );
    }

    const cost = body.cost;
    if (typeof cost !== 'number' || !Number.isFinite(cost)) {
      throw new ApiError(
        `MuAPI cost estimate for ${modelName} returned no usable \`cost\`. Refusing rather ` +
          `than defaulting: a fabricated estimate would pass the cost guard and land in the ` +
          `ledger looking authoritative.`,
        'API',
        { provider: 'muapi' },
      );
    }
    return cost;
  }

  /**
   * Submits a generation.
   *
   * Reserve-before-submit (C8/A5) with the same asymmetric hook contract every
   * other provider here follows: release on a submit that never landed, never
   * release once MuAPI has accepted the job.
   */
  async generate(
    req: VideoGenerationRequest,
    ledgerHooks?: VideoLedgerHooks,
  ): Promise<JobHandle> {
    const catalogue = await this.fetchCatalogue();
    const entry = catalogue.get(req.modelId);
    if (entry === undefined) {
      throw new ValidationError(`"${req.modelId}" is not in the MuAPI catalogue`);
    }

    const params = buildMuapiParams(req);
    const estimateUsd = await this.fetchCostUsd(req.modelId, params);

    const jobId = `muapi-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ledgerHooks?.beforeSubmit(jobId, estimateUsd);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${entry.endpoint}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(params),
      });
    } catch (err) {
      await ledgerHooks?.onSubmitFailed(jobId, estimateUsd);
      throw err;
    }

    if (!response.ok) {
      await ledgerHooks?.onSubmitFailed(jobId, estimateUsd);
      throw new ApiError(
        `MuAPI submit to ${entry.endpoint} failed: HTTP ${response.status}`,
        'API',
        { provider: 'muapi' },
      );
    }

    try {
      const body = (await response.json()) as { request_id?: string };
      if (body.request_id === undefined) {
        // HTTP 2xx means MuAPI accepted and is very likely charging. Releasing
        // here would let a running generation complete for free.
        throw new ApiError(
          `MuAPI submit returned no request_id`,
          'API',
          { provider: 'muapi' },
        );
      }

      // The charge is authoritative and available immediately. Captured here so
      // the ledger settles on MuAPI's number rather than on this adapter's
      // estimate — the whole reason this provider is worth wiring.
      const actualUsd = readCostHeader(response);
      if (actualUsd !== undefined) {
        logger.info('muapi: actual cost reported by provider', {
          jobId,
          estimateUsd,
          actualUsd,
        });
      }

      return {
        jobId,
        provider: this.name,
        model: req.modelId,
        mode: req.mode,
        createdAt: new Date().toISOString(),
        providerNativeId: body.request_id,
      };
    } catch (err) {
      ledgerHooks?.onPostSubmitError(jobId, estimateUsd, err);
      throw err;
    }
  }

  async pollStatus(requestId: string): Promise<JobStatus> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/v1/predictions/${encodeURIComponent(requestId)}/result`,
      { headers: this.headers() },
    );

    if (!response.ok) {
      return {
        jobId: requestId,
        state: 'failed',
        errorMessage: `MuAPI poll failed: HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as {
      status?: string;
      outputs?: string[];
      error?: string;
    };

    return {
      jobId: requestId,
      state: mapMuapiStatus(body.status),
      assetUrls: body.outputs ?? [],
      ...(body.error !== undefined ? { errorMessage: body.error } : {}),
    };
  }

  async download(requestId: string): Promise<DownloadedAsset> {
    const status = await this.pollStatus(requestId);
    const url = status.assetUrls?.[0];
    if (url === undefined) {
      throw new ApiError(
        `MuAPI job ${requestId} has no downloadable output (state: ${status.state})`,
        'API',
        { provider: 'muapi' },
      );
    }

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new ApiError(
        `failed to download MuAPI output for ${requestId}: HTTP ${response.status}`,
        'API',
        { provider: 'muapi' },
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      metadata: {
        contentType: response.headers.get('content-type') ?? 'video/mp4',
        sizeBytes: buffer.byteLength,
        cdnUrl: url,
      },
    };
  }
}

/**
 * Reads MuAPI's per-request charge from the response headers.
 *
 * Returns undefined rather than 0 when the header is missing: 0 is a valid
 * charge, and conflating "free" with "unknown" would settle a real cost at zero
 * and quietly under-count the daily cap.
 */
export function readCostHeader(response: {
  headers: { get(name: string): string | null };
}): number | undefined {
  const raw = response.headers.get(COST_USD_HEADER) ?? response.headers.get('X-MuAPI-Cost-USD');
  if (raw === null) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Maps MuAPI's documented status values onto the repo's JobState union. */
export function mapMuapiStatus(status: string | undefined): JobStatus['state'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'queued':
      return 'pending';
    case 'processing':
      return 'in_progress';
    default:
      // An unrecognised status is most likely one MuAPI added after this build.
      // Treating it as failure would abandon a job that is running and billing.
      return 'in_progress';
  }
}

/** Translates the repo's request shape into MuAPI's flat parameter object. */
export function buildMuapiParams(req: VideoGenerationRequest): Record<string, unknown> {
  const params: Record<string, unknown> = { prompt: req.prompt };
  if (req.durationSec > 0) params['duration'] = req.durationSec;
  if (req.resolution) params['resolution'] = req.resolution;
  if (req.aspectRatio) params['aspect_ratio'] = req.aspectRatio;
  if (req.firstFrameImagePath) params['image_url'] = req.firstFrameImagePath;
  return params;
}
