import { openDb, runMigrations } from './db.js';
import type { Provider, VideoMode } from './models.js';

export interface RecordJobInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly model: string;
  readonly mode: VideoMode;
  readonly paramsHash: string;
  readonly estUsd: number;
  readonly createdAtOverride?: string;
}

export interface RecordActualInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly actualUsd: number;
  readonly durationMs?: number;
}

export interface ProviderRollup {
  readonly jobs: number;
  readonly estUsd: number;
  readonly actualUsd: number;
}

export interface CostReport {
  readonly periodDays: number;
  readonly totalJobs: number;
  readonly totalEstUsd: number;
  readonly totalActualUsd: number;
  readonly byProvider: Record<string, ProviderRollup>;
}

function ensureDb(dbPath: string) {
  const db = openDb(dbPath);
  runMigrations(db);
  return db;
}

export function recordJob(input: RecordJobInput): void {
  const db = ensureDb(input.dbPath);
  const createdAt = input.createdAtOverride ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO video_jobs
     (id, provider, model, mode, params_hash, est_usd, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(input.jobId, input.provider, input.model, input.mode, input.paramsHash, input.estUsd, createdAt);
}

export function recordActualCost(input: RecordActualInput): void {
  const db = ensureDb(input.dbPath);
  const completedAt = new Date().toISOString();
  db.prepare(
    `UPDATE video_jobs
     SET actual_usd = ?, duration_ms = ?, status = 'completed', completed_at = ?
     WHERE id = ?`,
  ).run(input.actualUsd, input.durationMs ?? null, completedAt, input.jobId);
}

export function queryReport(opts: { dbPath: string; periodDays: number }): CostReport {
  const db = ensureDb(opts.dbPath);
  const since = new Date(Date.now() - opts.periodDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT provider, COUNT(*) AS jobs,
              COALESCE(SUM(est_usd), 0) AS est_usd,
              COALESCE(SUM(actual_usd), 0) AS actual_usd
       FROM video_jobs
       WHERE created_at >= ?
       GROUP BY provider`,
    )
    .all(since) as Array<{
    provider: string;
    jobs: number;
    est_usd: number;
    actual_usd: number;
  }>;

  const byProvider: Record<string, ProviderRollup> = {};
  let totalJobs = 0;
  let totalEstUsd = 0;
  let totalActualUsd = 0;
  for (const r of rows) {
    byProvider[r.provider] = { jobs: r.jobs, estUsd: r.est_usd, actualUsd: r.actual_usd };
    totalJobs += r.jobs;
    totalEstUsd += r.est_usd;
    totalActualUsd += r.actual_usd;
  }

  return {
    periodDays: opts.periodDays,
    totalJobs,
    totalEstUsd,
    totalActualUsd,
    byProvider,
  };
}
