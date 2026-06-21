// tests/unit/core/cost-tracker.test.ts
// TDD for setJobTenant + getJobRecord.tenantId (SE2).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordJob,
  recordActualCost,
  getJobRecord,
  setJobTenant,
} from '../../../src/core/cost-tracker.js';
import { closeDb } from '../../../src/core/db.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ct-test-'));
  dbPath = join(tmpDir, 'cost.db');
});

afterEach(() => {
  // Close the SQLite connection before cleanup to release Windows file lock.
  closeDb(dbPath);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getJobRecord (baseline)', () => {
  it('returns null for unknown jobId', () => {
    expect(getJobRecord({ dbPath, jobId: 'unknown' })).toBeNull();
  });

  it('returns a record after recordJob', () => {
    recordJob({ dbPath, jobId: 'j1', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    const rec = getJobRecord({ dbPath, jobId: 'j1' });
    expect(rec).not.toBeNull();
    expect(rec?.jobId).toBe('j1');
    expect(rec?.provider).toBe('kling');
    expect(rec?.estUsd).toBe(0.5);
  });

  it('actualUsd is null before recordActualCost', () => {
    recordJob({ dbPath, jobId: 'j2', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    expect(getJobRecord({ dbPath, jobId: 'j2' })?.actualUsd).toBeNull();
  });

  it('actualUsd is set after recordActualCost', () => {
    recordJob({ dbPath, jobId: 'j3', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    recordActualCost({ dbPath, jobId: 'j3', actualUsd: 0.63 });
    expect(getJobRecord({ dbPath, jobId: 'j3' })?.actualUsd).toBe(0.63);
  });
});

describe('SE2: setJobTenant + getJobRecord.tenantId', () => {
  it('setJobTenant annotates the job and getJobRecord returns tenantId', () => {
    recordJob({ dbPath, jobId: 'j-se2', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 1 });
    setJobTenant({ dbPath, jobId: 'j-se2', tenantId: 't-1' });
    expect(getJobRecord({ dbPath, jobId: 'j-se2' })?.tenantId).toBe('t-1');
  });

  it('getJobRecord tenantId is null when not annotated', () => {
    recordJob({ dbPath, jobId: 'j-none', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 1 });
    expect(getJobRecord({ dbPath, jobId: 'j-none' })?.tenantId).toBeNull();
  });

  it('setJobTenant for an unknown jobId is a no-op (does not throw)', () => {
    expect(() => setJobTenant({ dbPath, jobId: 'nonexistent', tenantId: 't-2' })).not.toThrow();
  });

  it('setJobTenant can be overwritten (last write wins)', () => {
    recordJob({ dbPath, jobId: 'j-update', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 1 });
    setJobTenant({ dbPath, jobId: 'j-update', tenantId: 't-1' });
    setJobTenant({ dbPath, jobId: 'j-update', tenantId: 't-2' });
    expect(getJobRecord({ dbPath, jobId: 'j-update' })?.tenantId).toBe('t-2');
  });
});
