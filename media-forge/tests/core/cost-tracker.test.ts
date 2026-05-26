import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { recordJob, recordActualCost, queryReport } from '../../src/core/cost-tracker.js';

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
});
