// tests/unit/core/cost-tracker-daily-spend.test.ts
// TDD for dailySpendUsd + recordImageJob / recordImageActualCost (media-forge
// cost guards, image_jobs ledger). New file — tests/unit/core/cost-tracker.test.ts
// is pre-existing and intentionally left untouched.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordJob,
  recordActualCost,
  recordImageJob,
  recordImageActualCost,
  dailySpendUsd,
} from '../../../src/core/cost-tracker.js';
import { closeDb } from '../../../src/core/db.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ct-daily-spend-'));
  dbPath = join(tmpDir, 'cost.db');
});

afterEach(() => {
  closeDb(dbPath);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('dailySpendUsd', () => {
  it('returns 0 on an empty db (tables created lazily, no rows)', () => {
    expect(dailySpendUsd({ dbPath })).toBe(0);
  });

  it('sums BOTH video_jobs and image_jobs for the given day', () => {
    const today = '2026-06-15';
    recordJob({
      dbPath,
      jobId: 'v1',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1.5,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordImageJob({
      dbPath,
      jobId: 'i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T11:00:00.000Z`,
    });
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBeCloseTo(1.74, 5);
  });

  it('respects the UTC day boundary — a job from a different day is excluded', () => {
    recordJob({
      dbPath,
      jobId: 'v-yesterday',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 5,
      createdAtOverride: '2026-06-14T23:59:59.000Z',
    });
    recordJob({
      dbPath,
      jobId: 'v-today',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1,
      createdAtOverride: '2026-06-15T00:00:00.000Z',
    });
    expect(dailySpendUsd({ dbPath, dateUtc: '2026-06-15' })).toBe(1);
    expect(dailySpendUsd({ dbPath, dateUtc: '2026-06-14' })).toBe(5);
  });

  it('counts a PENDING job (no actual_usd yet) at its estimate via COALESCE', () => {
    const today = '2026-06-15';
    recordImageJob({
      dbPath,
      jobId: 'i-pending',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    // never settled — dailySpendUsd must still count it at est_usd.
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBeCloseTo(0.24, 5);
  });

  it('counts a SETTLED job at its actual_usd, not its (possibly stale) estimate', () => {
    const today = '2026-06-15';
    recordJob({
      dbPath,
      jobId: 'v-settled',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 2.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordActualCost({ dbPath, jobId: 'v-settled', actualUsd: 1.68 });
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBeCloseTo(1.68, 5);
  });

  it('a FAILED image job (finalStatus: "failed", actualUsd: 0) does not count against the cap', () => {
    // Mirrors handleKlingPoll's terminal-failure handling for video_jobs — a
    // generation that threw (safety block, API error, network failure) cost
    // $0 for real. Without this, the row would stay 'pending' at its
    // est_usd forever and dailySpendUsd would count phantom spend against
    // the cap for the rest of the UTC day.
    const today = '2026-06-15';
    recordImageJob({
      dbPath,
      jobId: 'i-failed',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordImageActualCost({ dbPath, jobId: 'i-failed', actualUsd: 0, finalStatus: 'failed' });
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBe(0);
  });

  it('recordImageActualCost flips a pending image job to its actual cost', () => {
    const today = '2026-06-15';
    recordImageJob({
      dbPath,
      jobId: 'i-settle',
      provider: 'google',
      model: 'imagen-4.0-ultra-generate-001',
      paramsHash: 'h',
      estUsd: 0.06,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordImageActualCost({ dbPath, jobId: 'i-settle', actualUsd: 0.06 });
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBeCloseTo(0.06, 5);
  });

  it('defaults dateUtc to today (UTC) when omitted', () => {
    const today = new Date().toISOString().slice(0, 10);
    recordImageJob({
      dbPath,
      jobId: 'i-defaults-today',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T00:00:01.000Z`,
    });
    expect(dailySpendUsd({ dbPath })).toBeCloseTo(0.24, 5);
  });
});
