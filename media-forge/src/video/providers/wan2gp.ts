// src/video/providers/wan2gp.ts
// T16 — Wan2GP, a locally-hosted video model behind a Gradio server.
//
// ## What this file will never do
//
// It will never install anything, never download model weights, and never assume
// a server exists. That is the user's explicit constraint on this task: the
// plugin ships the OPTION, and the end user decides whether to run it. Nothing
// here touches the maintainer's machine.
//
// The only thing this adapter does is talk to a server the user chose to start.
// If the flag is on and nothing answers, it says so in terms the user can act on
// rather than hanging or half-working.
//
// ## Zero cost is not zero consequence
//
// Local inference has no per-generation charge, so pricing.rate is 0. That makes
// it unbeatable in the router's ascending cost sort, which would silently move
// every route here the moment the flag is set. The mitigation lives in
// src/mcp/handlers/video.ts (isOptInOnlyProvider): zero-cost providers are
// excluded from automatic selection and reachable only by naming them in
// preferProvider. Free is not the same as equivalent, and enabling a local
// server to try it is not a request to move the whole pipeline onto it.
//
// ## Real requirements, so the user can decide before downloading 80 GB
//
// 6 GB VRAM minimum and 30-80 GB of disk depending on the model set. Those
// numbers are surfaced by `media-forge setup wan2gp` BEFORE any download is
// suggested, because discovering them afterwards is expensive in a way an error
// message cannot undo.

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

/** Gradio's default. Overridable — the user hosts this, not us. */
export const WAN2GP_DEFAULT_URL = 'http://127.0.0.1:7860';

/** Published minimums, surfaced by the setup command before any download. */
export const WAN2GP_MIN_VRAM_GB = 6;
export const WAN2GP_MIN_DISK_GB = 30;
export const WAN2GP_MAX_DISK_GB = 80;

/** Local inference: no per-generation charge. See the header on why 0 is risky. */
export const WAN2GP_RATE_USD = 0;

export interface Wan2gpOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Preflight only; generation waits as long as the model needs. */
  readonly probeTimeoutMs?: number;
}

/**
 * True when the operator opted in. Default false.
 *
 * Read at call time rather than captured at module load so a test (or a hosted
 * deployment flipping it off) is not fighting a value frozen at import.
 */
export function isWan2gpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['MEDIA_FORGE_WAN2GP_ENABLED'] === 'true';
}

export function wan2gpBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env['MEDIA_FORGE_WAN2GP_URL'] ?? WAN2GP_DEFAULT_URL;
}

export class Wan2gpProvider {
  readonly name = 'wan2gp' as Provider;
  readonly models = [];

  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly probeTimeoutMs: number;

  constructor(opts: Wan2gpOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? wan2gpBaseUrl();
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 3000;
  }

  /**
   * Confirms a server is actually answering before anything is attempted.
   *
   * The failure this exists to prevent is the confusing one: the flag is set, the
   * user believes Wan2GP is available, and every generation fails with a
   * connection error from deep inside a fetch. Naming the URL and the two likely
   * causes turns that into a thirty-second fix.
   */
  async preflight(): Promise<void> {
    if (!isWan2gpEnabled()) {
      throw new ValidationError(
        'Wan2GP is not enabled. Set MEDIA_FORGE_WAN2GP_ENABLED=true after starting your ' +
          'own Wan2GP server. Run `media-forge setup wan2gp` for the requirements — the ' +
          'plugin never installs it for you.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ApiError(
          `a server answered at ${this.baseUrl} but returned HTTP ${response.status}. ` +
            `Is that really the Wan2GP Gradio server?`,
          'API',
          { provider: 'wan2gp' },
        );
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        `no Wan2GP server answered at ${this.baseUrl}. Either it is not running, or it is ` +
          `listening on a different port — set MEDIA_FORGE_WAN2GP_URL. The plugin does not ` +
          `start or install the server.`,
        'API',
        { provider: 'wan2gp' },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Always 0. Local inference bills nothing per generation.
   *
   * Electricity and wear are real but are not per-job costs this ledger can
   * meaningfully attribute, and inventing a number would put fiction into the
   * cost report. The routing consequence of 0 is handled in the router, not by
   * distorting the price here.
   */
  estimateCostUSD(_req: VideoGenerationRequest): number {
    return WAN2GP_RATE_USD;
  }

  async generate(
    req: VideoGenerationRequest,
    ledgerHooks?: VideoLedgerHooks,
  ): Promise<JobHandle> {
    await this.preflight();

    const jobId = `wan2gp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // Hooks are still honoured even at zero cost. A reservation of $0 is a no-op
    // in the ledger, but the job ROW is what makes a local generation visible in
    // the cost report and the trace alongside paid ones. Skipping the hooks here
    // would make local work invisible, which is worse than uninteresting.
    await ledgerHooks?.beforeSubmit(jobId, WAN2GP_RATE_USD);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: buildGradioPayload(req) }),
      });
    } catch (err) {
      await ledgerHooks?.onSubmitFailed(jobId, WAN2GP_RATE_USD);
      throw err;
    }

    if (!response.ok) {
      await ledgerHooks?.onSubmitFailed(jobId, WAN2GP_RATE_USD);
      throw new ApiError(
        `Wan2GP submit failed: HTTP ${response.status}`,
        'API',
        { provider: 'wan2gp' },
      );
    }

    try {
      const body = (await response.json()) as { data?: unknown[] };
      if (!Array.isArray(body.data)) {
        throw new ApiError(
          `Wan2GP returned no data array; is ${this.baseUrl} a Gradio endpoint?`,
          'API',
          { provider: 'wan2gp' },
        );
      }

      logger.info('wan2gp: job submitted', { jobId, baseUrl: this.baseUrl });

      return {
        jobId,
        provider: this.name,
        model: req.modelId,
        mode: req.mode,
        createdAt: new Date().toISOString(),
        providerNativeId: jobId,
      };
    } catch (err) {
      ledgerHooks?.onPostSubmitError(jobId, WAN2GP_RATE_USD, err);
      throw err;
    }
  }

  /**
   * Gradio's basic `/api/predict` is synchronous — it returns the result rather
   * than a job to poll. Reporting `completed` here reflects that honestly; a
   * fabricated queue would make callers wait for a transition that never comes.
   */
  async pollStatus(jobId: string): Promise<JobStatus> {
    return { jobId, state: 'completed', assetUrls: [] };
  }

  async download(pathOrUrl: string): Promise<DownloadedAsset> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}/file=${pathOrUrl}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new ApiError(
        `failed to download Wan2GP output from ${url}: HTTP ${response.status}`,
        'API',
        { provider: 'wan2gp' },
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

/** Gradio takes a positional array; order is the server's component order. */
export function buildGradioPayload(req: VideoGenerationRequest): unknown[] {
  return [req.prompt, req.durationSec, req.resolution, req.aspectRatio ?? '16:9'];
}

export interface Wan2gpRequirementCheck {
  readonly ok: boolean;
  readonly vramGb: number | null;
  readonly freeDiskGb: number | null;
  readonly warnings: string[];
}

/**
 * Reports what the machine has against what Wan2GP needs.
 *
 * Returns a report instead of throwing, and never blocks: detection is
 * best-effort and a false negative must not stop someone whose setup is fine.
 * `null` means "could not detect", which is deliberately distinct from "not
 * enough" — telling a user they lack VRAM when the probe simply failed sends
 * them to fix the wrong thing.
 */
export function checkWan2gpRequirements(probe: {
  readonly vramGb: number | null;
  readonly freeDiskGb: number | null;
}): Wan2gpRequirementCheck {
  const warnings: string[] = [];

  if (probe.vramGb === null) {
    warnings.push(
      `Could not detect GPU VRAM. Wan2GP needs at least ${WAN2GP_MIN_VRAM_GB} GB — verify ` +
        `before downloading weights.`,
    );
  } else if (probe.vramGb < WAN2GP_MIN_VRAM_GB) {
    warnings.push(
      `Detected ${probe.vramGb} GB VRAM, below the ${WAN2GP_MIN_VRAM_GB} GB minimum. ` +
        `Generation will likely fail or fall back to CPU and take hours.`,
    );
  }

  if (probe.freeDiskGb === null) {
    warnings.push(
      `Could not detect free disk space. Model weights need ${WAN2GP_MIN_DISK_GB}-` +
        `${WAN2GP_MAX_DISK_GB} GB depending on the model set.`,
    );
  } else if (probe.freeDiskGb < WAN2GP_MIN_DISK_GB) {
    warnings.push(
      `Only ${probe.freeDiskGb} GB free. Model weights need ${WAN2GP_MIN_DISK_GB}-` +
        `${WAN2GP_MAX_DISK_GB} GB. Free up space before starting the download — a ` +
        `part-downloaded weight set is not resumable in general and wastes the bandwidth.`,
    );
  }

  return {
    // ok reflects only what was actually measured. An undetectable machine is
    // reported as not-ok so the user is prompted to check rather than reassured
    // by a probe that told us nothing.
    ok: warnings.length === 0,
    vramGb: probe.vramGb,
    freeDiskGb: probe.freeDiskGb,
    warnings,
  };
}
