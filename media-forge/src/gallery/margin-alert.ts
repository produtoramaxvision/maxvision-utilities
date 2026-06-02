// media-forge/src/gallery/margin-alert.ts
// Margin alert interface + evaluateAndAlert. No I/O except via injected Notifier.
import type { MarginReport } from './margin.js';

/** Interface injetável para notificacao (email, Telegram, webhook, no-op). Mirror de StatusProbe do sweep. */
export interface Notifier {
  send(subject: string, body: string): Promise<void>;
}

export interface AlertOpts {
  thresholdPct: number;   // ex: 30
  notifier: Notifier;
  model?: string;         // se presente, avalia o byModel especifico
}

/** Avalia o MarginReport e dispara o Notifier se margem < limiar. Idempotente. */
export async function evaluateAndAlert(
  report: MarginReport,
  opts: AlertOpts,
): Promise<{ alerted: boolean }> {
  const { thresholdPct, notifier, model } = opts;
  const target = model ? report.byModel[model] : report;
  if (!target) return { alerted: false };
  if (target.marginPct < thresholdPct) {
    const label = model ? `model=${model}` : 'overall';
    await notifier.send(
      `[media-forge] Margem abaixo do limiar (${thresholdPct}%)`,
      `Margem atual (${label}): ${target.marginPct.toFixed(1)}% — limiar: ${thresholdPct}%\n` +
        `Receita: $${report.revenueUsd.toFixed(4)} | Custo: $${report.costUsd.toFixed(4)} | Margem: $${report.marginUsd.toFixed(4)}\n` +
        `Geracoes: ${report.count}`,
    );
    return { alerted: true };
  }
  return { alerted: false };
}
