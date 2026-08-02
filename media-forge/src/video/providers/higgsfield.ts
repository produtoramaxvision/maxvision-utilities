import { createRequire } from 'node:module';
import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  JobState,
  DownloadedAsset,
  HiggsfieldExtras,
  VideoLedgerHooks,
} from './base.js';
import type { Provider, VideoModelSpec } from '../../core/models.js';
import { VIDEO_MODELS, PRICING_OVERRIDES } from '../../core/models.js';
import { recordJob, recordActualCost } from '../../core/cost-tracker.js';
import {
  recordRequestMapping,
  findRequestIdByJobId,
  findStatusUrlByJobId,
} from '../../core/provider-request-map.js';
import {
  buildHiggsfieldHeaders,
  buildFallbackHeaders,
} from './auth/higgsfield-headers.js';

export interface HiggsfieldProviderOptions {
  readonly dbPath: string;
  /** Public-facing base URL Higgsfield will POST webhook callbacks to. When empty/undefined,
   *  generate() falls back to polling (no `hf_webhook` query param). */
  readonly publicWebhookBaseUrl?: string;
  /** Override fetch (for tests). */
  readonly fetchImpl?: typeof fetch;
}

const BASE_URL = 'https://platform.higgsfield.ai';

/**
 * modelId -> platform path. Exported so a live test can check each one against
 * the platform itself instead of trusting this file.
 *
 * It used to hold ten entries and SIX of them answered `404 model_not_found`.
 * Those are gone rather than annotated — a map of endpoints is not the place to
 * record which endpoints do not exist:
 *
 *   soul/pro                  "pro" is not a tier. The segment is a MODE and the
 *                             platform said so: reference | character | standard
 *   speak2/standard           404 with and without the tier segment; speak2
 *                             exists on no Higgsfield surface
 *   recast/standard           404; absent from the CLI too
 *   cinema-studio/3.5         404 on the Cloud API — the product is real and now
 *   marketing-studio/standard 404 on the Cloud API — reached over the CLI
 *                             transport as cinematic_studio_video_3_5 and
 *                             marketing_studio_video
 *   soul2/standard            404 — corrected in place to soul/v2/standard,
 *                             which answers
 *
 * ## Three answers discriminate, not two (probed 2026-08-02)
 *
 *   404 model_not_found  the platform does not serve this path
 *   423 model_blocked    it does, and this account cannot reach it
 *   400 / 422            it does, and the empty body failed validation
 *
 * `reve/text-to-image` is the 423 case — a headline model in the official images
 * guide, real, and not enabled on this account. Recording it as 404 would file
 * ACCOUNT state as CATALOGUE state, and the two decay differently: a 404 stays
 * false until the platform ships the model, a 423 flips the day the plan or the
 * account changes.
 *
 * See tests/video/providers/higgsfield-endpoints-live.test.ts, which re-POSTs
 * every entry here and turns red if one stops being served.
 */
export const HIGGSFIELD_ENDPOINTS: Readonly<Record<string, string>> = {
  'higgsfield-soul-standard': '/higgsfield-ai/soul/standard',
  // Real slug — /higgsfield-ai/soul2/standard answered 404. Probed 2026-08-01.
  'higgsfield-soul2': '/higgsfield-ai/soul/v2/standard',
  'higgsfield-dop': '/higgsfield-ai/dop/standard',
  'higgsfield-dop-turbo': '/higgsfield-ai/dop/turbo',
  // No tier segment. `/higgsfield-ai/speak/standard` answered 404
  // model_not_found; `/higgsfield-ai/speak` answers 422 naming image_url,
  // audio_url and prompt. Probed 2026-08-01.
  'higgsfield-speak': '/higgsfield-ai/speak',
};

/**
 * The body fields each endpoint ACTUALLY validates, measured 2026-08-01.
 *
 * ## Why this has to exist
 *
 * This API ignores unknown fields instead of rejecting them. A body carrying a
 * field the endpoint does not have is accepted, discarded, and the generation
 * runs at the model default — no error anywhere. That is not a hypothetical: it
 * is how `duration_seconds` survived months in this file, and the audit that
 * found it stopped one field short.
 *
 * Sending "just in case" is therefore never harmless here. Only fields on this
 * list are sent; everything else is dropped with a one-time warning, so a
 * mismatch is visible instead of silent.
 *
 * ## How it was measured, and how to re-measure
 *
 * POST the endpoint with every candidate name carrying a deliberately WRONG TYPE
 * and read the 422: a field the schema knows answers with a type error naming
 * it, and a field it does not know is absent from the response. The body never
 * validates, so nothing is queued and the whole sweep costs 0 credits:
 *
 *   POST /higgsfield-ai/dop/standard
 *   {"prompt":1,"image_url":2,"last_frame_url":3,"end_image_url":4,"fps":"x"}
 *   -> detail names prompt, image_url, end_image_url — and NOT last_frame_url or fps
 *
 * ## What that sweep corrected
 *
 *   last_frame_url  -> end_image_url      every first-last-frame call had been
 *                                          running as a plain first-frame
 *                                          animation; the end frame was dropped
 *   soul_id         -> custom_reference_id a trained Soul-ID (40 credits) was
 *                                          never applied to any generation
 *   aspect_ratio / resolution / duration   NOT accepted by dop/*; the registry's
 *                                          resolution list and the router's
 *                                          resolution filter are fiction there
 *   fps, reference_urls, multi_reference_urls, template, product_url,
 *   target_character_url, proxy_model, virality_predictor, and the five
 *   cinema-studio lens fields — none exist on any endpoint that answers
 *
 * `end_image_url` is accepted by the PLAIN dop endpoints too, not only the
 * `/first-last-frame` variants.
 *
 * Endpoints absent from this map are the ones that 404 (see `spec.unavailable`);
 * there is no schema to record for a model the platform does not serve.
 */
export const HIGGSFIELD_ACCEPTED_BODY_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  'higgsfield-soul-standard': new Set([
    'prompt',
    'aspect_ratio',
    'resolution',
    'batch_size',
    'seed',
    'custom_reference_id',
    'style_id',
  ]),
  // soul/v2/standard validates the same set as soul/standard.
  'higgsfield-soul2': new Set([
    'prompt',
    'aspect_ratio',
    'resolution',
    'batch_size',
    'seed',
    'custom_reference_id',
    'style_id',
  ]),
  'higgsfield-dop': new Set([
    'prompt',
    'image_url',
    'end_image_url',
    'motions',
    'enhance_prompt',
    'seed',
  ]),
  'higgsfield-dop-turbo': new Set([
    'prompt',
    'image_url',
    'end_image_url',
    'motions',
    'enhance_prompt',
    'seed',
  ]),
  'higgsfield-speak': new Set([
    'prompt',
    'image_url',
    'audio_url',
    'quality',
    'duration',
    'enhance_prompt',
    'seed',
  ]),
};

/** One-time warning latch per `${modelId}.${field}` — see dropUnacceptedFields. */
const _warnedDroppedFields = new Set<string>();

/**
 * Keeps only the fields the endpoint validates, and says what it dropped.
 *
 * Silence is the failure mode being fixed, so a drop is never quiet. It is a
 * warning rather than a throw because callers legitimately pass `durationSec`
 * and `resolution` for every provider — those are part of the shared
 * VideoGenerationRequest shape, and DoP simply has nowhere to put them.
 *
 * A model with no entry is one the platform does not serve; its body is passed
 * through untouched rather than emptied, so the 404 stays the error the caller
 * sees instead of a confusing empty-body 422.
 */
function dropUnacceptedFields(
  modelId: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const accepted = HIGGSFIELD_ACCEPTED_BODY_FIELDS[modelId];
  if (accepted === undefined) return body;

  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (accepted.has(key)) {
      kept[key] = value;
      continue;
    }
    const latch = `${modelId}.${key}`;
    if (!_warnedDroppedFields.has(latch)) {
      _warnedDroppedFields.add(latch);
      process.stderr.write(
        `[higgsfield] ${modelId} does not accept "${key}" — dropping it. ` +
          `The platform would have ignored it silently and generated at the default.\n`,
      );
    }
  }
  return kept;
}

// One-shot warning latch for the broken HF_WEBHOOK_ENABLE path (Codex P2 PR#13).
let _warnedHfWebhookBroken = false;

/**
 * Does this model's endpoint return a video?
 *
 * The Soul family is `text2image` on the platform — it takes aspect_ratio,
 * resolution, batch_size and seed, and there is no duration to honour. Sending
 * `duration` anyway is not an ERROR, and that is exactly the danger: this API
 * IGNORES unknown and inapplicable fields rather than rejecting them, which is
 * how `duration_seconds` spent months being silently discarded while every
 * generation ran at the model default. Omitting the field keeps the request an
 * honest description of what will happen.
 *
 * Lifted out of `buildRequestBody` deliberately. That function is already the
 * most complex in this file (cyclomatic 28 before this change, over the repo's
 * threshold of 20); adding a branch and an optional chain inside it pushed it to
 * 30. A named predicate keeps the fix from making a known hotspot worse, and
 * reads better than the inline lookup did.
 *
 * Unknown ids answer `true`: this is not the place to decide a model does not
 * exist — `endpointForModel` already refuses those by name, with a better
 * message.
 */
/**
 * Fold the Higgsfield-specific extras into the body, under the names the
 * platform validates.
 *
 * Lifted out of `buildRequestBody` for the same reason `producesVideo` was: that
 * function is the one place the whole field map is legible, and each rename
 * below needs its evidence attached to it.
 */
function applyHiggsfieldExtras(body: Record<string, unknown>, extras: HiggsfieldExtras): void {
  //   soul_id -> custom_reference_id
  //     The Soul family validates `custom_reference_id` (and `style_id`).
  //     `soul_id` is not a field, so a Soul-ID the user trained — 40 credits —
  //     was never applied to the generation it was trained for.
  if (extras.soulId) body['custom_reference_id'] = extras.soulId;

  // Speak audio path (PRELIMINAR_URL decision — passes through as audio_url).
  if (extras.speakAudioPath) body['audio_url'] = extras.speakAudioPath;
  if (extras.aggregatorProxyModel) body['proxy_model'] = extras.aggregatorProxyModel;
}

function producesVideo(modelId: string): boolean {
  return VIDEO_MODELS[modelId]?.outputType !== 'image';
}

interface PlatformGenerateResponse {
  readonly request_id: string;
  readonly status_url: string;
  readonly cancel_url: string;
}

interface PlatformStatusResponse {
  readonly status:
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'nsfw'
    | 'canceled'
    | string;
  readonly request_id?: string;
  readonly progress?: number;
  readonly video?: { url: string };
  readonly images?: ReadonlyArray<{ url: string }>;
  readonly error?: string;
}

export class HiggsfieldProvider implements VideoProvider {
  readonly name: Provider = 'higgsfield';
  readonly models: VideoModelSpec[];
  private readonly dbPath: string;
  private readonly publicWebhookBaseUrl?: string;
  // Stored as optional and resolved at call time so tests that override
  // `global.fetch` after construction still intercept network I/O. Capturing
  // `globalThis.fetch.bind(...)` at construction time freezes the reference
  // and would let real platform.higgsfield.ai calls leak through the mock.
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: HiggsfieldProviderOptions) {
    this.dbPath = opts.dbPath;
    this.publicWebhookBaseUrl = opts.publicWebhookBaseUrl;
    this.fetchImpl = opts.fetchImpl;
    this.models = Object.values(VIDEO_MODELS).filter((m) => m.provider === 'higgsfield');
  }

  /** Resolves the active fetch impl at call time so test fetch overrides work. */
  private readonly doFetch: typeof fetch = (input, init) => {
    const f = this.fetchImpl ?? globalThis.fetch;
    return f(input, init);
  };

  // -------------------------------------------------------------------------
  // VideoProvider interface
  // -------------------------------------------------------------------------

  async generate(req: VideoGenerationRequest, ledgerHooks?: VideoLedgerHooks): Promise<JobHandle> {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'higgsfield') {
      throw new Error(`model ${req.modelId} is not a higgsfield provider model`);
    }
    // FIX (Codex P2 round 11, PR#10): direct provider.generate calls (now
    // reachable via media_higgsfield_generate + the specialised tools) must
    // enforce per-model capability bounds locally. Otherwise an over-spec
    // request burns credits, gets a vague upstream 4xx, and leaves the cost
    // row pending. Validate maxDurationSec + resolution before submit.
    if (req.durationSec > spec.maxDurationSec) {
      throw new Error(
        `model ${req.modelId} caps durationSec at ${spec.maxDurationSec} (got ${req.durationSec})`,
      );
    }
    if (req.resolution && !spec.resolutions.includes(req.resolution)) {
      throw new Error(
        `model ${req.modelId} supports resolutions [${spec.resolutions.join(', ')}], got '${req.resolution}'`,
      );
    }

    const jobId = `hf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const estUsd = this.estimateCostUSD(req);

    const endpoint = this.endpointForModel(req.modelId);
    const url = this.buildUrlWithWebhook(endpoint, jobId);
    const body = this.buildRequestBody(req);
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...buildHiggsfieldHeaders(),
    };

    // A5 (2026-07-30): reserve credit BEFORE the network submit, closing C8 for
    // Higgsfield. May throw (InsufficientCreditError) — propagates straight out
    // of generate() and blocks the call; nothing has been sent to the platform yet.
    if (ledgerHooks) {
      await ledgerHooks.beforeSubmit(jobId, estUsd);
    }

    let parsed: PlatformGenerateResponse;
    try {
      // D-5: auth resilience — try primary headers first; on 401/403, retry once with fallback.
      let res = await this.doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) {
        process.stderr.write(
          `[higgsfield-auth] primary auth scheme rejected (status=${res.status}) — retrying once with fallback scheme. Operator: update .env / restart so the primary path is used.\n`,
        );
        process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'] = 'true';
        const fallbackHeaders = {
          'content-type': 'application/json',
          accept: 'application/json',
          ...buildFallbackHeaders(),
        };
        res = await this.doFetch(url, {
          method: 'POST',
          headers: fallbackHeaders,
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Higgsfield generate failed: ${res.status} ${errText.slice(0, 400)}`);
      }
      parsed = (await res.json()) as PlatformGenerateResponse;
    } catch (err) {
      // The platform never accepted the job — release the reservation opened above.
      if (ledgerHooks) {
        await ledgerHooks.onSubmitFailed(jobId, estUsd);
      }
      throw err;
    }

    try {
      // FIX (Codex P2 round 14, PR#10): record the job ONLY after the upstream
      // submit succeeds. The previous order (recordJob → POST) left a permanent
      // 'pending' row on every failed submit (401/403 after both auth attempts,
      // 4xx validation, network errors), polluting cost reports and forcing
      // manual cleanup. Per-second cost rows are cheap; we lose nothing by
      // deferring the write until we hold a real provider request_id.
      recordJob({
        dbPath: this.dbPath,
        jobId,
        provider: 'higgsfield',
        model: req.modelId,
        mode: req.mode,
        paramsHash: this.hashParams(req),
        estUsd,
      });

      recordRequestMapping({
        dbPath: this.dbPath,
        jobId,
        provider: 'higgsfield',
        providerRequestId: parsed.request_id,
        // FIX (Codex P2 round 7, PR#10): persist the server-supplied status_url
        // so pollStatus uses Higgsfield's authoritative URL (signed CDN URLs,
        // alternative paths, query tokens) instead of reconstructing the wrong
        // endpoint.
        ...(parsed.status_url ? { statusUrl: parsed.status_url } : {}),
      });
    } catch (err) {
      // A5: the platform DID accept the job (parsed.request_id above) — the
      // reservation must NOT be released here (see VideoLedgerHooks.
      // onPostSubmitError's doc comment in base.ts). Log for manual
      // reconciliation and propagate the original error unchanged.
      if (ledgerHooks) {
        ledgerHooks.onPostSubmitError(jobId, estUsd, err);
      }
      throw err;
    }

    return {
      jobId,
      provider: 'higgsfield',
      model: req.modelId,
      mode: req.mode,
      createdAt: new Date().toISOString(),
      providerNativeId: parsed.request_id,
    };
  }

  async pollStatus(jobId: string): Promise<JobStatus> {
    const requestId = findRequestIdByJobId({ dbPath: this.dbPath, jobId });
    if (!requestId) {
      // The job either never went through generate() OR the map row was lost.
      // Return pending — caller can choose to abort or retry generate.
      return { jobId, state: 'pending' };
    }
    // FIX (Codex P2 round 7, PR#10): prefer the server-supplied status_url
    // when present. Higgsfield may return signed CDN URLs or alternative
    // paths that don't match `${BASE_URL}/requests/{id}/status`; reconstructing
    // would 404. Fall back to canonical reconstruction only when status_url
    // was not captured (pre-round-7 rows, or providers that omit the field).
    //
    // FIX (Codex local round 8, PR#10): SSRF defense — status_url comes from
    // the provider response and could be tampered with (MITM, corrupted DB
    // row). Reject anything that is not https + hosted under higgsfield.ai
    // before issuing the GET.
    const persistedStatusUrl = findStatusUrlByJobId({ dbPath: this.dbPath, jobId });
    const safePersistedUrl =
      persistedStatusUrl && isSafeHiggsfieldStatusUrl(persistedStatusUrl)
        ? persistedStatusUrl
        : undefined;
    if (persistedStatusUrl && !safePersistedUrl) {
      process.stderr.write(
        `[higgsfield-auth] rejected persisted status_url for job ${jobId} ` +
          `(scheme/host not allowlisted) — falling back to canonical reconstruction.\n`,
      );
    }
    const url =
      safePersistedUrl ?? `${BASE_URL}/requests/${encodeURIComponent(requestId)}/status`;
    // FIX (Codex P1, PR#10): mirror generate()'s primary→fallback auth handshake.
    // If the platform required fallback headers for submit, polling must use the
    // same scheme — otherwise jobs submitted via fallback become un-pollable.
    // Sticky signal via env var set in generate(); also retry once on 401/403.
    const fallbackInUse = process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'] === 'true';
    const primaryHeaders = { accept: 'application/json', ...buildHiggsfieldHeaders() };
    const fallbackHeaders = { accept: 'application/json', ...buildFallbackHeaders() };
    let res = await this.doFetch(url, {
      method: 'GET',
      headers: fallbackInUse ? fallbackHeaders : primaryHeaders,
    });
    if (!fallbackInUse && (res.status === 401 || res.status === 403)) {
      process.stderr.write(
        `[higgsfield-auth] pollStatus primary auth rejected (status=${res.status}) — retrying once with fallback scheme.\n`,
      );
      process.env['MEDIA_FORGE_HF_AUTH_FALLBACK_USED'] = 'true';
      res = await this.doFetch(url, { method: 'GET', headers: fallbackHeaders });
    }
    if (!res.ok) {
      throw new Error(`Higgsfield pollStatus failed: ${res.status}`);
    }
    const parsed = (await res.json()) as PlatformStatusResponse;

    const state = this.mapPlatformStatus(parsed.status);
    const assetUrls: string[] = [];
    if (parsed.video?.url) assetUrls.push(parsed.video.url);
    if (parsed.images) {
      for (const img of parsed.images) {
        if (img.url) assetUrls.push(img.url);
      }
    }

    return {
      jobId,
      state,
      progress: typeof parsed.progress === 'number' ? parsed.progress : undefined,
      assetUrls: assetUrls.length > 0 ? assetUrls : undefined,
      errorMessage: parsed.error,
    };
  }

  async download(jobIdOrCdnUrl: string): Promise<DownloadedAsset> {
    // Accept either an explicit CDN URL or an internal jobId. If jobId: resolve
    // current status; if completed and an asset URL is present, fetch it.
    let cdnUrl: string;
    if (/^https?:\/\//.test(jobIdOrCdnUrl)) {
      cdnUrl = jobIdOrCdnUrl;
    } else {
      const status = await this.pollStatus(jobIdOrCdnUrl);
      if (status.state !== 'completed' || !status.assetUrls || status.assetUrls.length === 0) {
        throw new Error(
          `Higgsfield job ${jobIdOrCdnUrl} not ready for download (state=${status.state})`,
        );
      }
      cdnUrl = status.assetUrls[0]!;
    }
    // FIX (Codex P2 round 11, PR#10): SSRF defense — the MCP caller can pass
    // any http/https URL here, and the server process fetches it. In
    // environments where the MCP server has access to internal services,
    // a caller could supply a loopback/private/link-local host (or http://)
    // to pivot to internal endpoints. Require https + reject obvious
    // internal-IP patterns before the fetch.
    if (!isSafeHiggsfieldAssetUrl(cdnUrl)) {
      throw new Error(
        `Higgsfield download: refusing unsafe URL '${cdnUrl}' ` +
          `(must be https + non-internal host). SSRF defense.`,
      );
    }

    // FIX (Codex P1 round 13, PR#10): re-validate after each redirect. Default
    // `fetch` follows redirects automatically, so a CDN-allowlisted host can
    // 302 to an internal target (loopback / 169.254.169.254 / RFC1918 / IPv6
    // ULA) and bypass the pre-fetch guard above. Use `redirect: 'manual'` and
    // run every `Location` through `isSafeHiggsfieldAssetUrl` before following.
    let currentUrl = cdnUrl;
    let res: Response;
    const maxRedirects = 3;
    for (let hop = 0; ; hop++) {
      res = await this.doFetch(currentUrl, { method: 'GET', redirect: 'manual' });
      if (res.status < 300 || res.status >= 400) break;
      if (hop >= maxRedirects) {
        throw new Error(
          `Higgsfield download: refusing chain longer than ${maxRedirects} redirects (SSRF defense).`,
        );
      }
      const location = res.headers.get('location');
      if (!location) {
        throw new Error(
          `Higgsfield download: ${res.status} redirect without Location header (SSRF defense).`,
        );
      }
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new Error(
          `Higgsfield download: refusing malformed redirect target '${location}' (SSRF defense).`,
        );
      }
      if (!isSafeHiggsfieldAssetUrl(nextUrl)) {
        throw new Error(
          `Higgsfield download: refusing unsafe redirect target '${nextUrl}' (SSRF defense).`,
        );
      }
      currentUrl = nextUrl;
    }
    if (!res.ok) {
      throw new Error(`Higgsfield download failed: ${res.status}`);
    }
    const arr = await res.arrayBuffer();
    const buffer = Buffer.from(arr);
    return {
      buffer,
      metadata: {
        contentType: res.headers.get('content-type') ?? 'video/mp4',
        sizeBytes: buffer.length,
        cdnUrl,
      },
    };
  }

  estimateCostUSD(req: VideoGenerationRequest): number {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    const pricing = PRICING_OVERRIDES.get(spec.id) ?? spec.pricing;
    if (pricing.unit !== 'credits-per-video') {
      throw new Error(
        `Higgsfield pricing unit expected credits-per-video, got ${pricing.unit} for ${spec.id}`,
      );
    }
    const usdPerCredit = this.resolveUsdPerCredit();
    if (!usdPerCredit) {
      throw new Error(
        `usdPerCredit unavailable — set MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT (e.g. 0.039 for Plus plan)`,
      );
    }
    return pricing.rate * usdPerCredit;
  }

  async recordActualCostUSD(jobId: string, usd: number, finalStatus?: JobState): Promise<void> {
    // D-3: forward finalStatus so failed/nsfw paths persist their real terminal state.
    // Defaults to 'completed' inside recordActualCost when undefined (backwards compatible).
    recordActualCost({ dbPath: this.dbPath, jobId, actualUsd: usd, finalStatus });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private resolveUsdPerCredit(): number | undefined {
    // Deliberately the API rate (USD_PER_CREDIT), not usdPerCreditFor(): this
    // class IS the Cloud API transport, and the Cloud API bills the top-up
    // balance. The CLI transport draws the subscription balance and resolves its
    // own rate — see the two-pools note in core/higgsfield-pricing.ts.
    //
    // D-6: read the validated module-level constant from src/core/higgsfield-pricing.ts
    // (boot-validated by src/mcp/server.ts in Task 7.5). The env-var fallback below stays
    // so unit tests can override per-test via `process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT']`
    // without going through the boot path.
    try {
      // Lazy import via createRequire — keeps the provider testable in isolation
      // without forcing boot validation. ESM-safe (no `require` global) and
      // sidesteps the `@typescript-eslint/no-require-imports` rule cleanly.
      const _require = createRequire(import.meta.url);
      const mod = _require('../../core/higgsfield-pricing.js') as { USD_PER_CREDIT?: number };
      if (typeof mod.USD_PER_CREDIT === 'number' && mod.USD_PER_CREDIT > 0) {
        return mod.USD_PER_CREDIT;
      }
    } catch {
      /* module not present in this test or boot validation hasn't run — fall through */
    }
    const raw = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    if (!raw) return undefined;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  }

  private endpointForModel(modelId: string): string {
    const endpoint = HIGGSFIELD_ENDPOINTS[modelId];
    if (endpoint === undefined) {
      throw new Error(`no endpoint mapped for higgsfield model: ${modelId}`);
    }
    return endpoint;
  }

  private buildUrlWithWebhook(endpoint: string, _jobId: string): string {
    const base = `${BASE_URL}${endpoint}`;
    // D-2: P14 ships polling-only. Webhook URL injection requires BOTH:
    //   - publicWebhookBaseUrl explicitly configured AND
    //   - MEDIA_FORGE_HF_WEBHOOK_ENABLE=true (opt-in flag, off in P14)
    //
    // FIX (Codex P2, PR#13): Higgsfield does NOT sign callbacks with our HMAC
    // (no documented signing mechanism). The router's default validator
    // requires x-webhook-timestamp + x-webhook-signature, which Higgsfield
    // never sends, so every callback 401s before createHiggsfieldWebhookHandler
    // can run — enabling this flag silently breaks the webhook path while
    // polling continues to work. Until a Higgsfield-specific auth validator
    // is registered (or Higgsfield publishes a signing scheme), suppress the
    // URL injection with a loud one-shot warning and fall through to polling.
    const enabled = process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'] === 'true';
    if (!enabled || !this.publicWebhookBaseUrl) return base;
    if (!_warnedHfWebhookBroken) {
      _warnedHfWebhookBroken = true;
      process.stderr.write(
        '[higgsfield] MEDIA_FORGE_HF_WEBHOOK_ENABLE=true ignored — webhook path ' +
          'is broken (no Higgsfield-specific auth validator; default HMAC rejects ' +
          "every callback with 401). Falling back to polling. Disable the flag or " +
          'register a custom validator in server.ts to silence this warning.\n',
      );
    }
    return base;
  }

  /**
   * The caller-supplied half of the body.
   *
   * DELIBERATELY NOT SENT — probed on every endpoint that answers, named by none
   * of them: fps, reference_urls, multi_reference_urls, template, product_url,
   * target_character_url, virality_predictor, and the five cinema-studio lens
   * fields (focal_length_mm, aperture_fstop, sensor_size, color_grading,
   * lens_id). The endpoints they were written for (cinema-studio/3.5,
   * marketing-studio, recast) answer 404, so those fields were never validated
   * by anything. Building them here would only restore the silent-discard
   * behaviour dropUnacceptedFields exists to end.
   */
  private buildRequestBody(req: VideoGenerationRequest): Record<string, unknown> {
    const extras =
      req.extras?.providerKind === 'higgsfield' ? (req.extras as HiggsfieldExtras) : undefined;

    // Compose prompt: optionally prefix DoP camera verbs as documented.
    let prompt = req.prompt;
    if (extras?.dopCameraVerbs && extras.dopCameraVerbs.length > 0) {
      prompt = `${extras.dopCameraVerbs.join(' ')} ${prompt}`;
    }

    // Every name below was read off the live API on 2026-08-01 by POSTing the
    // candidate with a WRONG TYPE and seeing whether the 422 named it. See
    // HIGGSFIELD_ACCEPTED_BODY_FIELDS for the method and for what the sweep
    // corrected. The bodies never validate, so the audit cost 0 credits.
    //
    // Assembled generously, then filtered: dropUnacceptedFields is what stops a
    // field going to an endpoint that would ignore it in silence.
    const body: Record<string, unknown> = {
      prompt,
      aspect_ratio: req.aspectRatio ?? '16:9',
      resolution: req.resolution,
    };

    //   duration_seconds -> duration
    //     `/higgsfield-ai/speak` answers `Input should be 5, 10 or 15` for
    //     `duration` and never mentions `duration_seconds`.
    //
    //   dop/* accept NO duration at all — nor aspect_ratio, nor resolution. Their
    //   flat `credits-per-video` price is consistent with that: there is no length
    //   to charge for. The filter removes all three.
    if (producesVideo(req.modelId)) body['duration'] = req.durationSec;

    //   first_frame_url -> image_url
    //     THE defect that made every image-driven Higgsfield call fail:
    //       POST /higgsfield-ai/dop/standard
    //       {"prompt":"x","first_frame_url":"…"}
    //       -> 422 {"loc":["body","image_url"],"msg":"Field required"}
    if (req.firstFrameImagePath) body['image_url'] = req.firstFrameImagePath;

    //   last_frame_url -> end_image_url
    //     `last_frame_url` is not a field on ANY Higgsfield endpoint. It was sent
    //     and discarded, so every first-last-frame request generated from the
    //     first frame alone and the end frame the caller chose did nothing.
    //     Accepted by the plain dop endpoints too, not only /first-last-frame.
    if (req.lastFrameImagePath) body['end_image_url'] = req.lastFrameImagePath;

    if (extras) applyHiggsfieldExtras(body, extras);

    return dropUnacceptedFields(req.modelId, body);
  }

  private mapPlatformStatus(s: string): JobState {
    switch (s) {
      case 'completed':
      case 'success':
      case 'succeeded':
        return 'completed';
      case 'failed':
      case 'error':
        return 'failed';
      case 'nsfw':
      case 'rejected':
        return 'nsfw';
      case 'canceled':
      case 'cancelled':
        return 'canceled';
      case 'in_progress':
      case 'processing':
      case 'running':
        return 'in_progress';
      case 'pending':
      case 'queued':
      default:
        return 'pending';
    }
  }

  private hashParams(req: VideoGenerationRequest): string {
    const json = JSON.stringify({
      modelId: req.modelId,
      mode: req.mode,
      prompt: req.prompt,
      durationSec: req.durationSec,
      resolution: req.resolution,
      aspectRatio: req.aspectRatio,
      fps: req.fps,
      extras: req.extras,
    });
    let h = 0;
    for (let i = 0; i < json.length; i++) {
      h = ((h << 5) - h + json.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16);
  }
}

/**
 * SSRF allowlist for status_url values sourced from Higgsfield's API.
 *
 * The provider returns a `status_url` field that we persist + use as a poll
 * target. Even though the value normally comes from a trusted upstream, it
 * crosses an untrusted boundary (network response + on-disk DB row) before
 * we reach back out. An attacker who tampers with either could redirect the
 * poll fetch to internal services. We restrict to https + an explicit
 * domain allowlist anchored on higgsfield.ai (apex + any subdomain). Anything
 * else triggers a fallback to canonical URL reconstruction.
 *
 * Codex local round 8 PR#10.
 */
export function isSafeHiggsfieldStatusUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  // Allow apex + arbitrary subdomain. Reject look-alikes (higgsfield.ai.evil.com,
  // myhiggsfield.ai, etc.) by requiring an exact match on the apex or a
  // strict `.higgsfield.ai` suffix.
  const host = u.hostname.toLowerCase();
  return host === 'higgsfield.ai' || host.endsWith('.higgsfield.ai');
}

/**
 * Looser allowlist for download URLs: Higgsfield delivers assets from CDN
 * hosts that often live on third-party domains (S3 signed URLs, CloudFront
 * distributions, etc.) — anchoring on higgsfield.ai would break legit
 * downloads. Instead, defense-in-depth via:
 *
 *   - require https (blocks http://internal/...)
 *   - reject obvious internal-IP literals (loopback, link-local AWS metadata,
 *     RFC1918 private ranges, IPv6 loopback / link-local)
 *   - reject hostnames that resolve to .local / .internal / .lan TLDs that
 *     are commonly used for intranet services
 *
 * This does NOT do DNS resolution (sync API constraint), so a malicious
 * hostname that resolves to a private IP at request time is still possible.
 * Operators concerned about that should run the MCP server in a sandbox
 * with egress restricted to known CDN ranges.
 *
 * Codex P2 round 11 PR#10.
 */
export function isSafeHiggsfieldAssetUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  // URL.hostname returns IPv6 wrapped in `[…]` brackets — strip them before
  // pattern matching so the `::1` / `fe80::` checks below actually fire.
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  // Empty / whitespace host
  if (!host) return false;
  // IPv4 loopback + link-local + RFC1918 private literals
  if (host === '0.0.0.0' || host === 'localhost') return false;
  if (host.startsWith('127.')) return false;
  if (host.startsWith('10.')) return false;
  if (host.startsWith('192.168.')) return false;
  // 172.16.0.0/12 → first octet 172, second octet 16-31
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  // Link-local 169.254.0.0/16 (covers AWS IMDS at 169.254.169.254)
  if (host.startsWith('169.254.')) return false;
  // IPv6 loopback + link-local + ULA (FIX Codex P1 round 12, PR#10):
  // Previous `startsWith('fc00:'|'fd00:'|'fe80:')` only matched literal prefixes,
  // missing the rest of each range. ULA (fc00::/7) covers fc00:-fdff:; link-local
  // (fe80::/10) covers fe80:-febf:. Docker IPv6 networks default to fd**::/8 —
  // `fd12::1`, `fdab::1`, `fce0::1` previously slipped through and reached
  // internal services. Switch to regex covering the full prefix nibbles.
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return false;
  // fc00::/7 ULA — first byte f, second nibble c|d, any third+fourth nibble
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return false;
  // fe80::/10 link-local — first byte fe, second high nibble 8|9|a|b
  if (/^fe[89ab][0-9a-f]?:/i.test(host)) return false;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d). Node normalizes ::ffff:127.0.0.1 →
  // ::ffff:7f00:1, which bypasses the IPv4 loopback check above. Any v4-mapped
  // IPv6 is suspicious for a CDN target (no legit CDN uses them); reject the
  // whole class to close the bypass.
  if (/(^|:)ffff:[0-9a-f.:]+/i.test(host)) return false;
  // Intranet TLDs (RFC 6762 mDNS, RFC 2606 reserved, common conventions)
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  if (host.endsWith('.localhost')) return false;
  return true;
}
