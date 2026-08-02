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
import { VIDEO_MODELS, type Provider, type VideoModelSpec } from '../../core/models.js';
import { usdPerCreditFor } from '../../core/higgsfield-pricing.js';
import { logger } from '../../core/logger.js';
import { ApiError, ValidationError } from '../../core/errors.js';
import { resolveCliBinary } from '../../utils/cli-binary.js';
import {
  recordRequestMapping,
  findRequestIdByJobId,
} from '../../core/provider-request-map.js';
import { recordJob } from '../../core/cost-tracker.js';
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
  /**
   * Where to persist the local-jobId -> CLI-jobId mapping.
   *
   * Required for pollStatus and download to work at all: `generate()` mints a
   * local id for the ledger and the CLI answers with its own, and
   * `higgsfield generate get` only knows the latter. Without somewhere to record
   * the pair, a caller holding our id can never ask about the job.
   *
   * Optional so the cost-only paths (`fetchCostCredits`, `estimateCostUSD`) and
   * the live rate gate keep working with no database at all.
   */
  readonly dbPath?: string;
}

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type CliRunner = (args: ReadonlyArray<string>, timeoutMs: number) => Promise<CliResult>;

/**
 * Refuses to spawn the real binary from inside a test run.
 *
 * ## Why this exists — it was paid for
 *
 * On 2026-08-01, repointing the Cinema Studio and Marketing Studio handlers onto
 * this transport made them call `higgsfieldCliProvider()`, whose runner spawns
 * the real `higgsfield` binary against the developer's logged-in OAuth session.
 * Two suites (higgsfield-billing-submit, video-ledger-no-double-reserve) invoked
 * those handlers with no runner stub, because until that moment those handlers
 * went over HTTP and a `global.fetch` stub was enough.
 *
 * The result was six REAL generations submitted by `pnpm test` and
 * **350 subscription credits spent**:
 *
 *   3× Marketing Studio Video       -120, -120, -50
 *   3× Cinematic Studio 3.5 Video    -20,  -20, -20
 *
 * Nothing failed. The CLI accepted every submit and the suite went green around
 * them, because a test that forgets to stub a transport does not look different
 * from one that does.
 *
 * ## What it does
 *
 * Under vitest, only reads are allowed through: `auth token`, `generate cost`,
 * `generate get|list`, `model`, `workflow`, `account`. Anything that can create
 * or bill — `generate create`, `generate workflow`, `soul-id create`, `upload` —
 * throws with the name of the test seam to use instead.
 *
 * The live gates are unaffected: they only ever run reads. A test that genuinely
 * needs a billed submit must say so with MEDIA_FORGE_ALLOW_REAL_CLI_IN_TESTS=true,
 * which is deliberately absent from .env.example.
 */
const CLI_READ_ONLY_VERBS: ReadonlyArray<string> = ['cost', 'get', 'list', 'status', 'token'];

function assertNotSpawningRealCliUnderTest(args: ReadonlyArray<string>): void {
  const underTest =
    process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
  if (!underTest) return;
  if (process.env['MEDIA_FORGE_ALLOW_REAL_CLI_IN_TESTS'] === 'true') return;

  // `--enhance-only` turns product-photoshoot / marketplace-cards `create` into
  // a read: the backend assembles and returns the prompts and no job is queued.
  // Recognising it here is what lets a preview be exercised in tests while the
  // same subcommand without the flag stays refused.
  if (args.includes('--enhance-only')) return;

  const isRead = args.some((a) => CLI_READ_ONLY_VERBS.includes(a));
  if (isRead) return;

  throw new ApiError(
    `refusing to spawn the real higgsfield CLI from a test: \`higgsfield ${args.join(' ')}\` ` +
      `can create a job and bill the logged-in account. ` +
      `Pass a fake runner — new HiggsfieldCliProvider({ runner }) — or install one with ` +
      `_setHiggsfieldCliProviderForTests(). This guard exists because a test suite once ` +
      `submitted six real generations and spent 350 credits.`,
    'API',
    { provider: 'higgsfield-cli' },
  );
}

/**
 * Runs the CLI with an ARGUMENT ARRAY and no shell.
 *
 * `shell: false` is the security property, not a default worth losing: a prompt
 * is arbitrary user text, and through a shell a prompt containing `; rm -rf ~`
 * or backticks would execute. With an argv array the prompt is one opaque
 * element no matter what it contains. Never rewrite this to build a command
 * string.
 *
 * Exported so the Soul-ID handlers can run through the SAME spawn path as
 * generation — including the Windows shim resolution, which is why they must not
 * grow a second runner of their own.
 */
export const defaultRunner: CliRunner = (args, timeoutMs) =>
  new Promise<CliResult>((resolve, reject) => {
    assertNotSpawningRealCliUnderTest(args);
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
 * Flags whose values are MEDIA — a UUID or a local path the CLI uploads.
 *
 * They repeat once per value. Every other array-typed parameter takes a JSON
 * array in a single flag instead; see the comment in buildCliArgs for the
 * measurement that separates them.
 *
 * The list is the one `higgsfield generate create --help` publishes, with both
 * the snake_case names `model get` reports and the kebab-case flags the binary
 * accepts, since a caller may reasonably pass either through cliParams.
 */
const MEDIA_FLAG_NAMES: ReadonlySet<string> = new Set([
  'image-references',
  'image_references',
  'video-references',
  'video_references',
  'audio-references',
  'audio_references',
  'image',
  'video',
  'audio',
]);

/**
 * Turns a generation request into CLI flags.
 *
 * Returned as an array of discrete elements, never joined. See defaultRunner.
 */
/**
 * Most job types take `--resolution`. kling3_0 takes `--mode std|pro|4k` and
 * rejects `--resolution` with `Unknown params: resolution`, so emitting the
 * default flag failed every request that named a resolution — cost estimate and
 * generation alike. The per-spec mapping lives on the spec because the job type,
 * not the transport, is what decides the parameter name.
 */
function pushResolutionFlag(
  args: string[],
  spec: VideoModelSpec,
  modelId: string,
  resolution: NonNullable<VideoGenerationRequest['resolution']>,
): void {
  const override = spec.cliResolutionParam;
  if (override === undefined) {
    args.push('--resolution', resolution);
    return;
  }
  const value = override.values[resolution];
  if (value === undefined) {
    throw new ValidationError(
      `${modelId} has no ${override.flag} value for resolution ${resolution}. ` +
        `Supported: ${Object.keys(override.values).join(', ')}.`,
    );
  }
  args.push(override.flag, value);
}

/**
 * Flags this transport derives from the request itself.
 *
 * Refused rather than silently overwritten when they arrive through cliParams —
 * a caller passing `duration` here would produce two `--duration` flags and let
 * the CLI decide which wins, defeating the cost estimate computed from the other
 * one.
 */
const RESERVED_CLI_PARAMS: ReadonlySet<string> = new Set([
  'prompt',
  'duration',
  'resolution',
  'aspect-ratio',
  'aspect_ratio',
  'start-image',
  'start_image',
  'end-image',
  'end_image',
  'image-references',
  'image_references',
]);

/**
 * Job-type-specific parameters, using the platform's own names.
 *
 * Marketing Studio and Cinematic Studio carry a dozen each (avatar_ids, hook_id,
 * camera_style, light_scheme …) that no shared VideoGenerationRequest field
 * could hold. They go through verbatim rather than through a typed field per job
 * type: the previous typed set (focal_length_mm, template, product_url …) was
 * invented for endpoints that answer 404 and drifted out of existence without
 * anything noticing. `higgsfield model get <job_type>` is the source, and the
 * MCP schema layer validates against the enums it reports.
 */
function pushCliParams(args: string[], cliParams: Readonly<Record<string, unknown>>): void {
  for (const [name, value] of Object.entries(cliParams)) {
    if (RESERVED_CLI_PARAMS.has(name)) {
      throw new ValidationError(
        `cliParams may not carry "${name}" — it is already derived from the request ` +
          `(prompt, durationSec, resolution, aspectRatio, frames, references).`,
      );
    }
    const flag = `--${name}`;
    if (!Array.isArray(value)) {
      args.push(flag, String(value));
      continue;
    }
    // Two kinds of array flag, and they take OPPOSITE forms. Measured against
    // the binary, not inferred from the schema — `model get` types both as
    // `array` and gives no hint which is which:
    //
    //   --avatar_ids '["id"]'                    ok
    //   --avatar_ids id1 --avatar_ids id2        Invalid types: avatar_ids
    //                                            should be array, got string
    //   --image-references id1 --image-references id2   ok
    //   --image-references '["id"]'              Media "[...]" is neither a
    //                                            UUID nor an existing file path
    //
    // Media flags resolve each value as a UUID or a path to upload, so a JSON
    // string is a filename to them. Everything else is a typed parameter that
    // wants the array itself. Getting this backwards fails at the CLI, after the
    // cost estimate has already been computed from the same argv — which is
    // exactly how it was found: `fetchCostCredits` rejected the submit shape
    // while every fake-runner test passed.
    if (MEDIA_FLAG_NAMES.has(name)) {
      for (const v of value) args.push(flag, String(v));
    } else {
      args.push(flag, JSON.stringify(value));
    }
  }
}

export function buildCliArgs(req: VideoGenerationRequest): string[] {
  const spec = VIDEO_MODELS[req.modelId];
  if (spec === undefined) {
    throw new ValidationError(`unknown modelId: ${req.modelId}`);
  }

  const args: string[] = [req.modelId, '--prompt', req.prompt];

  if (req.durationSec > 0) args.push('--duration', String(req.durationSec));
  if (req.resolution) pushResolutionFlag(args, spec, req.modelId, req.resolution);
  if (req.aspectRatio) args.push('--aspect-ratio', req.aspectRatio);

  // --start-image / --end-image are the CLI's first/last frame flags. Both
  // accept a local path and upload it, so no separate upload step is needed.
  if (req.firstFrameImagePath) args.push('--start-image', req.firstFrameImagePath);
  if (req.lastFrameImagePath) args.push('--end-image', req.lastFrameImagePath);

  // --image-references is repeatable; one flag per reference.
  for (const ref of req.referenceImagePaths ?? []) {
    args.push('--image-references', ref);
  }

  const extras = req.extras?.providerKind === 'higgsfield' ? req.extras : undefined;
  pushCliParams(args, extras?.cliParams ?? {});

  return args;
}

/**
 * Stable fingerprint of the parameters a job was submitted with.
 *
 * Hashes the ARGV rather than the request object: argv is what the platform
 * actually received, so two requests that differ only in a field this transport
 * drops hash the same — which is the truth the cost report should show.
 */
function hashCliParams(req: VideoGenerationRequest): string {
  const json = JSON.stringify(buildCliArgs(req));
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

export class HiggsfieldCliProvider implements VideoProvider {
  readonly name = 'higgsfield-cli' as Provider;
  readonly models = Object.values(VIDEO_MODELS).filter(
    (m) => m.provider === ('higgsfield-cli' as Provider),
  );

  private readonly runner: CliRunner;
  private readonly timeoutMs: number;
  private readonly dbPath: string | undefined;

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
    this.dbPath = opts.dbPath;
  }

  /**
   * Translates our job id into the one the CLI knows, or passes it through.
   *
   * Pass-through matters: a caller who already holds the CLI's id (from the
   * `providerNativeId` on the handle, or from `higgsfield generate list`) must
   * still be able to poll. A miss is therefore not an error here — the CLI
   * itself gives the better message if the id is genuinely unknown.
   */
  private resolveNativeJobId(jobId: string): string {
    if (this.dbPath === undefined) return jobId;
    return (
      findRequestIdByJobId({ dbPath: this.dbPath, jobId }) ?? jobId
    );
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
   * Runs an arbitrary CLI subcommand that only READS, and returns parsed JSON.
   *
   * The Marketing Studio catalogue, `product-photoshoot --enhance-only` and
   * `marketplace-cards --enhance-only` all sit outside the generate/cost/get
   * verbs this provider was built around, but they are the same transport and
   * must share its binary resolution, timeout and error translation rather than
   * grow a second spawn path.
   *
   * Split from `runWriteJson` on purpose. The name is the contract the
   * test-runner guard enforces: a caller reaching for the read method is stating
   * that nothing here can bill, and a submit routed through it would quietly
   * defeat the guard that exists because six real generations once escaped a
   * test run.
   */
  async runReadJson(args: ReadonlyArray<string>): Promise<unknown> {
    const result = await this.runner(args, COST_TIMEOUT_MS);
    if (result.exitCode !== 0) {
      throw new ApiError(
        `higgsfield ${args.slice(0, 3).join(' ')} failed (exit ${result.exitCode}): ` +
          result.stderr.slice(0, 400),
        'API',
        { provider: 'higgsfield-cli' },
      );
    }
    return parseJson<unknown>(result, 'a JSON response');
  }

  /** Same as runReadJson for a subcommand that CAN create or bill. */
  async runWriteJson(args: ReadonlyArray<string>): Promise<unknown> {
    const result = await this.runner(args, this.timeoutMs);
    if (result.exitCode !== 0) {
      throw new ApiError(
        `higgsfield ${args.slice(0, 3).join(' ')} failed (exit ${result.exitCode}): ` +
          result.stderr.slice(0, 400),
        'API',
        { provider: 'higgsfield-cli' },
      );
    }
    return parseJson<unknown>(result, 'a JSON response');
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

    // AFTER a successful submit, and only then: rows for a job that was never
    // accepted would make a phantom pollable and put a charge in the cost report
    // that no generation backs.
    //
    // `recordJob` was missing entirely on this transport. HiggsfieldProvider has
    // written it since P14, so a CLI generation reserved credit through the
    // ledger hooks and then left NOTHING for `media_video_cost_report` or the
    // settle path to find — the reservation could never be reconciled against a
    // job, because there was no job row.
    if (this.dbPath !== undefined) {
      recordJob({
        dbPath: this.dbPath,
        jobId,
        provider: this.name,
        model: req.modelId,
        mode: req.mode,
        paramsHash: hashCliParams(req),
        estUsd: estimateUsd,
      });
      recordRequestMapping({
        dbPath: this.dbPath,
        jobId,
        provider: this.name,
        providerRequestId: nativeId,
      });
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
   * `jobId` is OUR id; the CLI only knows its own.
   *
   * `generate()` mints a local id (`hfcli-<ts>-<rand>`) so the ledger has a
   * stable key from before the submit, and records the pair against the same
   * `provider-request-map` table HiggsfieldProvider uses. Passing our id
   * straight to `higgsfield generate get` would ask the CLI about a job it has
   * never heard of, so it is translated first.
   */
  async pollStatus(jobId: string): Promise<JobStatus> {
    const nativeId = this.resolveNativeJobId(jobId);
    const result = await this.runner(['generate', 'get', nativeId, '--json'], COST_TIMEOUT_MS);

    if (result.exitCode !== 0) {
      return {
        jobId,
        state: 'failed',
        errorMessage: `higgsfield generate get failed (exit ${result.exitCode}): ${result.stderr.slice(0, 300)}`,
      };
    }

    // The asset lives in `result_url`, not `results[].url`.
    //
    // Read off a real completed job on 2026-08-01. The whole payload is:
    //
    //   created_at · display_name · id · job_type · min_result_url ·
    //   params{…} · result_url · status · thumbnail_url
    //
    // There is no `results` array and no `error` field. The old parse returned
    // an empty `assetUrls` for every finished job, which made `download()` throw
    // "has no downloadable asset (state: completed)" — a contradiction that
    // could not surface until a job actually completed, and every test used a
    // fake runner returning a shape nobody had checked against the binary.
    //
    // `results[]` is kept as a fallback rather than deleted: it costs one line
    // and covers the CLI growing a multi-asset job type, which `min_result_url`
    // suggests is already half-modelled upstream.
    const parsed = parseJson<{
      status?: string;
      result_url?: string;
      min_result_url?: string;
      thumbnail_url?: string;
      results?: Array<{ url?: string }>;
      error?: string;
    }>(result, 'a job status');

    const assetUrls = [
      parsed.result_url,
      ...(parsed.results ?? []).map((r) => r.url),
    ].filter((u): u is string => typeof u === 'string' && u.length > 0);

    return {
      jobId,
      state: mapCliStatus(parsed.status),
      assetUrls,
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
 * Higgsfield CLI credit → USD.
 *
 * Uses the SUBSCRIPTION rate, not the API rate. This transport spends the
 * monthly plan bucket the OAuth login is attached to; the API top-up rate
 * (0.0625) prices a different balance and reports this transport's jobs 29.3%
 * high at a Pro plan. `usdPerCreditFor` resolves by provider — see the
 * two-pools note in core/higgsfield-pricing.ts.
 *
 * A missing rate THROWS rather than returning NaN, matching estimateCostUSD's
 * stance one screen up: a NaN reached `recordJob` and surfaced as
 * `NOT NULL constraint failed: video_jobs.est_usd`, which names the column
 * instead of the missing configuration. It is deliberately NOT filled in from
 * the API rate: the plan divisor is the operator's, not a public constant.
 */
export function creditsToUsd(credits: number): number {
  const rate = usdPerCreditFor('higgsfield-cli');
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ApiError(
      'MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT is unset or invalid, so this transport has ' +
        'no rate to price its credits with. It bills the monthly plan bucket, NOT the Cloud ' +
        'API top-up balance that MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT describes — reusing ' +
        'that rate reported every CLI job 29.3% above the invoice. Set it to your plan price ' +
        'divided by the plan credits (Pro: 29 / 600 = 0.0483333).',
      'API',
      { provider: 'higgsfield-cli' },
    );
  }
  return credits * rate;
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
