// media-forge/src/gallery/margin.ts
// Pure margin computation over gallery rows. No I/O.
import type { GenerationRecord } from './schema.js';

export interface ModelMargin {
  count: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
}

export interface MarginReport {
  count: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;          // 0–100
  byModel: Record<string, ModelMargin>;
  periodStart?: string;
  periodEnd?: string;
}

/** Computa margem a partir de linhas da galeria (puro, sem I/O). */
export function computeMargin(
  rows: readonly GenerationRecord[],
  opts?: { periodStart?: string; periodEnd?: string },
): MarginReport {
  let totalRevenue = 0;
  let totalCost = 0;
  const byModel: Record<string, { count: number; rev: number; cost: number }> = {};

  for (const r of rows) {
    if (r.status !== 'completed') continue;
    const rev = r.creditsDebited * r.creditValueUsd;
    totalRevenue += rev;
    totalCost += r.costUsd;
    const m = (byModel[r.model] ??= { count: 0, rev: 0, cost: 0 });
    m.count++;
    m.rev += rev;
    m.cost += r.costUsd;
  }

  const marginUsd = totalRevenue - totalCost;
  const marginPct = totalRevenue > 0 ? (marginUsd / totalRevenue) * 100 : 0;

  const byModelOut: Record<string, ModelMargin> = {};
  for (const [model, m] of Object.entries(byModel)) {
    const mMarginUsd = m.rev - m.cost;
    byModelOut[model] = {
      count: m.count,
      revenueUsd: m.rev,
      costUsd: m.cost,
      marginUsd: mMarginUsd,
      marginPct: m.rev > 0 ? (mMarginUsd / m.rev) * 100 : 0,
    };
  }

  return {
    count: rows.filter((r) => r.status === 'completed').length,
    revenueUsd: totalRevenue,
    costUsd: totalCost,
    marginUsd,
    marginPct,
    byModel: byModelOut,
    ...opts,
  };
}

/** Retorna true se a margem% estiver abaixo do limiar (dispara alerta). */
export function marginBelowThreshold(
  report: Pick<MarginReport, 'marginPct'>,
  thresholdPct: number,
): boolean {
  return report.marginPct < thresholdPct;
}
