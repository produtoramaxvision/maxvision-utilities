// tests/unit/video/providers/bytedance-webhook-gallery.test.ts
// SE2 Task 4b: bytedance webhook handler gallery integration.
//
// IMPORTANT ARCHITECTURE NOTE:
// Bytedance cost is reconciled by pollStatus (not the webhook), because fal.ai's route-map
// (tier, resolution, duration) lives in BytedanceSeedanceProvider.pollStatus(). At webhook time
// actual_usd is always NULL → recordGalleryFromJob emits 'no-cost' skip-log and returns.
// Gallery write for bytedance happens only after the first media_video_poll → pollStatus settles
// actual_usd. This test verifies that behaviour: the handler does NOT insert a gallery row on
// webhook receipt, and the skip-log is emitted correctly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordJob,
  setJobTenant,
  recordActualCost,
} from '../../../../src/core/cost-tracker.js';
import { closeDb } from '../../../../src/core/db.js';
import { createBytedanceWebhookHandler } from '../../../../src/video/providers/bytedance-webhook-handler.js';
import type { GalleryStore } from '../../../../src/gallery/gallery-store.js';
import type { WebhookContext } from '../../../../src/video/providers/webhook-router.js';

let tmpDir: string;
let dbPath: string;
let outputsDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'bdt-wh-'));
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

function makeFakeFetch() {
  return vi.fn().mockImplementation(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
  }));
}

// Valid bytedance payload with native_task_id matching what we seed in the DB.
const NATIVE_TASK_ID = 'fal-req-abc123';
function makeBytedancePayload() {
  return {
    request_id: NATIVE_TASK_ID,
    gateway_request_id: 'gw-abc123',
    status: 'OK',
    payload: { video: { url: 'http://cdn.fal.ai/video.mp4', content_type: 'video/mp4', duration: 5 } },
  };
}

describe('bytedance-webhook-handler SE2 gallery integration', () => {
  it('does NOT insert gallery row at webhook time (actual_usd is NULL — cost not yet settled)', async () => {
    // Bytedance cost comes from pollStatus, not from the webhook.
    // So at webhook time actual_usd IS NULL → recordGalleryFromJob skips with 'no-cost'.
    const jobId = 'bdt-j-1';
    recordJob({ dbPath, jobId, provider: 'bytedance', model: 'seedance-01-lite', mode: 't2v', paramsHash: 'h', estUsd: 0.1, nativeTaskId: NATIVE_TASK_ID });
    setJobTenant({ dbPath, jobId, tenantId: 't-1' });
    // No recordActualCost → actual_usd stays NULL

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const testLogger = makeLogger();

    const handler = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      awaitBackgroundDownload: true,
      galleryStore: store,
      logger: testLogger,
    });

    const ctx: WebhookContext = {
      provider: 'bytedance',
      jobId,
      payload: makeBytedancePayload(),
      headers: {},
    };

    await handler(ctx);

    // No gallery row inserted (cost not yet settled)
    expect(insertSpy).not.toHaveBeenCalled();
    // But a structured skip-log is emitted
    expect(testLogger.warn).toHaveBeenCalledWith('gallery skip', expect.objectContaining({ reason: 'no-cost' }));
  });

  it('inserts gallery row when actual_usd has been pre-settled (e.g. by a prior pollStatus)', async () => {
    // If for some reason actual_usd IS settled (e.g. a prior pollStatus ran), the gallery row
    // SHOULD be written. This validates the helper logic via the bytedance wiring.
    const jobId = 'bdt-j-presettled';
    recordJob({ dbPath, jobId, provider: 'bytedance', model: 'seedance-01-lite', mode: 't2v', paramsHash: 'h', estUsd: 0.1, nativeTaskId: NATIVE_TASK_ID });
    setJobTenant({ dbPath, jobId, tenantId: 't-2' });
    recordActualCost({ dbPath, jobId, actualUsd: 0.08 }); // pre-settled

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const testLogger = makeLogger();

    const handler = createBytedanceWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      awaitBackgroundDownload: true,
      galleryStore: store,
      logger: testLogger,
    });

    const ctx: WebhookContext = {
      provider: 'bytedance',
      jobId,
      payload: makeBytedancePayload(),
      headers: {},
    };

    await handler(ctx);

    expect(insertSpy).toHaveBeenCalledOnce();
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      generationId: jobId,
      tenantId: 't-2',
      provider: 'bytedance',
      costUsd: 0.08,
      minioKey: `outputs/${jobId}.mp4`,
      status: 'completed',
    }));
    expect(testLogger.warn).not.toHaveBeenCalled();
  });
});
