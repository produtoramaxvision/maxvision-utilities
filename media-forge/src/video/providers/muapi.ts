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
// MuAPI returns the ACTUAL amount charged for every request. Verified via context7
// against muapi.ai/docs/api-reference and /docs/credits on 2026-07-31 — it comes
// back in THREE places, and the poll response is the one that matters:
//
//   submit body   { request_id, status, cost: { amount_usd, amount_credits,
//                                               bonus_credits_used, refunded } }
//   headers       X-MuAPI-Cost-USD, X-MuAPI-Cost-Credits, X-Account-Balance
//   poll body     { id, status, outputs, cost: { …same shape… } }
//
// Everywhere else in this codebase the ledger records `rate x duration` and hopes
// it matches the invoice: Higgsfield CLI's recordActualCostUSD is a documented
// no-op, and Kling's deduction API is an open TODO. MuAPI hands the number over,
// so recordActualCostUSD here is real — it writes to the same video_jobs row every
// other provider settles against.
//
// ## Settlement happens at POLL, not at submit
//
// The submit response already carries a charge, and an earlier build here only
// logged it. Settling from it would still have been wrong: `cost.refunded` is a
// documented field, and MuAPI refunds failed tasks. A charge captured at submit is
// therefore provisional — the poll response carries the same `cost` object with
// `refunded` resolved, which makes the terminal poll the only point where the
// number is final. A refunded task settles at 0 rather than at what was briefly
// taken, because the ledger is what the daily cap is enforced against.
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
import { recordJob, recordActualCost } from '../../core/cost-tracker.js';
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

/**
 * MuAPI's per-request charge, as it appears in both the submit and the poll body.
 *
 * Documented at muapi.ai/docs/api-reference. `refunded` is the field that makes
 * the submit-time figure provisional — see the settlement note in the header.
 */
export interface MuapiCost {
  readonly amount_usd?: number;
  readonly amount_credits?: number;
  readonly bonus_credits_used?: number;
  readonly refunded?: boolean;
}

/**
 * JobStatus widened with what MuAPI reports and the shared interface has no room
 * for. Deliberately NOT a change to `JobStatus` in base.ts: no other provider can
 * fill these in, so putting them on the shared type would advertise a settlement
 * guarantee that only this adapter can honour.
 */
export interface MuapiJobStatus extends JobStatus {
  /** The charge MuAPI reports for this request, USD. Undefined when absent. */
  readonly actualUsd?: number;
  /** True when MuAPI refunded the task — the effective charge is then 0. */
  readonly refunded?: boolean;
}

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
  /**
   * Cost-tracker database. Required for a job to appear in the cost report and
   * for settlement to have a row to write to.
   *
   * Optional so the many injected-fetch tests that only exercise HTTP shapes
   * keep working without a SQLite file; when omitted, `generate` skips
   * `recordJob` and says so in the log rather than silently dropping the job
   * from the ledger.
   */
  readonly dbPath?: string;
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
      'MUAPI_API_KEY is not set. MuAPI authenticates with an x-api-key header ' +
        '(not a Bearer token) — get a key from the MuAPI dashboard and export it. ' +
        'The MuAPI tools are always registered; the key is the only thing gating them.',
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
  private readonly dbPath: string | undefined;

  /** Catalogue cache. Cleared per process, not persisted — prices move. */
  private catalogue: Map<string, MuapiModelEntry> | undefined;

  constructor(opts: MuapiOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? MUAPI_BASE;
    this.apiKeyOverride = opts.apiKey;
    this.dbPath = opts.dbPath;
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
      const body = (await response.json()) as { request_id?: string; cost?: MuapiCost };
      if (body.request_id === undefined) {
        // HTTP 2xx means MuAPI accepted and is very likely charging. Releasing
        // here would let a running generation complete for free.
        throw new ApiError(
          `MuAPI submit returned no request_id`,
          'API',
          { provider: 'muapi' },
        );
      }

      // The submit-time charge, from the header or the body's `cost` object.
      // PROVISIONAL, not settled: `cost.refunded` resolves at the terminal
      // poll, and MuAPI refunds failed tasks. Logged so an operator can see
      // what was taken up front, and reconciled by pollStatus later.
      const submitCost = readCostUsd(response, body);
      if (submitCost !== undefined) {
        logger.info('muapi: provisional charge reported at submit', {
          jobId,
          estimateUsd,
          submitCostUsd: submitCost,
        });
      }

      // Ledger row, keyed on the local jobId, carrying MuAPI's request_id as
      // the native task id. Without this the job is invisible to the cost
      // report and `recordActualCostUSD` has no row to UPDATE — settlement
      // would silently no-op, which is indistinguishable from working.
      if (this.dbPath !== undefined) {
        recordJob({
          dbPath: this.dbPath,
          jobId,
          provider: 'muapi',
          model: req.modelId,
          mode: req.mode,
          paramsHash: hashParams(req),
          estUsd: estimateUsd,
          nativeTaskId: body.request_id,
        });
      } else {
        logger.warn('muapi: no dbPath — job not recorded in the cost ledger', {
          jobId,
          requestId: body.request_id,
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

  /**
   * Polls a request by MuAPI's own `request_id` — NOT by the local jobId.
   *
   * The two are different strings and only one of them exists on MuAPI's side.
   * `generate` mints `muapi-{ts}-{rand}` for the ledger and stores MuAPI's id as
   * the handle's `providerNativeId`; passing the ledger key here would ask MuAPI
   * about a prediction it has never heard of.
   */
  async pollStatus(requestId: string): Promise<MuapiJobStatus> {
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
      cost?: MuapiCost;
    };

    // A refunded task effectively cost nothing. Reporting the charge anyway
    // would consume the caller's daily cap for a generation MuAPI gave back.
    const refunded = body.cost?.refunded === true;
    const rawUsd = body.cost?.amount_usd;
    const actualUsd = refunded
      ? 0
      : typeof rawUsd === 'number' && Number.isFinite(rawUsd)
        ? rawUsd
        : undefined;

    return {
      jobId: requestId,
      state: mapMuapiStatus(body.status),
      assetUrls: body.outputs ?? [],
      ...(body.error !== undefined ? { errorMessage: body.error } : {}),
      ...(actualUsd !== undefined ? { actualUsd } : {}),
      ...(body.cost?.refunded !== undefined ? { refunded } : {}),
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

  /**
   * Settles the ledger row at MuAPI's own figure.
   *
   * Real, unlike `HiggsfieldCliProvider.recordActualCostUSD` which is a
   * documented no-op: MuAPI reports the charge, so this writes a fact rather
   * than a re-derivation of `rate x duration`.
   *
   * `jobId` is the LOCAL ledger key (`muapi-…`), not MuAPI's `request_id` —
   * `recordActualCost` UPDATEs `video_jobs WHERE id = ?`, and the request_id
   * lives in `native_task_id`. It is also idempotent (`AND actual_usd IS NULL`),
   * so polling a completed job repeatedly settles once.
   */
  async recordActualCostUSD(jobId: string, usd: number): Promise<void> {
    if (this.dbPath === undefined) {
      logger.warn('muapi: no dbPath — actual cost not settled', { jobId, usd });
      return;
    }
    recordActualCost({ dbPath: this.dbPath, jobId, actualUsd: usd });
  }
}

/** Stable hash of the request, matching the per-provider helpers elsewhere. */
function hashParams(req: VideoGenerationRequest): string {
  const json = JSON.stringify({
    modelId: req.modelId,
    mode: req.mode,
    prompt: req.prompt,
    durationSec: req.durationSec,
    resolution: req.resolution,
    aspectRatio: req.aspectRatio,
    extras: req.extras,
  });
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
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

/**
 * The charge for a response, preferring the BODY over the header.
 *
 * MuAPI publishes both (verified via context7, muapi.ai/docs/api-reference), and
 * the body is the one that survives the trip: a reverse proxy or corporate egress
 * that strips `X-`-prefixed headers costs nothing visible, and header-only parsing
 * would then read "no charge" for a request that was billed. The header remains
 * the fallback for endpoints that answer with a bare body.
 *
 * A refunded task reports 0 — the amount was taken and given back, and the ledger
 * records what was actually kept.
 */
export function readCostUsd(
  response: { headers: { get(name: string): string | null } },
  body: { cost?: MuapiCost } | undefined,
): number | undefined {
  if (body?.cost?.refunded === true) return 0;
  const fromBody = body?.cost?.amount_usd;
  if (typeof fromBody === 'number' && Number.isFinite(fromBody)) return fromBody;
  return readCostHeader(response);
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
