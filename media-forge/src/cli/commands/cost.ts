import type { Command } from 'commander';
import { estimateImageCost, estimateVideoCost, estimateWithRetries } from '../../core/cost.js';
import { IMAGE_MODEL_NANO_BANANA_PRO, IMAGE_MODEL_IMAGEN_4_ULTRA, VIDEO_MODEL_VEO_3_1_PRO } from '../../core/models.js';
import { queryReport, dailySpendReport, monthlySpendUsd, allTimeSpendUsd, type CostReport } from '../../core/cost-tracker.js';
import * as path from 'node:path';
import * as os from 'node:os';

// P1 fix (2026-07-29): `cost summary` used to read `<projectDir>/cost.jsonl`, a
// file NOTHING in production writes, so the command always reported $0.00. It
// was repointed at the SQLite ledger (video_jobs + image_jobs) that
// cost-tracker.ts populates on every generation.
//
// 2026-07-31: the cost.jsonl path was removed outright — writer
// (OutputManager.appendCostLog), reader (getCostSummary) and helpers, none of
// which had a production caller. Leaving a dormant duplicate of the cost record
// beside the live one is how a future caller reaches for the wrong one.

/**
 * Resolves the SQLite ledger path the same way `defaultDbPath()` in
 * src/mcp/handlers/shared.ts does. Not imported directly: that module also
 * pulls in HiggsfieldProvider + feature-flags (MCP video-provider wiring),
 * which is the wrong dependency direction for a CLI command that only needs a
 * path string. `buildCostReport` below already replicates the same logic
 * inline for the same reason — this matches existing precedent.
 */
function resolveDbPath(projectDirOverride?: string): string {
  const projectDir =
    projectDirOverride ?? process.env['MEDIA_FORGE_PROJECT_DIR'] ?? path.join(process.cwd(), '.media-forge');
  return path.join(projectDir, 'cost.db');
}

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
    .description('Show cost summary from the SQLite cost ledger (video_jobs + image_jobs)')
    .option('--today', 'Today only', false)
    .option('--month', 'Current month', false)
    .option('--project-dir <dir>', 'Override .media-forge project dir')
    .option('--json', 'Emit JSON')
    .action(
      (opts: { today?: boolean; month?: boolean; projectDir?: string; json?: boolean }) => {
        const result = buildCostSummary(opts);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          process.stdout.write(`date: ${result.date}\ntotal: $${result.usd.toFixed(4)} (${result.entries} entries)\n`);
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

/**
 * The `cost summary` CLI command, over the sqlite ledger.
 *
 * Sums video_jobs + image_jobs via dailySpendReport / monthlySpendUsd /
 * allTimeSpendUsd in cost-tracker.ts — the same ledger every image and video
 * tool call writes to.
 *
 * The cost.jsonl-backed `getCostSummary` this replaced was removed on
 * 2026-07-31 along with the rest of that path: nothing wrote the file, so it
 * always reported $0.00, and a dormant second cost source next to the live one
 * is how a future caller picks the wrong one.
 */
export function buildCostSummary(opts: {
  projectDir?: string;
  dbPath?: string;
  today?: boolean;
  month?: boolean;
}): { date: string; usd: number; entries: number } {
  const dbPath = opts.dbPath ?? resolveDbPath(opts.projectDir);
  if (opts.month) {
    const month = new Date().toISOString().slice(0, 7);
    const { usd, entries } = monthlySpendUsd({ dbPath, monthUtc: month });
    return { date: month, usd, entries };
  }
  if (opts.today) {
    const today = new Date().toISOString().slice(0, 10);
    const { usd, entries } = dailySpendReport({ dbPath, dateUtc: today });
    return { date: today, usd, entries };
  }
  const { usd, entries } = allTimeSpendUsd({ dbPath });
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
