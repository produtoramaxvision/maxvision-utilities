import type { Command } from 'commander';
import { addCommonFlags, exitOk, exitErr } from '../shared.js';
import { createClient } from '../../core/client.js';
import { loadConfig } from '../../core/config.js';
import {
  generateVideoT2V,
  generateVideoI2V,
  generateVideoInterpolate,
  generateVideoWithRefs,
  extendVideo,
  pollVideoOperation,
  downloadVideo,
} from '../../video/video-service.js';
import { estimateVideoCost } from '../../core/cost.js';
import {
  GenerateVideoT2VInput,
  GenerateVideoI2VInput,
  GenerateVideoInterpolateInput,
  GenerateVideoWithRefsInput,
} from '../../video/video-schemas.js';
import { VIDEO_MODEL_VEO_3_1_PRO } from '../../core/models.js';
import { ValidationError } from '../../core/errors.js';

// ---------------------------------------------------------------------------
// CLI flag types (exported for testing)
// ---------------------------------------------------------------------------

export interface T2VOpts {
  aspectRatio?: string;
  durationSeconds?: string;
  resolution?: string;
  generateAudio?: boolean;
  personGeneration?: string;
  seed?: string;
  negativePrompt?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface I2VOpts {
  image?: string;
  aspectRatio?: string;
  durationSeconds?: string;
  resolution?: string;
  generateAudio?: boolean;
  seed?: string;
  negativePrompt?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface InterpolateOpts {
  first?: string;
  last?: string;
  aspectRatio?: string;
  durationSeconds?: string;
  resolution?: string;
  generateAudio?: boolean;
  seed?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface RefsOpts {
  ref?: string[];
  aspectRatio?: string;
  durationSeconds?: string;
  resolution?: string;
  generateAudio?: boolean;
  seed?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface ExtendOpts {
  sourceUri?: string;
  hopIndex?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface PollOpts {
  intervalMs?: string;
  timeoutMs?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
  outputDir?: string;
}

export interface DownloadOpts {
  outputDir?: string;
  filename?: string;
  bg?: boolean;
  dryRun?: boolean;
  json?: boolean;
  estimateCost?: boolean;
  strict?: boolean;
}

// ---------------------------------------------------------------------------
// Input builders (exported for testing)
// ---------------------------------------------------------------------------

export function buildT2VInput(prompt: string, opts: T2VOpts) {
  return GenerateVideoT2VInput.parse({
    op: 't2v',
    prompt,
    aspectRatio: opts.aspectRatio ?? '16:9',
    durationSeconds: opts.durationSeconds !== undefined ? parseInt(opts.durationSeconds, 10) : 8,
    resolution: opts.resolution ?? '720p',
    generateAudio: opts.generateAudio ?? true,
    personGeneration: opts.personGeneration ?? 'allow_all',
    seed: opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined,
    negativePrompt: opts.negativePrompt,
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildI2VInput(prompt: string, opts: I2VOpts) {
  return GenerateVideoI2VInput.parse({
    op: 'i2v',
    prompt,
    firstFrameImage: opts.image ?? '',
    aspectRatio: opts.aspectRatio ?? '16:9',
    durationSeconds: opts.durationSeconds !== undefined ? parseInt(opts.durationSeconds, 10) : 8,
    resolution: opts.resolution ?? '720p',
    generateAudio: opts.generateAudio ?? true,
    personGeneration: 'allow_adult',
    seed: opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined,
    negativePrompt: opts.negativePrompt,
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildInterpolateInput(prompt: string, opts: InterpolateOpts) {
  return GenerateVideoInterpolateInput.parse({
    op: 'interpolate',
    prompt,
    firstFrameImage: opts.first ?? '',
    lastFrameImage: opts.last ?? '',
    aspectRatio: opts.aspectRatio ?? '16:9',
    durationSeconds: opts.durationSeconds !== undefined ? parseInt(opts.durationSeconds, 10) : 8,
    resolution: opts.resolution ?? '720p',
    generateAudio: opts.generateAudio ?? true,
    personGeneration: 'allow_adult',
    seed: opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined,
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

export function buildRefsInput(prompt: string, opts: RefsOpts) {
  const refs = (opts.ref ?? []).map((p) => ({ path: p, referenceType: 'ASSET' as const }));
  return GenerateVideoWithRefsInput.parse({
    op: 'with-refs',
    prompt,
    referenceImages: refs,
    aspectRatio: opts.aspectRatio ?? '16:9',
    durationSeconds: opts.durationSeconds !== undefined ? parseInt(opts.durationSeconds, 10) : 8,
    resolution: opts.resolution ?? '720p',
    generateAudio: opts.generateAudio ?? true,
    personGeneration: 'allow_adult',
    seed: opts.seed !== undefined ? parseInt(opts.seed, 10) : undefined,
    outputDir: opts.outputDir ?? './outputs',
    dryRun: opts.dryRun ?? false,
  });
}

// ---------------------------------------------------------------------------
// --bg helper
// ---------------------------------------------------------------------------

async function handleBg(argv: string[]): Promise<boolean> {
  const sessionId = process.env['CLAUDE_CODE_SESSION_ID'];
  if (!sessionId) {
    process.stderr.write(
      'warning: --bg requires Claude Code session; running synchronously\n',
    );
    return false;
  }

  try {
    const { spawnSync, spawn } = await import('node:child_process');
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(which, ['claude'], { encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(
        'warning: claude binary not found on PATH; running synchronously\n',
      );
      return false;
    }

    const child = spawn('claude', ['--bg', argv.join(' ')], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    process.stdout.write(
      `${JSON.stringify({ bg: true, pid: child.pid ?? null })}\n`,
    );
    return true;
  } catch {
    process.stderr.write('warning: --bg failed; running synchronously\n');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerVideoCommands(program: Command): void {
  const vid = program.command('video').description('Video generation subcommands');

  // --- t2v ---
  const t2v = vid
    .command('t2v')
    .description('Generate video from text prompt (text-to-video)')
    .argument('<prompt>', 'Text prompt')
    .option('--aspect-ratio <ratio>', '16:9 | 9:16', '16:9')
    .option('--duration-seconds <n>', '4 | 6 | 8', '8')
    .option('--resolution <res>', '720p | 1080p | 4k', '720p')
    .option('--no-generate-audio', 'Disable audio generation')
    .option('--person-generation <mode>', 'allow_all | allow_adult', 'allow_all')
    .option('--seed <n>', 'Random seed')
    .option('--negative-prompt <text>', 'Negative prompt')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(t2v);
  t2v.action(async (prompt: string, opts: T2VOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const input = buildT2VInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateVideoCost({
          model: VIDEO_MODEL_VEO_3_1_PRO,
          resolution: (input.resolution ?? '720p') as '720p' | '1080p' | '4k',
          generateAudio: input.generateAudio,
        });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await generateVideoT2V(input, client);
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- i2v ---
  const i2v = vid
    .command('i2v')
    .description('Generate video from image (image-to-video)')
    .argument('<prompt>', 'Text prompt')
    .requiredOption('--image <path>', 'Path to first frame image')
    .option('--aspect-ratio <ratio>', '16:9 | 9:16', '16:9')
    .option('--duration-seconds <n>', '4 | 6 | 8', '8')
    .option('--resolution <res>', '720p | 1080p | 4k', '720p')
    .option('--no-generate-audio', 'Disable audio generation')
    .option('--seed <n>', 'Random seed')
    .option('--negative-prompt <text>', 'Negative prompt')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(i2v);
  i2v.action(async (prompt: string, opts: I2VOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const input = buildI2VInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateVideoCost({ model: VIDEO_MODEL_VEO_3_1_PRO });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await generateVideoI2V(input, client);
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- interpolate ---
  const interpolate = vid
    .command('interpolate')
    .description('Generate video interpolated between two frames')
    .argument('<prompt>', 'Text prompt')
    .requiredOption('--first <path>', 'Path to first frame image')
    .requiredOption('--last <path>', 'Path to last frame image')
    .option('--aspect-ratio <ratio>', '16:9 | 9:16', '16:9')
    .option('--duration-seconds <n>', '4 | 6 | 8', '8')
    .option('--resolution <res>', '720p | 1080p | 4k', '720p')
    .option('--no-generate-audio', 'Disable audio generation')
    .option('--seed <n>', 'Random seed')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(interpolate);
  interpolate.action(async (prompt: string, opts: InterpolateOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const input = buildInterpolateInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateVideoCost({ model: VIDEO_MODEL_VEO_3_1_PRO });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await generateVideoInterpolate(input, client);
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- refs ---
  const refs = vid
    .command('refs')
    .description('Generate video with reference images')
    .argument('<prompt>', 'Text prompt')
    .option(
      '--ref <path>',
      'Reference image path (repeat for multiple, max 3)',
      (val, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option('--aspect-ratio <ratio>', '16:9 | 9:16', '16:9')
    .option('--duration-seconds <n>', '4 | 6 | 8', '8')
    .option('--resolution <res>', '720p | 1080p | 4k', '720p')
    .option('--no-generate-audio', 'Disable audio generation')
    .option('--seed <n>', 'Random seed')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(refs);
  refs.action(async (prompt: string, opts: RefsOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const input = buildRefsInput(prompt, opts);
      if (opts.estimateCost) {
        const est = estimateVideoCost({ model: VIDEO_MODEL_VEO_3_1_PRO });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await generateVideoWithRefs(input, client);
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- extend ---
  const extend = vid
    .command('extend')
    .description('Extend an existing video by one hop (+7s, 720p only)')
    .argument('<prompt>', 'Extension directive prompt')
    .requiredOption('--source-uri <uri>', 'Source video URI')
    .option('--hop-index <n>', 'Hop index (0-19)', '0')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(extend);
  extend.action(async (prompt: string, opts: ExtendOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const hopIndex = opts.hopIndex !== undefined ? parseInt(opts.hopIndex, 10) : 0;
      if (hopIndex < 0 || hopIndex > 19) {
        throw new ValidationError(
          `--hop-index ${hopIndex} is out of range (0-19); max 20 hops allowed`,
        );
      }
      if (opts.estimateCost) {
        const est = estimateVideoCost({ model: VIDEO_MODEL_VEO_3_1_PRO, resolution: '720p' });
        exitOk({ estimateUsd: est.usd, breakdown: est }, opts);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await extendVideo({
        client,
        sourceVideoUri: opts.sourceUri ?? '',
        sourceMimeType: 'video/mp4',
        originalPrompt: prompt,
        extensionDirective: prompt,
        hopIndex,
      });
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- poll ---
  const poll = vid
    .command('poll')
    .description('Poll a long-running video operation until done')
    .argument('<operationName>', 'Operation name from generate command')
    .option('--interval-ms <n>', 'Polling interval in ms', '10000')
    .option('--timeout-ms <n>', 'Max wait in ms', '900000')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(poll);
  poll.action(async (operationName: string, opts: PollOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await pollVideoOperation({
        client,
        operationName,
        intervalMs: opts.intervalMs !== undefined ? parseInt(opts.intervalMs, 10) : 10000,
        maxAttempts:
          opts.timeoutMs !== undefined
            ? Math.ceil(parseInt(opts.timeoutMs, 10) / 10000)
            : 90,
      });
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- download ---
  const download = vid
    .command('download')
    .description('Download video from an operation result (by video URI)')
    .argument('<videoUri>', 'Video URI or operation name (URI expected)')
    .option('--filename <name>', 'Output filename', 'video.mp4')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(download);
  download.action(async (videoUri: string, opts: DownloadOpts) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });
      const result = await downloadVideo({
        client,
        videoUri,
        apiKey: config.apiKey,
        outputDir: opts.outputDir ?? config.outputDir ?? './outputs',
        filename: opts.filename,
      });
      exitOk(result, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });

  // --- wait (combined poll + download) ---
  const wait = vid
    .command('wait')
    .description(
      'Poll then download in one step (convenience: poll until done, then download)',
    )
    .argument('<operationName>', 'Operation name from generate command')
    .option('--interval-ms <n>', 'Polling interval in ms', '10000')
    .option('--timeout-ms <n>', 'Max wait in ms', '900000')
    .option('--filename <name>', 'Output filename', 'video.mp4')
    .option('--bg', 'Run in background via Claude Code session');
  addCommonFlags(wait);
  wait.action(async (operationName: string, opts: PollOpts & { filename?: string }) => {
    try {
      if (opts.bg) {
        const dispatched = await handleBg(process.argv.slice(2));
        if (dispatched) process.exit(0);
      }
      const config = loadConfig(process.env as Record<string, string | undefined>);
      const client = createClient({ config, dryRun: opts.dryRun ?? false });

      // Step 1: poll
      const pollResult = await pollVideoOperation({
        client,
        operationName,
        intervalMs: opts.intervalMs !== undefined ? parseInt(opts.intervalMs, 10) : 10000,
        maxAttempts:
          opts.timeoutMs !== undefined
            ? Math.ceil(parseInt(opts.timeoutMs, 10) / 10000)
            : 90,
      });

      // Step 2: extract videoUri from poll result
      const op = pollResult.operation as {
        response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
      };
      const videoUri =
        op?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
        operationName; // fallback: if caller passed a URI directly

      // Step 3: download
      const downloadResult = await downloadVideo({
        client,
        videoUri,
        apiKey: config.apiKey,
        outputDir: opts.outputDir ?? config.outputDir ?? './outputs',
        filename: opts.filename,
      });

      exitOk({ poll: pollResult, download: downloadResult }, opts);
    } catch (err) {
      exitErr(err, opts);
    }
  });
}
