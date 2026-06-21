// tests/unit/video/providers/higgsfield-webhook-gallery.test.ts
// SE2 Task 4b: higgsfield webhook handler gallery integration.
//
// IMPORTANT ARCHITECTURE NOTE:
// Higgsfield webhook is a logging stub — no cost is recorded here (full payload parsing
// deferred to P14.1 when the Higgsfield webhook schema stabilizes). At webhook time
// actual_usd is always NULL → recordGalleryFromJob emits 'no-cost' skip-log and returns.
// This test verifies that behaviour: handler does not insert a gallery row, skip-log is emitted.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordJob,
  setJobTenant,
} from '../../../../src/core/cost-tracker.js';
import { closeDb } from '../../../../src/core/db.js';
import { createHiggsfieldWebhookHandler } from '../../../../src/video/providers/higgsfield-webhook-handler.js';
import type { GalleryStore } from '../../../../src/gallery/gallery-store.js';
import type { WebhookContext } from '../../../../src/video/providers/webhook-router.js';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hf-wh-'));
  dbPath = join(tmpDir, 'cost.db');
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

describe('higgsfield-webhook-handler SE2 gallery integration', () => {
  it('does NOT insert gallery row (logging stub — no cost recorded at webhook time)', async () => {
    const jobId = 'hf-j-1';
    recordJob({ dbPath, jobId, provider: 'higgsfield', model: 'soul-3', mode: 't2v', paramsHash: 'h', estUsd: 0.3 });
    setJobTenant({ dbPath, jobId, tenantId: 't-1' });
    // No recordActualCost — higgsfield webhook has no cost recording

    const store = makeGalleryStore();
    const insertSpy = vi.spyOn(store, 'insertGeneration');
    const testLogger = makeLogger();

    const handler = createHiggsfieldWebhookHandler({
      dbPath,
      galleryStore: store,
      logger: testLogger,
    });

    const ctx: WebhookContext = {
      provider: 'higgsfield',
      jobId,
      payload: { status: 'completed' },
      headers: {},
    };

    await handler(ctx);

    // No gallery row (no cost at webhook time)
    expect(insertSpy).not.toHaveBeenCalled();
    // Structured skip-log emitted
    expect(testLogger.warn).toHaveBeenCalledWith('gallery skip', expect.objectContaining({ reason: 'no-cost' }));
  });

  it('does not throw when galleryStore is absent', async () => {
    const jobId = 'hf-j-nogs';
    const handler = createHiggsfieldWebhookHandler({ dbPath });
    const ctx: WebhookContext = {
      provider: 'higgsfield',
      jobId,
      payload: {},
      headers: {},
    };
    await expect(handler(ctx)).resolves.toBeUndefined();
  });
});
