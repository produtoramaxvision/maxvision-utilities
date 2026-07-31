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

export interface RecordImageJobInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly model: string;
  readonly paramsHash: string;
  readonly estUsd: number;
  readonly createdAtOverride?: string;
  readonly tenantId?: string;
}

export interface RecordImageActualInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly actualUsd: number;
  /** Default 'completed' preserves backward compat (mirrors RecordActualInput.finalStatus).
   *  Pass 'failed' with actualUsd: 0 when the provider call threw — otherwise the row stays
   *  'pending' at its est_usd FOREVER and dailySpendUsd's COALESCE(actual_usd, est_usd) counts
   *  it against the daily cap for the rest of the UTC day, for a call that cost $0. */
  readonly finalStatus?: 'completed' | 'failed';
}

/** Mirrors recordJob for the image_jobs ledger (009-image-jobs.sql). Image
 *  generations are synchronous — status starts 'pending' and is flipped to
 *  'completed' (or 'failed', see RecordImageActualInput.finalStatus) by
 *  recordImageActualCost right after the provider call returns or throws, in
 *  the same tool invocation. */
export function recordImageJob(input: RecordImageJobInput): void {
  const db = ensureDb(input.dbPath);
  const createdAt = input.createdAtOverride ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO image_jobs
     (id, provider, model, params_hash, est_usd, status, created_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(
    input.jobId,
    input.provider,
    input.model,
    input.paramsHash,
    input.estUsd,
    createdAt,
    input.tenantId ?? 'default',
  );
}

/** Mirrors recordActualCost for image_jobs. Idempotent — only updates while
 *  actual_usd is still NULL. */
export function recordImageActualCost(input: RecordImageActualInput): void {
  const db = ensureDb(input.dbPath);
  const completedAt = new Date().toISOString();
  const status = input.finalStatus ?? 'completed';
  db.prepare(
    `UPDATE image_jobs
     SET actual_usd = ?, status = ?, completed_at = ?
     WHERE id = ? AND actual_usd IS NULL`,
  ).run(input.actualUsd, status, completedAt, input.jobId);
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

// Shared SELECT column list + row shape/mapping for video_jobs, so
// getJobRecord and findJobByNativeTaskId (T15/PR3b) don't duplicate either.
const VIDEO_JOB_ROW_COLUMNS =
  `id, provider, model, mode, status, est_usd, actual_usd, duration_ms,
   created_at, completed_at, native_task_id, actual_credits, tenant_id`;

interface VideoJobRow {
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

function mapJobRow(row: VideoJobRow): JobRecord {
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

export function getJobRecord(opts: {
  readonly dbPath: string;
  readonly jobId: string;
}): JobRecord | null {
  const db = ensureDb(opts.dbPath);
  const row = db
    .prepare(`SELECT ${VIDEO_JOB_ROW_COLUMNS} FROM video_jobs WHERE id = ?`)
    .get(opts.jobId) as VideoJobRow | undefined;
  if (!row) return null;
  return mapJobRow(row);
}

export function setJobTenant(opts: {
  readonly dbPath: string;
  readonly jobId: string;
  readonly tenantId: string;
}): void {
  const db = ensureDb(opts.dbPath);
  db.prepare(`UPDATE video_jobs SET tenant_id = ? WHERE id = ?`).run(opts.tenantId, opts.jobId);
}

/**
 * Binds a native provider task/operation id to our own internal jobId, AFTER
 * the submit has already returned it. Modelled on setJobTenant. Needed for
 * providers (Veo, T15/PR3b) where the row is inserted via recordJob BEFORE
 * the submit — at insert time the native id (e.g. Veo's `operationName`)
 * isn't known yet, so it's patched in once the submit responds.
 */
export function setJobNativeTaskId(opts: {
  readonly dbPath: string;
  readonly jobId: string;
  readonly nativeTaskId: string;
}): void {
  const db = ensureDb(opts.dbPath);
  db.prepare(`UPDATE video_jobs SET native_task_id = ? WHERE id = ?`).run(opts.nativeTaskId, opts.jobId);
}

/**
 * Resolves a native provider task/operation id (e.g. Veo's `operationName`)
 * back to our internal JobRecord — the inverse of setJobNativeTaskId. Needed
 * so a poll handler that only receives the native id (not our jobId) can
 * still find and settle the row. Returns null when no row matches (self-host,
 * dry-run, or any job predating this correlation being recorded) — callers
 * must treat that as "nothing to settle", not an error.
 */
export function findJobByNativeTaskId(opts: {
  readonly dbPath: string;
  readonly nativeTaskId: string;
}): JobRecord | null {
  const db = ensureDb(opts.dbPath);
  const row = db
    .prepare(`SELECT ${VIDEO_JOB_ROW_COLUMNS} FROM video_jobs WHERE native_task_id = ?`)
    .get(opts.nativeTaskId) as VideoJobRow | undefined;
  if (!row) return null;
  return mapJobRow(row);
}

/**
 * Sums today's spend (UTC calendar day, or `dateUtc` if given) across BOTH
 * video_jobs and image_jobs, so the cost guard's daily cap actually reflects
 * every generation kind. Uses COALESCE(actual_usd, est_usd) per row so
 * pending (not-yet-settled) jobs still count against the cap at their
 * estimate — a cap that only summed settled jobs would let an unbounded
 * number of in-flight generations slip past it.
 *
 * Multi-tenant: when `tenantId` is given, the cap is PER TENANT — only rows
 * attributed to that tenant are summed, via COALESCE(tenant_id, 'default') = ?
 * so pre-existing/legacy rows with a NULL tenant_id are attributed to
 * 'default' (matching 008-video-jobs-tenant.sql's stated contract) instead of
 * silently vanishing from every tenant's total. When `tenantId` is omitted,
 * the query preserves the original install-wide behavior and sums every
 * tenant's rows together — useful for an operator-level "whole install" view.
 * The MCP cost guard (checkCostGuardOrThrow in handlers/register.ts) always
 * calls this WITH a tenantId (deps.tenantId ?? 'default'): without per-tenant
 * scoping, one busy tenant's spend would count against the daily cap for
 * every other tenant on the same hosted install, denying them service.
 *
 * NOT queryReport: that function computes a rolling 24h window from
 * Date.now() and reads only video_jobs — neither matches "today, UTC,
 * across all generation kinds".
 */
export function dailySpendUsd(opts: {
  readonly dbPath: string;
  readonly dateUtc?: string;
  readonly tenantId?: string;
}): number {
  const db = ensureDb(opts.dbPath);
  const day = opts.dateUtc ?? new Date().toISOString().slice(0, 10);

  const videoRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total
             FROM video_jobs
            WHERE substr(created_at, 1, 10) = ?
              AND COALESCE(tenant_id, 'default') = ?`,
        )
        .get(day, opts.tenantId) as { total: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total
             FROM video_jobs
            WHERE substr(created_at, 1, 10) = ?`,
        )
        .get(day) as { total: number });

  const imageRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total
             FROM image_jobs
            WHERE substr(created_at, 1, 10) = ?
              AND COALESCE(tenant_id, 'default') = ?`,
        )
        .get(day, opts.tenantId) as { total: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total
             FROM image_jobs
            WHERE substr(created_at, 1, 10) = ?`,
        )
        .get(day) as { total: number });

  return (videoRow.total ?? 0) + (imageRow.total ?? 0);
}

/**
 * Same query as dailySpendUsd, but also returns the row count across BOTH
 * tables — the `media-forge cost summary --today` CLI needs both the dollar
 * total AND an "N entries" figure, and dailySpendUsd's existing number-only
 * signature is left untouched (it already has call sites — the cost guard in
 * handlers/register.ts — and extensive assertions in
 * cost-tracker-daily-spend.test.ts that only need the bare number).
 */
export function dailySpendReport(opts: {
  readonly dbPath: string;
  readonly dateUtc?: string;
  readonly tenantId?: string;
}): { usd: number; entries: number } {
  const db = ensureDb(opts.dbPath);
  const day = opts.dateUtc ?? new Date().toISOString().slice(0, 10);

  const videoRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM video_jobs
            WHERE substr(created_at, 1, 10) = ?
              AND COALESCE(tenant_id, 'default') = ?`,
        )
        .get(day, opts.tenantId) as { total: number; cnt: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM video_jobs
            WHERE substr(created_at, 1, 10) = ?`,
        )
        .get(day) as { total: number; cnt: number });

  const imageRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM image_jobs
            WHERE substr(created_at, 1, 10) = ?
              AND COALESCE(tenant_id, 'default') = ?`,
        )
        .get(day, opts.tenantId) as { total: number; cnt: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM image_jobs
            WHERE substr(created_at, 1, 10) = ?`,
        )
        .get(day) as { total: number; cnt: number });

  return {
    usd: (videoRow.total ?? 0) + (imageRow.total ?? 0),
    entries: (videoRow.cnt ?? 0) + (imageRow.cnt ?? 0),
  };
}

/**
 * Same shape as dailySpendReport, scoped to a UTC calendar MONTH (`YYYY-MM`,
 * defaults to the current month) instead of a day. Backs
 * `media-forge cost summary --month`.
 */
export function monthlySpendUsd(opts: {
  readonly dbPath: string;
  readonly monthUtc?: string;
  readonly tenantId?: string;
}): { usd: number; entries: number } {
  const db = ensureDb(opts.dbPath);
  const month = opts.monthUtc ?? new Date().toISOString().slice(0, 7);

  const videoRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM video_jobs
            WHERE substr(created_at, 1, 7) = ?
              AND COALESCE(tenant_id, 'default') = ?`,
        )
        .get(month, opts.tenantId) as { total: number; cnt: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM video_jobs
            WHERE substr(created_at, 1, 7) = ?`,
        )
        .get(month) as { total: number; cnt: number });

  const imageRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM image_jobs
            WHERE substr(created_at, 1, 7) = ?
              AND COALESCE(tenant_id, 'default') = ?`,
        )
        .get(month, opts.tenantId) as { total: number; cnt: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM image_jobs
            WHERE substr(created_at, 1, 7) = ?`,
        )
        .get(month) as { total: number; cnt: number });

  return {
    usd: (videoRow.total ?? 0) + (imageRow.total ?? 0),
    entries: (videoRow.cnt ?? 0) + (imageRow.cnt ?? 0),
  };
}

/**
 * Same shape as dailySpendReport/monthlySpendUsd, with no date filter at all —
 * every row across both tables (optionally scoped to a tenant). Backs
 * `media-forge cost summary` (the all-time default, no --today/--month flag).
 */
export function allTimeSpendUsd(opts: {
  readonly dbPath: string;
  readonly tenantId?: string;
}): { usd: number; entries: number } {
  const db = ensureDb(opts.dbPath);

  const videoRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM video_jobs
            WHERE COALESCE(tenant_id, 'default') = ?`,
        )
        .get(opts.tenantId) as { total: number; cnt: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM video_jobs`,
        )
        .get() as { total: number; cnt: number });

  const imageRow = opts.tenantId
    ? (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM image_jobs
            WHERE COALESCE(tenant_id, 'default') = ?`,
        )
        .get(opts.tenantId) as { total: number; cnt: number })
    : (db
        .prepare(
          `SELECT COALESCE(SUM(COALESCE(actual_usd, est_usd)), 0) AS total, COUNT(*) AS cnt
             FROM image_jobs`,
        )
        .get() as { total: number; cnt: number });

  return {
    usd: (videoRow.total ?? 0) + (imageRow.total ?? 0),
    entries: (videoRow.cnt ?? 0) + (imageRow.cnt ?? 0),
  };
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
