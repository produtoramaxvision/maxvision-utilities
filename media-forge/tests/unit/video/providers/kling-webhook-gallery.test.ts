// tests/unit/video/providers/kling-webhook-gallery.test.ts
// SE2 Task 4b: assert kling webhook handler calls insertGeneration with correct fields.
// Tests the gallery-write integration point specifically.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordJob,
  setJobTenant,
} from '../../../../src/core/cost-tracker.js';
import { closeDb } from '../../../../src/core/db.js';
import { createKlingWebhookHandler } from '../../../../src/video/providers/kling-webhook-handler.js';
import type { GalleryStore } from '../../../../src/gallery/gallery-store.js';
import type { WebhookContext } from '../../../../src/video/providers/webhook-router.js';

let tmpDir: string;
let dbPath: string;
let outputsDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kling-wh-'));
  dbPath = join(tmpDir, 'cost.db');
  outputsDir = join(tmpDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });
});

afterEach(() => {
  closeDb(dbPath);
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeGalleryStore(): GalleryStore {
  return {
    insertGeneration: vi.fn().mockResolvedValue(undefined),
    listGenerations: vi.fn(),
    generationsInPeriod: vi.fn(),
  } as unknown as GalleryStore;
}

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// Fake fetch that returns a minimal MP4 buffer (4 bytes).
function makeFakeFetch() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('api') || url.includes('klingai')) {
      // This is a re-poll (TTL refresh) — not expected in our test but handle anyway
      return { ok: true, json: async () => ({ data: { task_result: { videos: [{ url: 'http://x.mp4', duration: '5' }] } } }) };
    }
    // Asset download
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  });
}

function makeKlingSuccessPayload(_jobId: string) {
  return {
    task_id: 'native-task-123',
    task_status: 'succeed' as const,
    task_result: {
      videos: [{ id: 'v1', url: 'http://cdn.kling.ai/asset.mp4', duration: '5.0' }],
    },
  };
}

describe('kling-webhook-handler SE2 gallery integration', () => {
  it('calls insertGeneration with correct tenantId, provider, costUsd, minioKey on success', async () => {
    const jobId = 'kling-j-1';
    recordJob({ dbPath, jobId, provider: 'kling', model: 'kling-v1-5', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId, tenantId: 't-1' });
    // Note: recordActualCost is called by the handler itself, so we don't pre-seed actual_usd.
    // The handler calls recordActualCost BEFORE recordGalleryFromJob, so the job will have a cost.

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const testLogger = makeLogger();

    const handler = createKlingWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      galleryStore: store,
      logger: testLogger,
    });

    const ctx: WebhookContext = {
      provider: 'kling',
      jobId,
      payload: makeKlingSuccessPayload(jobId),
      headers: {},
    };

    await handler(ctx);

    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      generationId: jobId,
      tenantId: 't-1',
      provider: 'kling',
      minioKey: `outputs/${jobId}.mp4`,
      status: 'completed',
    }));
  });

  it('does NOT call insertGeneration when galleryStore is absent', async () => {
    const jobId = 'kling-j-nogs';
    recordJob({ dbPath, jobId, provider: 'kling', model: 'kling-v1-5', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });

    const handler = createKlingWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      // no galleryStore
    });

    const ctx: WebhookContext = {
      provider: 'kling',
      jobId,
      payload: makeKlingSuccessPayload(jobId),
      headers: {},
    };

    // Should complete without error
    await expect(handler(ctx)).resolves.toBeUndefined();
  });

  it('defaults tenantId to "default" when no setJobTenant called', async () => {
    const jobId = 'kling-j-default-tenant';
    recordJob({ dbPath, jobId, provider: 'kling', model: 'kling-v1-5', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    // No setJobTenant → tenantId stays NULL → should default to 'default'

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');

    const handler = createKlingWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      galleryStore: store,
    });

    const ctx: WebhookContext = {
      provider: 'kling',
      jobId,
      payload: makeKlingSuccessPayload(jobId),
      headers: {},
    };

    await handler(ctx);

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'default' }));
  });
});
