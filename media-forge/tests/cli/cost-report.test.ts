import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { recordJob, recordActualCost } from '../../src/core/cost-tracker.js';
import { buildCostReport } from '../../src/cli/commands/cost.js';

describe('cost report CLI helper', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-cost-cli-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a report with byProvider rollup', () => {
    recordJob({
      dbPath,
      jobId: 'j1',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'a',
      estUsd: 1.0,
    });
    recordActualCost({ dbPath, jobId: 'j1', actualUsd: 0.95 });
    const report = buildCostReport({ dbPath, periodDays: 30, byProvider: true });
    expect(report.totalJobs).toBe(1);
    expect(report.totalEstUsd).toBe(1.0);
    expect(report.totalActualUsd).toBe(0.95);
    expect(report.byProvider.google).toEqual({ jobs: 1, estUsd: 1.0, actualUsd: 0.95 });
  });

  it('parses --period strings: "30d", "7d", "90d"', () => {
    expect(buildCostReport({ dbPath, period: '30d', byProvider: true }).periodDays).toBe(30);
    expect(buildCostReport({ dbPath, period: '7d', byProvider: true }).periodDays).toBe(7);
    expect(buildCostReport({ dbPath, period: '90d', byProvider: true }).periodDays).toBe(90);
  });

  it('throws on malformed --period', () => {
    expect(() => buildCostReport({ dbPath, period: 'banana', byProvider: true })).toThrow(
      /invalid period/i,
    );
  });
});
