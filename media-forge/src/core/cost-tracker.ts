import { openDb, runMigrations } from './db.js';
import type { Provider, VideoMode } from './models.js';
import type { JobState } from '../video/providers/base.js';

export interface RecordJobInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly model: string;
  readonly mode: VideoMode;
  readonly paramsHash: string;
  readonly estUsd: number;
  readonly createdAtOverride?: string;
  /** Native provider task ID (e.g. Kling task_id). Persisted for TTL-refresh re-poll. */
  readonly nativeTaskId?: string;
  /**
   * Provider-specific endpoint kind chosen for this submission (e.g. Kling
   * resolves to one of text2video/image2video/omni-video/motion-brush/lip-sync/
   * video-extend). Persisted so hydrateFromDb after a restart can target the
   * correct poll path — `mode` alone is insufficient when the routing decision
   * depends on extras (elementIds, lipSync, motionBrushRegions, etc.).
   * Codex P2 round 17 (PR#11).
   */
  readonly endpointKind?: string;
}

export interface RecordActualInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly actualUsd: number;
  readonly durationMs?: number;
  readonly finalStatus?: JobState; // ADD — default 'completed' preserves backward compat
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
     (id, provider, model, mode, params_hash, est_usd, status, created_at, native_task_id, endpoint_kind)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(
    input.jobId,
    input.provider,
    input.model,
    input.mode,
    input.paramsHash,
    input.estUsd,
    createdAt,
    input.nativeTaskId ?? null,
    input.endpointKind ?? null,
  );
}

export function recordActualCost(input: RecordActualInput): void {
  const db = ensureDb(input.dbPath);
  const completedAt = new Date().toISOString();
  const status = input.finalStatus ?? 'completed';
  // Idempotency: only update if actual_usd not yet set (handles webhook retry/duplicate delivery)
  db.prepare(
    `UPDATE video_jobs
     SET actual_usd = ?, duration_ms = ?, status = ?, completed_at = ?
     WHERE id = ? AND actual_usd IS NULL`,
  ).run(input.actualUsd, input.durationMs ?? null, status, completedAt, input.jobId);
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
