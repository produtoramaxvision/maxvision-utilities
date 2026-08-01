// src/video/providers/higgsfield-cli.ts
// T5 — Higgsfield through the official CLI instead of the HTTP API.
//
// ## Why a second Higgsfield transport exists
//
// The API-key adapter in higgsfield.ts bills against API credits. The CLI
// authenticates as the logged-in user, which is the only route that can touch a
// subscription workspace. They are different billing surfaces to the same
// provider, so they are different providers here rather than a mode flag —
// PROVIDERS is what the router and the cost report key on, and collapsing two
// billing surfaces into one entry makes spend unattributable.
//
// ## Every interface fact below was read off the installed binary
//
// Verified against `higgsfield 1.1.20` on 2026-07-30 by running `--help` on each
// subcommand, NOT from documentation or a cached snapshot. That matters: the
// plan for this task was written against docs and got `--wait` right, but the
// authority for a CLI surface is the binary, and a docs cache already served a
// stale Kling snapshot once during this refresh.
//
// Subcommands used here, all invoked with --json:
//
//   higgsfield generate cost   <job_type> [--param value]... --json  -> {"credits": N}
//   higgsfield generate create <job_type> [--param value]... --json
//   higgsfield generate get    <job_id> --json
//   higgsfield auth token --json
//
// `generate create` also accepts --wait / --wait-timeout / --wait-interval to
// block until the render finishes. Unused here: this provider submits and
// returns, and completion is tracked by the same polling path every other
// provider uses.
//
// Media flags: --image-references, --video-references, --audio-references,
// --start-image, --end-image (aliases --image, --video, --audio). They accept a
// UUID or a local path; paths are auto-uploaded by the CLI.
//
// ## Disabled by default
//
// MEDIA_FORGE_HF_CLI_ENABLED gates registration. The CLI holds a single OAuth
// session per machine, so it cannot serve a multi-tenant hosted deployment —
// every tenant's job would bill the maintainer's account. Opt-in only, and the
// hosted path must never enable it.

import { spawn } from 'node:child_process';
import { VIDEO_MODELS, type Provider } from '../../core/models.js';
import { USD_PER_CREDIT } from '../../core/higgsfield-pricing.js';
import { logger } from '../../core/logger.js';
import { ApiError, ValidationError } from '../../core/errors.js';
import { resolveCliBinary } from '../../utils/cli-binary.js';
import type {
  DownloadedAsset,
  JobHandle,
  JobStatus,
  VideoGenerationRequest,
  VideoLedgerHooks,
  VideoProvider,
} from './base.js';

/** The binary name. Resolved off PATH; never a shell string. */
const HF_BIN = 'higgsfield';

/**
 * Opt-in gate. Default FALSE.
 *
 * Read at call time rather than captured at import so a test, or a hosted
 * deployment turning it off, is not fighting a value frozen at module load.
 *
 * Only the exact string 'true' enables it. A permissive parse ('1', 'yes') would
 * make it easier to switch on by accident, and switching this on in a hosted
 * deployment routes every tenant's work through one machine's OAuth session.
 */
export function isHiggsfieldCliEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['MEDIA_FORGE_HF_CLI_ENABLED'] === 'true';
}

/**
 * Default ceiling on a submit.
 *
 * This provider deliberately does NOT pass `--wait`: it submits, returns a
 * JobHandle, and lets the existing polling machinery track completion, the same
 * shape every other provider here uses. So the submit is a single API round trip
 * and does not need a render-length timeout.
 *
 * Three minutes rather than the sixty seconds used for pure reads, because a
 * create call may auto-upload local reference images first, and an upload on a
 * slow link legitimately takes longer than a status query. Killing the child
 * mid-upload is safe — nothing has been charged yet — but killing it after the
 * job is accepted would orphan a charge with no local record, so the margin errs
 * generous.
 *
 * (`--wait`, `--wait-timeout` and `--wait-interval` do exist on the binary and
 * would be the route to a blocking submit; they are unused here by choice.)
 */
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

/** Cost estimates are a single API round trip; they must not inherit the render timeout. */
const COST_TIMEOUT_MS = 60 * 1000;

export interface HiggsfieldCliOptions {
  /** Test seam. Defaults to the real spawn-based runner. */
  readonly runner?: CliRunner;
  readonly timeoutMs?: number;
}

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type CliRunner = (args: ReadonlyArray<string>, timeoutMs: number) => Promise<CliResult>;

/**
 * Runs the CLI with an ARGUMENT ARRAY and no shell.
 *
 * `shell: false` is the security property, not a default worth losing: a prompt
 * is arbitrary user text, and through a shell a prompt containing `; rm -rf ~`
 * or backticks would execute. With an argv array the prompt is one opaque
 * element no matter what it contains. Never rewrite this to build a command
 * string.
 */
const defaultRunner: CliRunner = (args, timeoutMs) =>
  new Promise<CliResult>((resolve, reject) => {
    // Same Windows resolution as the Codex adapter, and for the same reason: the
    // Higgsfield CLI installs as a .CMD/sh shim here, which Node refuses to spawn
    // without a shell. shell:false and the argv array are preserved.
    const resolved = resolveCliBinary(HF_BIN, { overrideEnvVar: 'MEDIA_FORGE_HF_BIN' });
    const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
      shell: false,
      windowsHide: true,
      // stdin closed for the same reason as the Codex adapter: nothing here
      // feeds the child input, and a CLI that decides to read stdin when it is
      // a non-TTY pipe would hang until the timeout instead of failing.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new ApiError(
          `higgsfield CLI timed out after ${Math.round(timeoutMs / 1000)}s. If this was a ` +
            `render, the job may still be running and billing on Higgsfield's side — check ` +
            `\`higgsfield generate list\` before retrying so you do not pay twice.`,
          'API',
          { provider: 'higgsfield-cli' },
        ),
      );
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(
          new ApiError(
            `the "higgsfield" CLI is not on PATH. Install it and run \`higgsfield auth login\`, ` +
              `or unset MEDIA_FORGE_HF_CLI_ENABLED to use the API-key adapter instead.`,
            'API',
            { provider: 'higgsfield-cli' },
          ),
        );
        return;
      }
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });

/** Parses `--json` output, failing with the raw text rather than a bare SyntaxError. */
function parseJson<T>(result: CliResult, what: string): T {
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new ApiError(
      `could not parse ${what} from the higgsfield CLI. ` +
        `stdout: ${result.stdout.slice(0, 400)} stderr: ${result.stderr.slice(0, 400)}`,
      'API',
      { provider: 'higgsfield-cli' },
    );
  }
}

/**
 * Turns a generation request into CLI flags.
 *
 * Returned as an array of discrete elements, never joined. See defaultRunner.
 */
export function buildCliArgs(req: VideoGenerationRequest): string[] {
  const spec = VIDEO_MODELS[req.modelId];
  if (spec === undefined) {
    throw new ValidationError(`unknown modelId: ${req.modelId}`);
  }

  const args: string[] = [req.modelId, '--prompt', req.prompt];

  if (req.durationSec > 0) args.push('--duration', String(req.durationSec));

  // Most job types take `--resolution`. kling3_0 takes `--mode std|pro|4k` and
  // rejects `--resolution` with `Unknown params: resolution`, so emitting the
  // default flag failed every request that named a resolution — cost estimate
  // and generation alike. The per-spec mapping lives on the spec because the
  // job type, not the transport, is what decides the parameter name.
  if (req.resolution) {
    const override = spec.cliResolutionParam;
    if (override === undefined) {
      args.push('--resolution', req.resolution);
    } else {
      const value = override.values[req.resolution];
      if (value === undefined) {
        throw new ValidationError(
          `${req.modelId} has no ${override.flag} value for resolution ${req.resolution}. ` +
            `Supported: ${Object.keys(override.values).join(', ')}.`,
        );
      }
      args.push(override.flag, value);
    }
  }

  if (req.aspectRatio) args.push('--aspect-ratio', req.aspectRatio);

  // --start-image / --end-image are the CLI's first/last frame flags. Both
  // accept a local path and upload it, so no separate upload step is needed.
  if (req.firstFrameImagePath) args.push('--start-image', req.firstFrameImagePath);
  if (req.lastFrameImagePath) args.push('--end-image', req.lastFrameImagePath);

  // --image-references is repeatable; one flag per reference.
  for (const ref of req.referenceImagePaths ?? []) {
    args.push('--image-references', ref);
  }

  return args;
}

export class HiggsfieldCliProvider implements VideoProvider {
  readonly name = 'higgsfield-cli' as Provider;
  readonly models = Object.values(VIDEO_MODELS).filter(
    (m) => m.provider === ('higgsfield-cli' as Provider),
  );

  private readonly runner: CliRunner;
  private readonly timeoutMs: number;

  /**
   * Cached credit estimates keyed by the exact argv used to obtain them.
   *
   * estimateCostUSD is synchronous by the VideoProvider contract, but the only
   * authoritative price comes from an async CLI round trip. Rather than invent a
   * local price table that would drift from Higgsfield's, a caller runs
   * `fetchCostCredits` first and the synchronous method reads the cached answer.
   * A miss is loud (see estimateCostUSD) instead of silently returning a guess
   * that the cost guard would then enforce against.
   */
  private readonly costCache = new Map<string, number>();

  constructor(opts: HiggsfieldCliOptions = {}) {
    this.runner = opts.runner ?? defaultRunner;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Confirms the binary exists AND holds a session, before anything is spent.
   *
   * Both are checked because they fail differently and the remedies differ: a
   * missing binary needs an install, an expired session needs a login. A single
   * "higgsfield unavailable" message would send the user down the wrong path
   * half the time.
   */
  async preflight(): Promise<void> {
    let result: CliResult;
    try {
      result = await this.runner(['auth', 'token', '--json'], COST_TIMEOUT_MS);
    } catch (err) {
      // ENOENT is already translated into an actionable ProviderError by the
      // runner; anything else propagates as-is.
      throw err;
    }

    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      throw new ApiError(
        `higgsfield CLI is installed but has no valid session. Run \`higgsfield auth login\`. ` +
          `(exit ${result.exitCode}${result.stderr.trim() ? `: ${result.stderr.trim().slice(0, 200)}` : ''})`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }
  }

  /**
   * Asks the CLI what a job would cost. A READ — creates nothing and spends nothing.
   *
   * This is the whole reason the CLI provider can be trusted with a cost guard:
   * the price is Higgsfield's own answer for these exact parameters, not a rate
   * table in this repo that goes stale silently.
   */
  async fetchCostCredits(req: VideoGenerationRequest): Promise<number> {
    const args = ['generate', 'cost', ...buildCliArgs(req), '--json'];
    const result = await this.runner(args, COST_TIMEOUT_MS);

    if (result.exitCode !== 0) {
      throw new ApiError(
        `higgsfield generate cost failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }

    const parsed = parseJson<{ credits?: number }>(result, 'a cost estimate');
    if (typeof parsed.credits !== 'number' || !Number.isFinite(parsed.credits)) {
      throw new ApiError(
        `higgsfield generate cost returned no usable "credits" field: ${result.stdout.slice(0, 200)}`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }

    this.costCache.set(cacheKey(req), parsed.credits);
    return parsed.credits;
  }

  /**
   * Synchronous per the VideoProvider contract, reading the cached CLI answer.
   *
   * Throws on a miss rather than guessing. A fabricated estimate here would be
   * enforced by the cost guard and recorded in the ledger as if it were real,
   * which is worse than an explicit failure telling the caller to fetch first.
   */
  estimateCostUSD(req: VideoGenerationRequest): number {
    const credits = this.costCache.get(cacheKey(req));
    if (credits === undefined) {
      throw new ApiError(
        `no cost estimate cached for ${req.modelId}. Call fetchCostCredits() first — the ` +
          `higgsfield CLI is the only authority on this price, and guessing it would put a ` +
          `made-up number through the cost guard and into the ledger.`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }
    return creditsToUsd(credits);
  }

  async generate(
    req: VideoGenerationRequest,
    ledgerHooks?: VideoLedgerHooks,
  ): Promise<JobHandle> {
    await this.preflight();

    // Price first: the guard and the reservation both need a real number, and
    // this call spends nothing.
    const credits = await this.fetchCostCredits(req);
    const estimateUsd = creditsToUsd(credits);

    const jobId = `hfcli-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    // Reserve BEFORE submit (C8/A5). May throw to block the call.
    await ledgerHooks?.beforeSubmit(jobId, estimateUsd);

    let result: CliResult;
    try {
      result = await this.runner(
        ['generate', 'create', ...buildCliArgs(req), '--json'],
        this.timeoutMs,
      );
    } catch (err) {
      // The submit never landed — release what beforeSubmit reserved.
      await ledgerHooks?.onSubmitFailed(jobId, estimateUsd);
      throw err;
    }

    if (result.exitCode !== 0) {
      await ledgerHooks?.onSubmitFailed(jobId, estimateUsd);
      throw new ApiError(
        `higgsfield generate create failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }

    let nativeId: string | undefined;
    try {
      const parsed = parseJson<{ id?: string; job_id?: string }>(result, 'a job id');
      nativeId = parsed.id ?? parsed.job_id;
      if (nativeId === undefined) {
        // The CLI exited 0, so the job was very likely accepted and is now
        // billing. Releasing the reservation here would let a running
        // generation complete for free, so this takes the post-submit path.
        throw new ApiError(
          `higgsfield generate create returned no job id: ${result.stdout.slice(0, 200)}`,
          'API',
          { provider: 'higgsfield-cli' },
        );
      }
    } catch (err) {
      ledgerHooks?.onPostSubmitError(jobId, estimateUsd, err);
      throw err;
    }

    logger.info('higgsfield-cli: job submitted', { jobId, nativeId, credits });

    return {
      jobId,
      provider: this.name,
      model: req.modelId,
      mode: req.mode,
      createdAt: new Date().toISOString(),
      providerNativeId: nativeId,
    };
  }

  /**
   * KNOWN GAP — `jobId` here must be the CLI's OWN job id, not ours.
   *
   * `generate()` mints a local id (`hfcli-<ts>-<rand>`) for the ledger and
   * returns the CLI's id separately as `providerNativeId`. `higgsfield generate
   * get` only knows the latter, so passing the local id back into this method
   * asks the CLI about a job it has never heard of.
   *
   * HiggsfieldProvider solves this with `recordRequestMapping` (local id ->
   * request_id, persisted); this transport has no equivalent, so the mapping has
   * to be held by the caller. Written down rather than papered over: there is no
   * MCP tool wired to this provider yet, so no caller is getting it wrong today,
   * and inventing a mapping table here without the tool that needs it would be
   * guessing at its shape.
   */
  async pollStatus(jobId: string): Promise<JobStatus> {
    const result = await this.runner(['generate', 'get', jobId, '--json'], COST_TIMEOUT_MS);

    if (result.exitCode !== 0) {
      return {
        jobId,
        state: 'failed',
        errorMessage: `higgsfield generate get failed (exit ${result.exitCode}): ${result.stderr.slice(0, 300)}`,
      };
    }

    const parsed = parseJson<{
      status?: string;
      results?: Array<{ url?: string }>;
      error?: string;
    }>(result, 'a job status');

    return {
      jobId,
      state: mapCliStatus(parsed.status),
      assetUrls: (parsed.results ?? []).map((r) => r.url).filter((u): u is string => !!u),
      ...(parsed.error !== undefined ? { errorMessage: parsed.error } : {}),
    };
  }

  async download(jobId: string): Promise<DownloadedAsset> {
    const status = await this.pollStatus(jobId);
    const url = status.assetUrls?.[0];
    if (url === undefined) {
      throw new ApiError(
        `higgsfield-cli job ${jobId} has no downloadable asset (state: ${status.state})`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new ApiError(
        `failed to download higgsfield-cli asset for ${jobId}: HTTP ${response.status}`,
        'API',
        { provider: 'higgsfield-cli' },
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      metadata: {
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        sizeBytes: buffer.byteLength,
        cdnUrl: url,
      },
    };
  }

  /**
   * Settlement is a no-op here, deliberately.
   *
   * The authoritative charge is whatever Higgsfield deducted, and the CLI
   * exposes it through `higgsfield account`. Wiring that is real work with a
   * real reconciliation question attached, so rather than record a derived
   * number that would look authoritative and be wrong, this records nothing and
   * says so. Filed in TODOS.md alongside the equivalent Kling deduction-API gap.
   */
  // recordActualCostUSD is DELIBERATELY ABSENT.
  //
  // It used to exist here with a body that logged "is a documented no-op" and
  // did nothing else. `VideoProvider` now declares the method optional, so not
  // declaring it is the accurate statement: this transport bills the logged-in
  // workspace in Higgsfield credits and never learns a USD figure it could
  // settle with. A method that accepts a settlement and discards it looks
  // identical, from the interface, to one that records it.
}

/** Stable key over the fields that affect price. */
function cacheKey(req: VideoGenerationRequest): string {
  return JSON.stringify([
    req.modelId,
    req.mode,
    req.durationSec,
    req.resolution,
    req.aspectRatio ?? null,
    (req.referenceImagePaths ?? []).length,
  ]);
}

/**
 * Higgsfield credit → USD.
 *
 * Reuses the single conversion already defined for the API adapter rather than
 * introducing a second constant: two rates for one provider's credit is how the
 * cost report starts disagreeing with the invoice.
 */
export function creditsToUsd(credits: number): number {
  // USD_PER_CREDIT is a boot-validated binding that is NaN until validation
  // runs, so it is read at call time rather than captured at module load. A NaN
  // rate must surface as NaN here and fail the guard loudly — silently
  // substituting a fallback would price the job at a number nobody configured.
  return credits * USD_PER_CREDIT;
}

/**
 * Maps the CLI's status strings onto the repo's JobState union.
 *
 * The default is `in_progress`, not `failed`: an unrecognised status most likely
 * means Higgsfield added a state this build has not seen, and treating that as
 * failure would abandon a job that is actually running and already billing.
 */
function mapCliStatus(status: string | undefined): JobStatus['state'] {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'nsfw':
    case 'content_moderated':
      return 'nsfw';
    case 'queued':
    case 'pending':
      return 'pending';
    default:
      return 'in_progress';
  }
}
