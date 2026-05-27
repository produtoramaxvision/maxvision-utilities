import { createRequire } from 'node:module';
import type {
  VideoProvider,
  VideoGenerationRequest,
  JobHandle,
  JobStatus,
  JobState,
  DownloadedAsset,
  HiggsfieldExtras,
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

  async generate(req: VideoGenerationRequest): Promise<JobHandle> {
    const spec = VIDEO_MODELS[req.modelId];
    if (!spec) throw new Error(`unknown model: ${req.modelId}`);
    if (spec.provider !== 'higgsfield') {
      throw new Error(`model ${req.modelId} is not a higgsfield provider model`);
    }

    const jobId = `hf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const estUsd = this.estimateCostUSD(req);
    recordJob({
      dbPath: this.dbPath,
      jobId,
      provider: 'higgsfield',
      model: req.modelId,
      mode: req.mode,
      paramsHash: this.hashParams(req),
      estUsd,
    });

    const endpoint = this.endpointForModel(req.modelId);
    const url = this.buildUrlWithWebhook(endpoint, jobId);
    const body = this.buildRequestBody(req);
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...buildHiggsfieldHeaders(),
    };

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
    const parsed = (await res.json()) as PlatformGenerateResponse;

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
    const persistedStatusUrl = findStatusUrlByJobId({ dbPath: this.dbPath, jobId });
    const url =
      persistedStatusUrl ?? `${BASE_URL}/requests/${encodeURIComponent(requestId)}/status`;
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

    const res = await this.doFetch(cdnUrl, { method: 'GET' });
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
    switch (modelId) {
      case 'higgsfield-soul-standard':
        return '/higgsfield-ai/soul/standard';
      case 'higgsfield-soul-pro':
        return '/higgsfield-ai/soul/pro';
      case 'higgsfield-soul2':
        return '/higgsfield-ai/soul2/standard';
      case 'higgsfield-dop':
        return '/higgsfield-ai/dop/standard';
      case 'higgsfield-dop-turbo':
        return '/higgsfield-ai/dop/turbo';
      case 'higgsfield-speak':
        return '/higgsfield-ai/speak/standard';
      case 'higgsfield-speak2':
        return '/higgsfield-ai/speak2/standard';
      case 'higgsfield-cinema-studio-3.5':
        return '/higgsfield-ai/cinema-studio/3.5';
      case 'higgsfield-marketing-studio':
        return '/higgsfield-ai/marketing-studio/standard';
      case 'higgsfield-recast':
        return '/higgsfield-ai/recast/standard';
      default:
        throw new Error(`no endpoint mapped for higgsfield model: ${modelId}`);
    }
  }

  private buildUrlWithWebhook(endpoint: string, jobId: string): string {
    const base = `${BASE_URL}${endpoint}`;
    // D-2: P14 ships polling-only. Webhook URL injection requires BOTH:
    //   - publicWebhookBaseUrl explicitly configured AND
    //   - MEDIA_FORGE_HF_WEBHOOK_ENABLE=true (opt-in flag, off in P14)
    // When the flag flips on in P14.1, the URL injection path is already wired.
    const enabled = process.env['MEDIA_FORGE_HF_WEBHOOK_ENABLE'] === 'true';
    if (!enabled || !this.publicWebhookBaseUrl) return base;
    const webhook = `${this.publicWebhookBaseUrl.replace(/\/$/, '')}/webhooks/higgsfield/${encodeURIComponent(jobId)}`;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}hf_webhook=${encodeURIComponent(webhook)}`;
  }

  private buildRequestBody(req: VideoGenerationRequest): Record<string, unknown> {
    const extras =
      req.extras?.providerKind === 'higgsfield' ? (req.extras as HiggsfieldExtras) : undefined;

    // Compose prompt: optionally prefix DoP camera verbs as documented.
    let prompt = req.prompt;
    if (extras?.dopCameraVerbs && extras.dopCameraVerbs.length > 0) {
      prompt = `${extras.dopCameraVerbs.join(' ')} ${prompt}`;
    }

    const body: Record<string, unknown> = {
      prompt,
      aspect_ratio: req.aspectRatio ?? '16:9',
      resolution: req.resolution,
      duration_seconds: req.durationSec,
    };

    if (req.firstFrameImagePath) body['first_frame_url'] = req.firstFrameImagePath;
    if (req.lastFrameImagePath) body['last_frame_url'] = req.lastFrameImagePath;
    if (req.referenceImagePaths && req.referenceImagePaths.length > 0) {
      body['reference_urls'] = [...req.referenceImagePaths];
    }
    if (typeof req.fps === 'number') body['fps'] = req.fps;

    if (!extras) return body;

    if (extras.soulId) body['soul_id'] = extras.soulId;
    if (extras.cinemaStudioParams) {
      const cs = extras.cinemaStudioParams;
      if (typeof cs.focalLengthMm === 'number') body['focal_length_mm'] = cs.focalLengthMm;
      if (typeof cs.apertureFStop === 'number') body['aperture_fstop'] = cs.apertureFStop;
      if (cs.sensorSize) body['sensor_size'] = cs.sensorSize;
      if (cs.colorGrading) body['color_grading'] = cs.colorGrading;
      if (cs.lensId) body['lens_id'] = cs.lensId;
    }
    // Speak audio path (PRELIMINAR_URL decision — passes through as audio_url).
    if (extras.speakAudioPath) body['audio_url'] = extras.speakAudioPath;
    if (extras.marketingStudioTemplate) body['template'] = extras.marketingStudioTemplate;
    if (extras.marketingStudioProductUrl) body['product_url'] = extras.marketingStudioProductUrl;
    if (extras.multiReferenceImages && extras.multiReferenceImages.length > 0) {
      body['multi_reference_urls'] = [...extras.multiReferenceImages];
    }
    if (extras.recastTargetCharacterPath) {
      body['target_character_url'] = extras.recastTargetCharacterPath;
    }
    if (extras.viralityPredictor) body['virality_predictor'] = true;
    if (extras.aggregatorProxyModel) body['proxy_model'] = extras.aggregatorProxyModel;

    return body;
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
