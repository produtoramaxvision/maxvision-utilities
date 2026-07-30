// src/image/codex-image.ts
// T17 — image generation through the Codex CLI.
//
// ## Two credential paths, because the deployment shapes genuinely differ
//
// Verified 2026-07-30 against `$CODEX_HOME/skills/.system/imagegen/SKILL.md` on
// codex-cli 0.146.0 — the skill's own words, not a docs cache:
//
//   "Default built-in tool mode (preferred): built-in `image_gen` tool for
//    normal image generation, editing, and simple transparent-image requests.
//    Does not require `OPENAI_API_KEY`."
//
//   "Fallback CLI mode: `scripts/image_gen.py` CLI. ... Requires
//    `OPENAI_API_KEY`."
//
// That maps exactly onto how this is meant to be deployed:
//
//   'builtin'  Local / personal. The user runs `codex login` once on their own
//              machine and image_gen rides that OAuth session. No API key, and
//              no per-image charge beyond the ChatGPT subscription they already
//              pay. This is why rate is 0 for this mode and only this mode.
//
//   'cli'      Multi-tenant / hosted. Uses OPENAI_API_KEY against
//              /v1/images/generations. Metered, real money, and therefore
//              REQUIRES a configured price -- see codexImageRateUsd().
//
// A correction worth recording, because it was reported wrongly once: an
// archived Codex session from 2026-02-06 shows the CLI-fallback line about
// OPENAI_API_KEY, and reading only that leads to the conclusion that image_gen
// always costs API money. It does not. Both modes are real and the skill
// document is explicit about which is which.
//
// ## The wire contract, verified for free
//
// `scripts/image_gen.py ... --dry-run` needs neither key nor network and prints
// the exact payload. Run on 2026-07-30 it returned:
//
//   { "endpoint": "/v1/images/generations", "model": "gpt-image-2", "n": 1,
//     "output_format": "png", "quality": "medium", "size": "1024x1024" }
//
// Note `quality` defaults to "medium". This adapter forces "high" and does not
// expose the lower tiers, per the plan: the point of adding a third image source
// is quality, and a cheaper-but-worse knob invites the router to pick it.
//
// ## Transparency is deliberately not supported
//
// The skill states gpt-image-2 does not support `background=transparent`, and
// that true transparency requires CLI `gpt-image-1.5`. The user excluded
// gpt-image-1.5. The documented workaround -- generate on chroma key and strip
// it with a script -- is a workaround, not quality. When alpha is actually
// needed the route is Nano Banana Pro or Imagen 4 Ultra, which are already in
// this plugin and do it natively. One provider per need beats forcing one to do
// what it does badly.

import { spawn } from 'node:child_process';
import { ApiError, ValidationError } from '../core/errors.js';
import { logger } from '../core/logger.js';

/** The only model this adapter uses. gpt-image-1.5 is excluded by decision. */
export const CODEX_IMAGE_MODEL = 'gpt-image-2';

/** Forced. Lower tiers are not exposed — see the header. */
export const CODEX_IMAGE_QUALITY = 'high';

export const CODEX_IMAGE_SIZES = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x1152',
  '3840x2160',
  '2160x3840',
] as const;

export type CodexImageSize = (typeof CODEX_IMAGE_SIZES)[number];

export type CodexImageMode = 'builtin' | 'cli';

export interface CodexImageOptions {
  readonly runner?: CliRunner;
  readonly timeoutMs?: number;
  readonly codexHome?: string;
}

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type CliRunner = (
  bin: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
) => Promise<CliResult>;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Chooses the credential path.
 *
 * Explicit override first, then presence of OPENAI_API_KEY, then builtin. The
 * ordering matters: a hosted deployment sets the key, and defaulting to builtin
 * there would try to use an OAuth session that belongs to whoever built the
 * container -- one operator's login silently serving every tenant.
 */
export function resolveCodexImageMode(env: NodeJS.ProcessEnv = process.env): CodexImageMode {
  const explicit = env['MEDIA_FORGE_CODEX_IMAGE_MODE'];
  if (explicit === 'builtin' || explicit === 'cli') return explicit;
  return env['OPENAI_API_KEY'] ? 'cli' : 'builtin';
}

/** Default true for local use, per the plan. Hosted installs turn it off. */
export function isCodexImageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['MEDIA_FORGE_CODEX_IMAGE_ENABLED'] !== 'false';
}

/**
 * USD per image.
 *
 * `builtin` is 0: the ChatGPT subscription is already paid and there is no
 * per-image charge to attribute.
 *
 * `cli` bills the OpenAI Images API and this repo has no verified rate for it.
 * Rather than invent one, the rate must be configured; an unset rate throws.
 * A fabricated price would pass the cost guard and land in the ledger looking
 * authoritative, which is worse than refusing — the same discipline used for
 * the Higgsfield CLI estimate.
 */
export function codexImageRateUsd(
  mode: CodexImageMode,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (mode === 'builtin') return 0;

  const raw = env['MEDIA_FORGE_CODEX_IMAGE_USD_PER_IMAGE'];
  const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(
      'MEDIA_FORGE_CODEX_IMAGE_USD_PER_IMAGE must be set when Codex image generation runs ' +
        'in "cli" mode, because that path bills the OpenAI Images API per image. This repo ' +
        'has no verified rate for it, and guessing one would put a made-up number through ' +
        'the cost guard and into the ledger. Read the current price from OpenAI and set it. ' +
        'The "builtin" mode (local `codex login`, no API key) is free and needs no rate.',
    );
  }
  return parsed;
}

/**
 * Refuses the OAuth path in a multi-tenant deployment.
 *
 * The built-in tool authenticates as whoever ran `codex login` on the machine.
 * In hosted mode that is the operator, so every tenant's image would be
 * generated on — and attributed to — one personal account. This is the T5-guard
 * reasoning applied to the same class of problem: not an incompatibility to
 * engineer around, a declared scope boundary.
 */
export function assertModeAllowed(mode: CodexImageMode, isMultiTenant: boolean): void {
  if (mode === 'builtin' && isMultiTenant) {
    throw new ValidationError(
      'Codex built-in image_gen cannot serve a multi-tenant deployment: it authenticates as ' +
        'the single OAuth session created by `codex login` on this machine, so every ' +
        "tenant's generation would run on the operator's personal ChatGPT account. Set " +
        'OPENAI_API_KEY and MEDIA_FORGE_CODEX_IMAGE_MODE=cli, or disable the provider with ' +
        'MEDIA_FORGE_CODEX_IMAGE_ENABLED=false.',
    );
  }
}

const defaultRunner: CliRunner = (bin, args, timeoutMs) =>
  new Promise<CliResult>((resolve, reject) => {
    // shell:false with an argv array. A prompt is arbitrary user text; through a
    // shell, `; rm -rf ~` or $(...) inside it would execute. Same invariant as
    // the Higgsfield CLI adapter — never build a command string here.
    const child = spawn(bin, [...args], { shell: false, windowsHide: true });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new ApiError(
          `codex image generation timed out after ${Math.round(timeoutMs / 1000)}s`,
          'API',
          { provider: 'codex-image' },
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
            `"${bin}" is not on PATH. Codex image generation needs the Codex CLI installed ` +
              `and \`codex login\` completed, or set MEDIA_FORGE_CODEX_IMAGE_ENABLED=false.`,
            'API',
            { provider: 'codex-image' },
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

export interface CodexImageRequest {
  readonly prompt: string;
  readonly size?: CodexImageSize;
  /** Directory the final image must end up in. */
  readonly outputDir: string;
  readonly fileName?: string;
  readonly referenceImagePaths?: ReadonlyArray<string>;
}

/**
 * Builds the argv for the CLI (multi-tenant) path.
 *
 * Quality is pinned to high and never taken from the request — see the header.
 */
export function buildCliArgs(req: CodexImageRequest, scriptPath: string): string[] {
  const out = `${req.outputDir}/${req.fileName ?? 'image.png'}`;
  const args = [
    scriptPath,
    'generate',
    '--prompt',
    req.prompt,
    '--size',
    req.size ?? '1024x1024',
    '--quality',
    CODEX_IMAGE_QUALITY,
    '--model',
    CODEX_IMAGE_MODEL,
    '--out',
    out,
  ];
  return args;
}

/**
 * Builds the argv for the built-in (local OAuth) path.
 *
 * The built-in tool has no destination argument — the skill is explicit: "Do not
 * describe or rely on a destination-path argument (if any) on the built-in
 * `image_gen` tool", and images land under `$CODEX_HOME/generated_images/`. So
 * the instruction asks Codex to generate and then move the result, and the
 * sandbox is `workspace-write` scoped to the output directory, because
 * `read-only` cannot write the file at all.
 */
export function buildBuiltinArgs(req: CodexImageRequest): string[] {
  const instruction = [
    `Use the built-in image_gen tool to generate exactly one image.`,
    `Quality: ${CODEX_IMAGE_QUALITY}. Size: ${req.size ?? '1024x1024'}.`,
    `Prompt: ${req.prompt}`,
    ``,
    `Then move the generated file into the current working directory as`,
    `"${req.fileName ?? 'image.png'}". Reply with only the final absolute path.`,
    `Do not generate more than one image. Do not use the CLI fallback.`,
  ].join('\n');

  return [
    'exec',
    '--skip-git-repo-check',
    '-s',
    'workspace-write',
    '-C',
    req.outputDir,
    instruction,
  ];
}

export class CodexImageProvider {
  private readonly runner: CliRunner;
  private readonly timeoutMs: number;
  private readonly codexHome: string;

  constructor(opts: CodexImageOptions = {}) {
    this.runner = opts.runner ?? defaultRunner;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.codexHome =
      opts.codexHome ?? process.env['CODEX_HOME'] ?? `${process.env['HOME'] ?? '~'}/.codex`;
  }

  /** Path to the fallback CLI, per the skill's documented location. */
  cliScriptPath(): string {
    return `${this.codexHome}/skills/.system/imagegen/scripts/image_gen.py`;
  }

  estimateCostUSD(mode: CodexImageMode = resolveCodexImageMode()): number {
    return codexImageRateUsd(mode);
  }

  /**
   * Generates one image and returns its path.
   *
   * The reply is parsed for a path rather than assumed: the built-in path runs
   * an AGENT, not an endpoint, so its output is prose. Failing loudly when no
   * path is found is the plan's own requirement -- "falha alto quando o formato
   * não vier como esperado; nunca infere sucesso".
   */
  async generate(
    req: CodexImageRequest,
    opts: { readonly mode?: CodexImageMode; readonly isMultiTenant?: boolean } = {},
  ): Promise<{ path: string; mode: CodexImageMode; estimateUsd: number }> {
    if (!isCodexImageEnabled()) {
      throw new ValidationError(
        'Codex image generation is disabled (MEDIA_FORGE_CODEX_IMAGE_ENABLED=false).',
      );
    }

    const mode = opts.mode ?? resolveCodexImageMode();
    assertModeAllowed(mode, opts.isMultiTenant ?? false);

    // Priced before the call so an unset cli rate fails before spending.
    const estimateUsd = codexImageRateUsd(mode);

    const result =
      mode === 'cli'
        ? await this.runner('python', buildCliArgs(req, this.cliScriptPath()), this.timeoutMs)
        : await this.runner('codex', buildBuiltinArgs(req), this.timeoutMs);

    if (result.exitCode !== 0) {
      throw new ApiError(
        `codex image generation failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`,
        'API',
        { provider: 'codex-image', mode },
      );
    }

    const path = extractImagePath(result.stdout, req.fileName ?? 'image.png');
    if (path === undefined) {
      throw new ApiError(
        `codex image generation reported success but no output path could be found in its ` +
          `reply. Never inferring success here is deliberate: the built-in path runs an agent, ` +
          `so a confident-sounding reply with no file is a real outcome. stdout: ` +
          `${result.stdout.slice(0, 400)}`,
        'API',
        { provider: 'codex-image', mode },
      );
    }

    logger.info('codex-image: generated', { mode, path, estimateUsd });
    return { path, mode, estimateUsd };
  }
}

/**
 * Pulls an image path out of agent prose.
 *
 * Returns undefined rather than a best guess. A wrong path here surfaces later
 * as a missing file with no explanation, whereas undefined produces an error
 * that quotes what the agent actually said.
 */
export function extractImagePath(stdout: string, fileName: string): string | undefined {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Prefer a line that names the file we asked for.
  for (const line of [...lines].reverse()) {
    if (line.includes(fileName)) {
      const match = line.match(/[A-Za-z]:[\\/][^\s"']+|\/[^\s"']+/);
      if (match) return match[0];
      if (line === fileName) return line;
    }
  }

  // Otherwise any path ending in an image extension.
  for (const line of [...lines].reverse()) {
    const match = line.match(/[A-Za-z]:[\\/][^\s"']+\.(png|jpg|jpeg|webp)|\/[^\s"']+\.(png|jpg|jpeg|webp)/i);
    if (match) return match[0];
  }

  return undefined;
}
