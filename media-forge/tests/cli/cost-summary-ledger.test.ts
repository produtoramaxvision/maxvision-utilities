// tests/cli/cost-summary-ledger.test.ts
// P1 fix (2026-07-29): `media-forge cost summary --today` always reported
// $0.00. Root cause chain (see TODOS.md):
//   1. OutputManager.appendCostLog has zero production callers.
//   2. It wrote <jobDir>/cost.jsonl, one file per job.
//   3. The CLI read <projectDir>/cost.jsonl — a different path nothing ever
//      wrote to.
// Fixed by repointing the `summary` command at the SQLite ledger
// (video_jobs + image_jobs) via buildCostSummary -> dailySpendReport /
// monthlySpendUsd / allTimeSpendUsd in src/core/cost-tracker.ts. This test
// proves the CLI now reports a NON-ZERO total when the ledger actually has
// rows for the day — the exact case the old cost.jsonl-based path always
// reported as $0.00 (see the sibling `getCostSummary` baseline test in
// tests/unit/cli/utility.test.ts, deliberately left untouched: it exercises
// the old cost.jsonl-backed helper directly, not the CLI's registered command).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../src/core/db.js';
import { recordJob, recordActualCost, recordImageJob, recordImageActualCost } from '../../src/core/cost-tracker.js';
import { buildCostSummary } from '../../src/cli/commands/cost.js';

describe('buildCostSummary — SQLite-backed CLI cost summary', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-cost-summary-ledger-'));
    dbPath = join(tmpDir, 'cost.db');
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore
    }
  });

  it('--today reports a non-zero total and correct entry count when the ledger has rows for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    recordJob({
      dbPath,
      jobId: 'cs-v1',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1.5,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordActualCost({ dbPath, jobId: 'cs-v1', actualUsd: 1.5 });
    recordImageJob({
      dbPath,
      jobId: 'cs-i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T11:00:00.000Z`,
    });
    recordImageActualCost({ dbPath, jobId: 'cs-i1', actualUsd: 0.24 });

    const result = buildCostSummary({ dbPath, today: true });
    expect(result.date).toBe(today);
    expect(result.usd).toBeCloseTo(1.74, 5);
    expect(result.entries).toBe(2);
    expect(result.usd).toBeGreaterThan(0);
  });

  it('returns { usd: 0, entries: 0 } for --today when the ledger has no rows for today (fresh db)', () => {
    const result = buildCostSummary({ dbPath, today: true });
    expect(result.usd).toBe(0);
    expect(result.entries).toBe(0);
  });

  it('--month reports the current-month total across both tables', () => {
    const month = new Date().toISOString().slice(0, 7);
    recordImageJob({
      dbPath,
      jobId: 'cs-month-i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.06,
      createdAtOverride: `${month}-01T00:00:00.000Z`,
    });
    recordImageActualCost({ dbPath, jobId: 'cs-month-i1', actualUsd: 0.06 });

    const result = buildCostSummary({ dbPath, month: true });
    expect(result.date).toBe(month);
    expect(result.usd).toBeCloseTo(0.06, 5);
    expect(result.entries).toBe(1);
  });

  it('defaults to all-time when neither --today nor --month is set', () => {
    recordJob({
      dbPath,
      jobId: 'cs-alltime-v1',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 2.0,
      createdAtOverride: '2020-01-01T00:00:00.000Z',
    });
    recordActualCost({ dbPath, jobId: 'cs-alltime-v1', actualUsd: 2.0 });

    const result = buildCostSummary({ dbPath });
    expect(result.date).toBe('all-time');
    expect(result.usd).toBeCloseTo(2.0, 5);
    expect(result.entries).toBe(1);
  });

  it('resolves dbPath from projectDir (MEDIA_FORGE_PROJECT_DIR-style override) when dbPath is not given directly', () => {
    const today = new Date().toISOString().slice(0, 10);
    recordImageJob({
      dbPath,
      jobId: 'cs-projectdir-i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordImageActualCost({ dbPath, jobId: 'cs-projectdir-i1', actualUsd: 0.24 });

    // dbPath omitted — resolved internally as <projectDir>/cost.db, matching
    // the same tmpDir the test wrote the ledger under.
    const result = buildCostSummary({ projectDir: tmpDir, today: true });
    expect(result.usd).toBeCloseTo(0.24, 5);
    expect(result.entries).toBe(1);
  });
});
