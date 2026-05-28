import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import {
  recordJob,
  recordActualCost,
  queryReport,
  getJobRecord,
} from '../../src/core/cost-tracker.js';
import type { JobState } from '../../src/video/providers/base.js';

describe('cost-tracker', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-cost-test-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records a new job with estimated cost', () => {
    recordJob({
      dbPath,
      jobId: 'job-1',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'abc123',
      estUsd: 0.5,
    });
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.totalEstUsd).toBe(0.5);
    expect(report.byProvider.google.jobs).toBe(1);
  });

  it('updates a job with actual cost + completion', () => {
    recordJob({
      dbPath,
      jobId: 'job-2',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'def456',
      estUsd: 0.5,
    });
    recordActualCost({ dbPath, jobId: 'job-2', actualUsd: 0.48, durationMs: 12000 });
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.totalActualUsd).toBe(0.48);
    expect(report.byProvider.google.actualUsd).toBe(0.48);
  });

  it('queryReport scopes by periodDays', () => {
    recordJob({
      dbPath,
      jobId: 'old',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'old',
      estUsd: 1.0,
      createdAtOverride: '2020-01-01T00:00:00.000Z',
    });
    recordJob({
      dbPath,
      jobId: 'new',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'new',
      estUsd: 2.0,
    });
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(report.totalEstUsd).toBe(2.0);
    expect(report.byProvider.google.jobs).toBe(1);
  });

  it('queryReport groups by provider when multiple providers present', () => {
    recordJob({
      dbPath,
      jobId: 'g1',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'g1',
      estUsd: 0.5,
    });
    recordJob({
      dbPath,
      jobId: 'k1',
      provider: 'kling',
      model: 'kling-3.0-pro',
      mode: 't2v',
      paramsHash: 'k1',
      estUsd: 0.84,
    });
    const report = queryReport({ dbPath, periodDays: 30 });
    expect(Object.keys(report.byProvider).sort()).toEqual(['google', 'kling']);
    expect(report.byProvider.google.estUsd).toBe(0.5);
    expect(report.byProvider.kling.estUsd).toBe(0.84);
  });

  it('recordActualCost with finalStatus: failed preserves failed status in DB', () => {
    recordJob({
      dbPath,
      jobId: 'job-fail',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'fail1',
      estUsd: 0.5,
    });
    const finalStatus: JobState = 'failed';
    recordActualCost({ dbPath, jobId: 'job-fail', actualUsd: 0.0, durationMs: 5000, finalStatus });
    const db = openDb(dbPath);
    const row = db
      .prepare('SELECT status FROM video_jobs WHERE id = ?')
      .get('job-fail') as { status: string };
    expect(row.status).toBe('failed');
  });

  it('recordActualCost with finalStatus: nsfw preserves nsfw status in DB', () => {
    recordJob({
      dbPath,
      jobId: 'job-nsfw',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'nsfw1',
      estUsd: 0.5,
    });
    const finalStatus: JobState = 'nsfw';
    recordActualCost({ dbPath, jobId: 'job-nsfw', actualUsd: 0.0, durationMs: 3000, finalStatus });
    const db = openDb(dbPath);
    const row = db
      .prepare('SELECT status FROM video_jobs WHERE id = ?')
      .get('job-nsfw') as { status: string };
    expect(row.status).toBe('nsfw');
  });

  it('recordActualCost is idempotent — second call on same jobId is a no-op', () => {
    recordJob({
      dbPath,
      jobId: 'job-idempotent',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'idem1',
      estUsd: 0.5,
    });
    // First call: sets actual_usd = 0.48
    recordActualCost({ dbPath, jobId: 'job-idempotent', actualUsd: 0.48, durationMs: 10000 });
    // Second call (webhook retry): should be ignored because actual_usd IS NOT NULL
    recordActualCost({ dbPath, jobId: 'job-idempotent', actualUsd: 9.99, durationMs: 99999 });
    const db = openDb(dbPath);
    const row = db
      .prepare('SELECT actual_usd, duration_ms FROM video_jobs WHERE id = ?')
      .get('job-idempotent') as { actual_usd: number; duration_ms: number };
    expect(row.actual_usd).toBe(0.48);
    expect(row.duration_ms).toBe(10000);
  });

  it('getJobRecord returns full row including model for downstream per-tier cost lookup', () => {
    recordJob({
      dbPath,
      jobId: 'gj-fast',
      provider: 'bytedance',
      model: 'seedance-2.0-fast',
      mode: 't2v',
      paramsHash: 'hf',
      estUsd: 0.97,
    });
    const row = getJobRecord({ dbPath, jobId: 'gj-fast' });
    expect(row?.model).toBe('seedance-2.0-fast');
    expect(row?.provider).toBe('bytedance');
    expect(row?.status).toBe('pending');
    expect(row?.actualUsd).toBeNull();
  });

  it('getJobRecord returns null for unknown jobId', () => {
    const row = getJobRecord({ dbPath, jobId: 'nope' });
    expect(row).toBeNull();
  });
});
