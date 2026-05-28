import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { recordJob } from '../../src/core/cost-tracker.js';
import { handleVideoCostReport } from '../../src/mcp/handlers.js';

describe('media_video_cost_report handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-report-h-'));
    dbPath = join(tmpDir, 'cost.db');
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
  });

  it('returns aggregated report by provider', async () => {
    recordJob({
      dbPath,
      jobId: 'j1',
      provider: 'google',
      model: 'veo-3.1-generate-preview',
      mode: 't2v',
      paramsHash: 'h',
      estUsd: 1.5,
    });
    const result = await handleVideoCostReport({ periodDays: 30 });
    expect(result.totalJobs).toBe(1);
    expect(result.totalEstUsd).toBe(1.5);
    expect(result.byProvider.google.jobs).toBe(1);
  });

  it('defaults periodDays to 30 when omitted', async () => {
    const result = await handleVideoCostReport({});
    expect(result.periodDays).toBe(30);
  });
});
