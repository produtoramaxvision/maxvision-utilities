// tests/unit/gallery/record-from-job.test.ts
// TDD for recordGalleryFromJob helper (SE2 Task 4).
// Uses a tmp sqlite db seeded with recordJob + setJobTenant + recordActualCost.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordJob,
  setJobTenant,
  recordActualCost,
} from '../../../src/core/cost-tracker.js';
import { closeDb } from '../../../src/core/db.js';
import { recordGalleryFromJob } from '../../../src/gallery/record-from-job.js';
import type { GalleryStore } from '../../../src/gallery/gallery-store.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rfj-test-'));
  dbPath = join(tmpDir, 'cost.db');
});

afterEach(() => {
  closeDb(dbPath);
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeGalleryStore(insertImpl?: () => Promise<void>): GalleryStore {
  return {
    insertGeneration: insertImpl ?? vi.fn().mockResolvedValue(undefined),
    listGenerations: vi.fn(),
    generationsInPeriod: vi.fn(),
  } as unknown as GalleryStore;
}

function makeLogger() {
  return { warn: vi.fn() };
}

describe('recordGalleryFromJob', () => {
  it('happy: job has tenant + cost → insertGeneration called with correct fields', async () => {
    recordJob({ dbPath, jobId: 'j-1', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId: 'j-1', tenantId: 't-1' });
    recordActualCost({ dbPath, jobId: 'j-1', actualUsd: 0.63, actualCredits: 63 });

    const store = makeGalleryStore();
    const logger = makeLogger();
    const insertSpy = vi.spyOn(store, 'insertGeneration');

    await recordGalleryFromJob({
      galleryStore: store,
      dbPath,
      jobId: 'j-1',
      minioKey: 'outputs/j-1.mp4',
      logger,
    });

    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      generationId: 'j-1',
      tenantId: 't-1',
      provider: 'kling',
      costUsd: 0.63,
      minioKey: 'outputs/j-1.mp4',
      status: 'completed',
    }));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('null tenant → tenantId defaults to "default"', async () => {
    recordJob({ dbPath, jobId: 'j-notenant', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    recordActualCost({ dbPath, jobId: 'j-notenant', actualUsd: 0.5 });

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    await recordGalleryFromJob({ galleryStore: store, dbPath, jobId: 'j-notenant', logger: makeLogger() });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'default' }));
  });

  it('no cost (actual_usd null) → NO insert, logger.warn called with reason no-cost', async () => {
    recordJob({ dbPath, jobId: 'j-nocost', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId: 'j-nocost', tenantId: 't-1' });
    // no recordActualCost

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const logger = makeLogger();

    await recordGalleryFromJob({ galleryStore: store, dbPath, jobId: 'j-nocost', logger });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('gallery skip', expect.objectContaining({ reason: 'no-cost' }));
  });

  it('job missing → NO insert, logger.warn called with reason no-job', async () => {
    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const logger = makeLogger();

    await recordGalleryFromJob({ galleryStore: store, dbPath, jobId: 'nonexistent', logger });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('gallery skip', expect.objectContaining({ reason: 'no-job' }));
  });

  it('no galleryStore → no-op, no throw, no warn', async () => {
    recordJob({ dbPath, jobId: 'j-nogs', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    recordActualCost({ dbPath, jobId: 'j-nogs', actualUsd: 0.5 });

    const logger = makeLogger();
    await expect(
      recordGalleryFromJob({ dbPath, jobId: 'j-nogs', logger }) // no galleryStore
    ).resolves.toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('insert throws → caught, logger.warn called with reason insert-failed (webhook must not fail)', async () => {
    recordJob({ dbPath, jobId: 'j-throw', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId: 'j-throw', tenantId: 't-1' });
    recordActualCost({ dbPath, jobId: 'j-throw', actualUsd: 0.5 });

    const store = makeGalleryStore(async () => { throw new Error('pg down'); });
    const logger = makeLogger();

    await expect(
      recordGalleryFromJob({ galleryStore: store, dbPath, jobId: 'j-throw', logger })
    ).resolves.toBeUndefined(); // must not throw

    expect(logger.warn).toHaveBeenCalledWith('gallery skip', expect.objectContaining({ reason: 'insert-failed' }));
  });

  it('idempotent: calling twice resolves without extra warnings (dedup via ON CONFLICT is gallery side)', async () => {
    recordJob({ dbPath, jobId: 'j-idem', provider: 'kling', model: 'kling-v3', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId: 'j-idem', tenantId: 't-1' });
    recordActualCost({ dbPath, jobId: 'j-idem', actualUsd: 0.5 });

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const logger = makeLogger();

    await recordGalleryFromJob({ galleryStore: store, dbPath, jobId: 'j-idem', logger });
    await recordGalleryFromJob({ galleryStore: store, dbPath, jobId: 'j-idem', logger });

    expect(insertSpy).toHaveBeenCalledTimes(2); // helper calls insert both times; dedup is gallery's ON CONFLICT
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
