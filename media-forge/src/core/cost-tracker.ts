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
  readonly actualCredits?: number;
}

export interface JobRecord {
  readonly jobId: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly status: string;
  readonly estUsd: number;
  readonly actualUsd: number | null;
  readonly durationMs: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly nativeTaskId: string | null;
  readonly actualCredits: number | null;
  readonly tenantId: string | null;
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
     SET actual_usd = ?, duration_ms = ?, status = ?, completed_at = ?, actual_credits = ?
     WHERE id = ? AND actual_usd IS NULL`,
  ).run(input.actualUsd, input.durationMs ?? null, status, completedAt, input.actualCredits ?? null, input.jobId);
}

export function getJobRecord(opts: {
  readonly dbPath: string;
  readonly jobId: string;
}): JobRecord | null {
  const db = ensureDb(opts.dbPath);
  const row = db
    .prepare(
      `SELECT id, provider, model, mode, status, est_usd, actual_usd, duration_ms,
              created_at, completed_at, native_task_id, actual_credits, tenant_id
         FROM video_jobs
        WHERE id = ?`,
    )
    .get(opts.jobId) as
    | {
        id: string;
        provider: string;
        model: string;
        mode: string;
        status: string;
        est_usd: number;
        actual_usd: number | null;
        duration_ms: number | null;
        created_at: string;
        completed_at: string | null;
        native_task_id: string | null;
        actual_credits: number | null;
        tenant_id: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    jobId: row.id,
    provider: row.provider,
    model: row.model,
    mode: row.mode,
    status: row.status,
    estUsd: row.est_usd,
    actualUsd: row.actual_usd,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    nativeTaskId: row.native_task_id,
    actualCredits: row.actual_credits,
    tenantId: row.tenant_id,
  };
}

export function setJobTenant(opts: {
  readonly dbPath: string;
  readonly jobId: string;
  readonly tenantId: string;
}): void {
  const db = ensureDb(opts.dbPath);
  db.prepare(`UPDATE video_jobs SET tenant_id = ? WHERE id = ?`).run(opts.tenantId, opts.jobId);
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
