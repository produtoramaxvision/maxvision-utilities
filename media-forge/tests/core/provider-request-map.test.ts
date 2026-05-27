import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import {
  recordRequestMapping,
  findJobIdByRequestId,
  findRequestIdByJobId,
  clearRequestMapCache,
} from '../../src/core/provider-request-map.js';

describe('provider-request-map', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-prm-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
    clearRequestMapCache();
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records and recovers a mapping in both directions', () => {
    recordRequestMapping({
      dbPath,
      jobId: 'hf-job-1',
      provider: 'higgsfield',
      providerRequestId: 'req-aaa',
    });
    expect(findJobIdByRequestId({ dbPath, provider: 'higgsfield', providerRequestId: 'req-aaa' })).toBe(
      'hf-job-1',
    );
    expect(findRequestIdByJobId({ dbPath, jobId: 'hf-job-1' })).toBe('req-aaa');
  });

  it('returns undefined for unknown request_id', () => {
    expect(
      findJobIdByRequestId({ dbPath, provider: 'higgsfield', providerRequestId: 'ghost' }),
    ).toBeUndefined();
  });

  it('different providers can share the same providerRequestId without collision', () => {
    recordRequestMapping({
      dbPath,
      jobId: 'job-h',
      provider: 'higgsfield',
      providerRequestId: 'same-id',
    });
    recordRequestMapping({
      dbPath,
      jobId: 'job-k',
      provider: 'kling',
      providerRequestId: 'same-id',
    });
    expect(findJobIdByRequestId({ dbPath, provider: 'higgsfield', providerRequestId: 'same-id' })).toBe(
      'job-h',
    );
    expect(findJobIdByRequestId({ dbPath, provider: 'kling', providerRequestId: 'same-id' })).toBe(
      'job-k',
    );
  });

  it('in-memory cache returns the mapping consistently across lookups', () => {
    recordRequestMapping({
      dbPath,
      jobId: 'cache-hit',
      provider: 'higgsfield',
      providerRequestId: 'req-cache',
    });
    const first = findJobIdByRequestId({
      dbPath,
      provider: 'higgsfield',
      providerRequestId: 'req-cache',
    });
    const second = findJobIdByRequestId({
      dbPath,
      provider: 'higgsfield',
      providerRequestId: 'req-cache',
    });
    expect(first).toBe(second);
    expect(first).toBe('cache-hit');
  });

  it('clearRequestMapCache forces next lookup to re-query SQLite (still returns same persisted value)', () => {
    recordRequestMapping({
      dbPath,
      jobId: 'persist',
      provider: 'higgsfield',
      providerRequestId: 'req-p',
    });
    findJobIdByRequestId({ dbPath, provider: 'higgsfield', providerRequestId: 'req-p' });
    clearRequestMapCache();
    expect(
      findJobIdByRequestId({ dbPath, provider: 'higgsfield', providerRequestId: 'req-p' }),
    ).toBe('persist');
  });
});
