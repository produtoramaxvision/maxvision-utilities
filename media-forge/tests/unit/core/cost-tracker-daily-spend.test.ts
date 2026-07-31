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
  dailySpendReport,
  monthlySpendUsd,
  allTimeSpendUsd,
  setJobTenant,
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

describe('dailySpendUsd — tenant scoping (multi-tenant cost guard)', () => {
  const today = '2026-06-15';

  it('keeps two tenants isolated — tenant A rows do not count toward tenant B total (image_jobs)', () => {
    recordImageJob({
      dbPath,
      jobId: 'i-tenant-a',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 1.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-a',
    });
    recordImageJob({
      dbPath,
      jobId: 'i-tenant-b',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 5.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-b',
    });
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'tenant-a' })).toBeCloseTo(1.0, 5);
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'tenant-b' })).toBeCloseTo(5.0, 5);
  });

  it('keeps two tenants isolated for video_jobs too (setJobTenant attribution)', () => {
    recordJob({
      dbPath,
      jobId: 'v-tenant-a',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 2.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    setJobTenant({ dbPath, jobId: 'v-tenant-a', tenantId: 'tenant-a' });
    recordJob({
      dbPath,
      jobId: 'v-tenant-b',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 7.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    setJobTenant({ dbPath, jobId: 'v-tenant-b', tenantId: 'tenant-b' });
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'tenant-a' })).toBeCloseTo(2.0, 5);
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'tenant-b' })).toBeCloseTo(7.0, 5);
  });

  it('attributes a NULL tenant_id row (pre-existing/legacy, never tenant-tagged) to "default"', () => {
    // recordJob never sets tenant_id — it stays NULL until setJobTenant runs, which
    // mirrors real pre-existing rows written before the tenant column existed.
    recordJob({
      dbPath,
      jobId: 'v-legacy-null-tenant',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 3.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'default' })).toBeCloseTo(3.0, 5);
    // A different tenant must NOT see the legacy NULL row's spend.
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'some-other-tenant' })).toBe(0);
  });

  it('omitting tenantId still returns the install-wide sum across every tenant', () => {
    recordImageJob({
      dbPath,
      jobId: 'i-install-wide-a',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.5,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-a',
    });
    recordImageJob({
      dbPath,
      jobId: 'i-install-wide-b',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 1.5,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-b',
    });
    expect(dailySpendUsd({ dbPath, dateUtc: today })).toBeCloseTo(2.0, 5);
  });

  it('applies the tenant filter to BOTH image_jobs and video_jobs at once, not just one table', () => {
    recordJob({
      dbPath,
      jobId: 'v-mixed-a',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 4.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    setJobTenant({ dbPath, jobId: 'v-mixed-a', tenantId: 'tenant-a' });
    recordImageJob({
      dbPath,
      jobId: 'i-mixed-a',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-a',
    });
    recordImageJob({
      dbPath,
      jobId: 'i-mixed-b',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 9.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-b',
    });
    // tenant-a's total is its video row PLUS its image row — tenant-b's $9 image
    // spend must not leak in from either table.
    expect(dailySpendUsd({ dbPath, dateUtc: today, tenantId: 'tenant-a' })).toBeCloseTo(4.24, 5);
  });
});

// ---------------------------------------------------------------------------
// P1 fix (2026-07-29): `media-forge cost --today` always reported $0.00
// because the CLI read a cost.jsonl file nothing in production writes. Fixed
// by pointing the CLI at these SQLite-backed queries instead. dailySpendUsd
// above stays number-only (its existing call sites and assertions need only
// the bare total); these new functions additionally return the row count the
// CLI displays as "N entries", covering BOTH video_jobs and image_jobs.
// ---------------------------------------------------------------------------
describe('dailySpendReport', () => {
  it('returns { usd: 0, entries: 0 } on an empty db', () => {
    expect(dailySpendReport({ dbPath })).toEqual({ usd: 0, entries: 0 });
  });

  it('sums usd AND counts rows across BOTH video_jobs and image_jobs for the given day', () => {
    const today = '2026-06-15';
    recordJob({
      dbPath,
      jobId: 'dr-v1',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1.5,
      createdAtOverride: `${today}T10:00:00.000Z`,
    });
    recordImageJob({
      dbPath,
      jobId: 'dr-i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: `${today}T11:00:00.000Z`,
    });
    recordImageJob({
      dbPath,
      jobId: 'dr-i2',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.06,
      createdAtOverride: `${today}T12:00:00.000Z`,
    });
    const report = dailySpendReport({ dbPath, dateUtc: today });
    expect(report.usd).toBeCloseTo(1.8, 5);
    expect(report.entries).toBe(3);
  });

  it('excludes rows from a different UTC day', () => {
    recordJob({
      dbPath,
      jobId: 'dr-v-yesterday',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 5,
      createdAtOverride: '2026-06-14T23:59:59.000Z',
    });
    const report = dailySpendReport({ dbPath, dateUtc: '2026-06-15' });
    expect(report).toEqual({ usd: 0, entries: 0 });
  });

  it('scopes to a tenant when tenantId is given', () => {
    const today = '2026-06-15';
    recordImageJob({
      dbPath,
      jobId: 'dr-tenant-a',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 1.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-a',
    });
    recordImageJob({
      dbPath,
      jobId: 'dr-tenant-b',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 5.0,
      createdAtOverride: `${today}T10:00:00.000Z`,
      tenantId: 'tenant-b',
    });
    expect(dailySpendReport({ dbPath, dateUtc: today, tenantId: 'tenant-a' })).toEqual({ usd: 1.0, entries: 1 });
  });
});

describe('monthlySpendUsd', () => {
  it('returns { usd: 0, entries: 0 } on an empty db', () => {
    expect(monthlySpendUsd({ dbPath })).toEqual({ usd: 0, entries: 0 });
  });

  it('sums usd AND counts rows across BOTH tables for the given UTC month, excluding other months', () => {
    recordJob({
      dbPath,
      jobId: 'mo-v1',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 2.0,
      createdAtOverride: '2026-06-01T00:00:00.000Z',
    });
    recordImageJob({
      dbPath,
      jobId: 'mo-i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: '2026-06-30T23:59:59.000Z',
    });
    // Outside the month — must not count.
    recordJob({
      dbPath,
      jobId: 'mo-v-other-month',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 99,
      createdAtOverride: '2026-07-01T00:00:00.000Z',
    });
    const report = monthlySpendUsd({ dbPath, monthUtc: '2026-06' });
    expect(report.usd).toBeCloseTo(2.24, 5);
    expect(report.entries).toBe(2);
  });

  it('scopes to a tenant when tenantId is given', () => {
    recordImageJob({
      dbPath,
      jobId: 'mo-tenant-a',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 1.0,
      createdAtOverride: '2026-06-05T00:00:00.000Z',
      tenantId: 'tenant-a',
    });
    recordImageJob({
      dbPath,
      jobId: 'mo-tenant-b',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 5.0,
      createdAtOverride: '2026-06-05T00:00:00.000Z',
      tenantId: 'tenant-b',
    });
    expect(monthlySpendUsd({ dbPath, monthUtc: '2026-06', tenantId: 'tenant-a' })).toEqual({ usd: 1.0, entries: 1 });
  });
});

describe('allTimeSpendUsd', () => {
  it('returns { usd: 0, entries: 0 } on an empty db', () => {
    expect(allTimeSpendUsd({ dbPath })).toEqual({ usd: 0, entries: 0 });
  });

  it('sums usd AND counts rows across BOTH tables regardless of date', () => {
    recordJob({
      dbPath,
      jobId: 'at-v1',
      provider: 'kling',
      model: 'kling-v3-pro',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 2.0,
      createdAtOverride: '2020-01-01T00:00:00.000Z',
    });
    recordImageJob({
      dbPath,
      jobId: 'at-i1',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 0.24,
      createdAtOverride: '2030-12-31T23:59:59.000Z',
    });
    const report = allTimeSpendUsd({ dbPath });
    expect(report.usd).toBeCloseTo(2.24, 5);
    expect(report.entries).toBe(2);
  });

  it('scopes to a tenant when tenantId is given', () => {
    recordImageJob({
      dbPath,
      jobId: 'at-tenant-a',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 1.0,
      createdAtOverride: '2020-01-01T00:00:00.000Z',
      tenantId: 'tenant-a',
    });
    recordImageJob({
      dbPath,
      jobId: 'at-tenant-b',
      provider: 'google',
      model: 'gemini-3-pro-image-preview',
      paramsHash: 'h',
      estUsd: 5.0,
      createdAtOverride: '2020-01-01T00:00:00.000Z',
      tenantId: 'tenant-b',
    });
    expect(allTimeSpendUsd({ dbPath, tenantId: 'tenant-a' })).toEqual({ usd: 1.0, entries: 1 });
  });
});
