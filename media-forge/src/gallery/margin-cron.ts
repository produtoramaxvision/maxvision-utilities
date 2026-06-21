// media-forge/src/gallery/margin-cron.ts
// Periodic margin alert cron using setInterval (no external cron dependency).
// Cleanup via returned stop function + SIGTERM/SIGINT handlers in startHttpServer.
import { logger } from '../core/logger.js';
import { computeMargin } from './margin.js';
import { evaluateAndAlert } from './margin-alert.js';
import type { Notifier } from './margin-alert.js';
import type { GalleryStore } from './gallery-store.js';

export interface MarginCronOpts {
  store: GalleryStore;
  notifier: Notifier;
  thresholdPct: number;   // ex: 30
  intervalMs: number;     // ex: 60 * 60 * 1000 (1h)
  windowHours?: number;   // analytic window, default 24
}

/** Starts the margin alert cron. Returns a cleanup function. */
export function startMarginCron(opts: MarginCronOpts): () => void {
  const { store, notifier, thresholdPct, intervalMs, windowHours = 24 } = opts;

  const run = async (): Promise<void> => {
    try {
      const now = new Date();
      const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
      const rows = await store.generationsInPeriod({ since, until: now.toISOString() });
      const report = computeMargin(rows);
      const { alerted } = await evaluateAndAlert(report, { thresholdPct, notifier });
      if (alerted) {
        logger.warn('[margin-cron] Margin alert fired', {
          marginPct: report.marginPct.toFixed(1),
          revenueUsd: report.revenueUsd,
          costUsd: report.costUsd,
        });
      } else {
        logger.info('[margin-cron] Margin OK', { marginPct: report.marginPct.toFixed(1) });
      }
    } catch (err) {
      logger.error('[margin-cron] Error computing margin', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Run immediately on startup (do not wait for the first interval).
  void run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
