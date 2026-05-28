import type { Command } from 'commander';
import { estimateImageCost, estimateVideoCost, estimateWithRetries, dailyTotal, monthlyTotal, allTimeTotal } from '../../core/cost.js';
import { IMAGE_MODEL_NANO_BANANA_PRO, IMAGE_MODEL_IMAGEN_4_ULTRA, VIDEO_MODEL_VEO_3_1_PRO } from '../../core/models.js';
import { queryReport, type CostReport } from '../../core/cost-tracker.js';
import * as path from 'node:path';
import * as os from 'node:os';

// Supported op values for cost estimate
const IMAGE_OPS = ['image-nano-banana-pro', 'nano-banana-pro'] as const;
const IMAGE_ULTRA_OPS = ['image-imagen-4-ultra', 'imagen-4-ultra'] as const;
const VIDEO_OPS = ['video-t2v', 'video-i2v', 'video-extend', 'video-interpolate', 'video-refs', 't2v', 'i2v'] as const;

export function registerCostCommands(program: Command): void {
  const cost = program.command('cost').description('Cost estimation and summaries');

  // --- estimate ---
  cost
    .command('estimate')
    .description(
      'Estimate cost (retry-aware via --max-attempts). ' +
        'Use --op to specify operation: image-nano-banana-pro | image-imagen-4-ultra | video-t2v',
    )
    .option('--op <op>', 'Operation to estimate (e.g. image-nano-banana-pro)')
    .option('--image-size <size>', 'Image size for image ops: 1K | 2K | 4K', '4K')
    .option('--resolution <res>', 'Resolution for video ops: 720p | 1080p | 4k', '720p')
    .option('--max-attempts <n>', 'Retry budget cap', '3')
    .option('--json', 'Emit JSON')
    .action((opts: { op?: string; imageSize?: string; resolution?: string; maxAttempts?: string; json?: boolean }) => {
      const maxAttempts = parseInt(opts.maxAttempts ?? '3', 10);
      const op = opts.op ?? 'image-nano-banana-pro';

      let base;
      if ((IMAGE_OPS as readonly string[]).includes(op)) {
        base = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          imageSize: (opts.imageSize ?? '4K') as '1K' | '2K' | '4K',
        });
      } else if ((IMAGE_ULTRA_OPS as readonly string[]).includes(op)) {
        base = estimateImageCost({ model: IMAGE_MODEL_IMAGEN_4_ULTRA });
      } else if ((VIDEO_OPS as readonly string[]).includes(op)) {
        base = estimateVideoCost({
          model: VIDEO_MODEL_VEO_3_1_PRO,
          resolution: (opts.resolution ?? '720p') as '720p' | '1080p' | '4k',
        });
      } else {
        // Default to Nano Banana Pro
        base = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO });
      }

      const withRetries = estimateWithRetries(base, maxAttempts);
      const result = {
        op,
        perAttemptUsd: base.usd,
        totalUsd: withRetries.maxTotalUsd,
        maxAttempts,
        breakdown: withRetries.breakdown,
        confidence: withRetries.confidence,
      };

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(
          `op: ${op}\nper-attempt: $${base.usd.toFixed(4)}\ntotal (${maxAttempts}x retries): $${withRetries.maxTotalUsd.toFixed(4)}\n`,
        );
      }
    });

  // --- summary ---
  cost
    .command('summary')
    .description('Show cost summary from cost.jsonl logs')
    .option('--today', 'Today only', false)
    .option('--month', 'Current month', false)
    .option('--project-dir <dir>', 'Override .media-forge project dir')
    .option('--json', 'Emit JSON')
    .action(
      (opts: { today?: boolean; month?: boolean; projectDir?: string; json?: boolean }) => {
        const projectDir =
          opts.projectDir ??
          process.env['MEDIA_FORGE_PROJECT_DIR'] ??
          path.join(process.cwd(), '.media-forge');
        const logPath = path.join(projectDir, 'cost.jsonl');
        const today = new Date().toISOString().slice(0, 10);
        const month = new Date().toISOString().slice(0, 7);
        let label: string;
        let usd: number;
        let entries: number;
        if (opts.month) {
          ({ usd, entries } = monthlyTotal({ logPath, month }));
          label = month;
        } else if (opts.today) {
          ({ usd, entries } = dailyTotal({ logPath, date: today }));
          label = today;
        } else {
          ({ usd, entries } = allTimeTotal({ logPath }));
          label = 'all-time';
        }

        const result = { date: label, usd, entries };
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          process.stdout.write(`date: ${result.date}\ntotal: $${usd.toFixed(4)} (${entries} entries)\n`);
        }
      },
    );

  // --- report ---
  cost
    .command('report')
    .description('Multi-provider cost report from SQLite (use --by-provider --period 30d)')
    .option('--period <period>', 'Period (e.g. 30d, 7d, 90d)', '30d')
    .option('--by-provider', 'Group by provider', false)
    .option('--db <path>', 'Override cost.db path')
    .option('--json', 'Emit JSON', false)
    .action(
      (cmdOpts: { period?: string; byProvider?: boolean; db?: string; json?: boolean }) => {
        const report = buildCostReport({
          dbPath: cmdOpts.db,
          period: cmdOpts.period,
          byProvider: cmdOpts.byProvider ?? false,
        });
        if (cmdOpts.json) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          return;
        }
        process.stdout.write(
          `period: ${report.periodDays}d\nestimated: $${report.totalEstUsd.toFixed(4)}\nactual: $${report.totalActualUsd.toFixed(4)}\njobs: ${report.totalJobs}\n`,
        );
        if (cmdOpts.byProvider) {
          for (const [provider, rollup] of Object.entries(report.byProvider)) {
            process.stdout.write(
              `  ${provider}: ${rollup.jobs} jobs, est $${rollup.estUsd.toFixed(4)}, actual $${rollup.actualUsd.toFixed(4)}\n`,
            );
          }
        }
      },
    );
}

// Export helpers for testing
export function buildCostEstimate(opts: {
  op?: string;
  imageSize?: string;
  resolution?: string;
  maxAttempts?: string;
}) {
  const maxAttempts = parseInt(opts.maxAttempts ?? '3', 10);
  const op = opts.op ?? 'image-nano-banana-pro';

  let base;
  if ((IMAGE_OPS as readonly string[]).includes(op)) {
    base = estimateImageCost({
      model: IMAGE_MODEL_NANO_BANANA_PRO,
      imageSize: (opts.imageSize ?? '4K') as '1K' | '2K' | '4K',
    });
  } else if ((IMAGE_ULTRA_OPS as readonly string[]).includes(op)) {
    base = estimateImageCost({ model: IMAGE_MODEL_IMAGEN_4_ULTRA });
  } else if ((VIDEO_OPS as readonly string[]).includes(op)) {
    base = estimateVideoCost({
      model: VIDEO_MODEL_VEO_3_1_PRO,
      resolution: (opts.resolution ?? '720p') as '720p' | '1080p' | '4k',
    });
  } else {
    base = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO });
  }

  const withRetries = estimateWithRetries(base, maxAttempts);
  return {
    op,
    perAttemptUsd: base.usd,
    totalUsd: withRetries.maxTotalUsd,
    maxAttempts,
    breakdown: withRetries.breakdown,
    confidence: withRetries.confidence,
  };
}

export function getCostSummary(opts: {
  projectDir?: string;
  today?: boolean;
  month?: boolean;
}) {
  const projectDir =
    opts.projectDir ??
    process.env['MEDIA_FORGE_PROJECT_DIR'] ??
    path.join(process.cwd(), '.media-forge');
  const logPath = path.join(projectDir, 'cost.jsonl');
  if (opts.month) {
    const month = new Date().toISOString().slice(0, 7);
    const { usd, entries } = monthlyTotal({ logPath, month });
    return { date: month, usd, entries };
  }
  if (opts.today) {
    const today = new Date().toISOString().slice(0, 10);
    const { usd, entries } = dailyTotal({ logPath, date: today });
    return { date: today, usd, entries };
  }
  const { usd, entries } = allTimeTotal({ logPath });
  return { date: 'all-time', usd, entries };
}

export interface BuildCostReportOpts {
  readonly dbPath?: string;
  readonly periodDays?: number;
  readonly period?: string;
  readonly byProvider?: boolean;
}

export function buildCostReport(opts: BuildCostReportOpts): CostReport {
  const dbPath =
    opts.dbPath ??
    path.join(
      process.env['MEDIA_FORGE_PROJECT_DIR'] ?? path.join(process.cwd(), '.media-forge'),
      'cost.db',
    );
  const periodDays = opts.periodDays ?? parsePeriod(opts.period ?? '30d');
  return queryReport({ dbPath, periodDays });
}

function parsePeriod(s: string): number {
  const m = /^(\d+)d$/.exec(s);
  if (!m) throw new Error(`invalid period: ${s} (expected NNd, e.g. 30d)`);
  return parseInt(m[1]!, 10);
}

// Export for testing
export { os as _os };
