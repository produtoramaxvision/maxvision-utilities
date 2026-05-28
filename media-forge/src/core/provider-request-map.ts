import { openDb, runMigrations } from './db.js';
import type { Provider } from './models.js';

interface CacheKey {
  readonly provider: Provider;
  readonly providerRequestId: string;
}

function cacheKey(k: CacheKey): string {
  return `${k.provider}::${k.providerRequestId}`;
}

const CACHE_REQ_TO_JOB = new Map<string, string>();
const CACHE_JOB_TO_REQ = new Map<string, string>();
const CACHE_JOB_TO_STATUS_URL = new Map<string, string>();

export interface RecordMappingInput {
  readonly dbPath: string;
  readonly jobId: string;
  readonly provider: Provider;
  readonly providerRequestId: string;
  /**
   * Optional — when the provider returns its own status polling URL
   * (e.g. Higgsfield's `status_url` field, which may be a signed CDN URL
   * or an endpoint-specific path), persist it so pollStatus uses the
   * authoritative URL instead of reconstructing one. Codex P2 round 7 PR#10.
   */
  readonly statusUrl?: string;
}

export interface FindByRequestInput {
  readonly dbPath: string;
  readonly provider: Provider;
  readonly providerRequestId: string;
}

export interface FindByJobInput {
  readonly dbPath: string;
  readonly jobId: string;
}

function ensureDb(dbPath: string) {
  const db = openDb(dbPath);
  runMigrations(db);
  return db;
}

export function recordRequestMapping(input: RecordMappingInput): void {
  const db = ensureDb(input.dbPath);
  db.prepare(
    `INSERT OR REPLACE INTO provider_request_map
     (provider, provider_request_id, job_id, created_at, status_url)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.provider,
    input.providerRequestId,
    input.jobId,
    new Date().toISOString(),
    input.statusUrl ?? null,
  );
  CACHE_REQ_TO_JOB.set(
    cacheKey({ provider: input.provider, providerRequestId: input.providerRequestId }),
    input.jobId,
  );
  CACHE_JOB_TO_REQ.set(input.jobId, input.providerRequestId);
  // FIX (CodeRabbit round 9, PR#10): clear stale cache entry when statusUrl
  // is omitted on a re-record. Without the delete branch, a re-record without
  // statusUrl leaves an outdated URL in cache that subsequent lookups would
  // return — diverging from the DB's NULL value.
  if (input.statusUrl) {
    CACHE_JOB_TO_STATUS_URL.set(input.jobId, input.statusUrl);
  } else {
    CACHE_JOB_TO_STATUS_URL.delete(input.jobId);
  }
}

export function findStatusUrlByJobId(input: FindByJobInput): string | undefined {
  const hit = CACHE_JOB_TO_STATUS_URL.get(input.jobId);
  if (hit !== undefined) return hit;
  const db = ensureDb(input.dbPath);
  const row = db
    .prepare(`SELECT status_url FROM provider_request_map WHERE job_id = ? LIMIT 1`)
    .get(input.jobId) as { status_url?: string | null } | undefined;
  if (!row?.status_url) return undefined;
  CACHE_JOB_TO_STATUS_URL.set(input.jobId, row.status_url);
  return row.status_url;
}

export function findJobIdByRequestId(input: FindByRequestInput): string | undefined {
  const key = cacheKey({ provider: input.provider, providerRequestId: input.providerRequestId });
  const hit = CACHE_REQ_TO_JOB.get(key);
  if (hit !== undefined) return hit;
  const db = ensureDb(input.dbPath);
  const row = db
    .prepare(
      `SELECT job_id FROM provider_request_map WHERE provider = ? AND provider_request_id = ? LIMIT 1`,
    )
    .get(input.provider, input.providerRequestId) as { job_id: string } | undefined;
  if (!row) return undefined;
  CACHE_REQ_TO_JOB.set(key, row.job_id);
  CACHE_JOB_TO_REQ.set(row.job_id, input.providerRequestId);
  return row.job_id;
}

export function findRequestIdByJobId(input: FindByJobInput): string | undefined {
  const hit = CACHE_JOB_TO_REQ.get(input.jobId);
  if (hit !== undefined) return hit;
  const db = ensureDb(input.dbPath);
  const row = db
    .prepare(`SELECT provider_request_id FROM provider_request_map WHERE job_id = ? LIMIT 1`)
    .get(input.jobId) as { provider_request_id: string } | undefined;
  if (!row) return undefined;
  CACHE_JOB_TO_REQ.set(input.jobId, row.provider_request_id);
  return row.provider_request_id;
}

/** Test utility — clears the hot cache so the next lookup re-queries SQLite. */
export function clearRequestMapCache(): void {
  CACHE_REQ_TO_JOB.clear();
  CACHE_JOB_TO_REQ.clear();
  CACHE_JOB_TO_STATUS_URL.clear();
}
