// tests/integration/se2-gallery-webhook.int.test.ts
// SE2 end-to-end: submit → annotate tenant → webhook → gallery row with correct tenant + minio_key.
// Uses embedded-postgres (via default vitest globalSetup) for gallery + tmp sqlite for video_jobs.
//
// Task 6: submit-annotate → kling webhook → gallery row (tenant-attributed, idempotent).
// Task 4c: dual-writer test — sync kling_download write first, then webhook → exactly ONE row.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Pool } from 'pg';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPgMigrations } from '../../src/core/pg-migrate.js';
import { GalleryStore } from '../../src/gallery/gallery-store.js';
import {
  recordJob,
  setJobTenant,
} from '../../src/core/cost-tracker.js';
import { closeDb } from '../../src/core/db.js';
import { createKlingWebhookHandler } from '../../src/video/providers/kling-webhook-handler.js';
import type { WebhookContext } from '../../src/video/providers/webhook-router.js';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

const SCHEMA = 'mf_se2_webhook_it';

d('SE2: gallery-webhook integration', () => {
  let pool: Pool;
  let galleryStore: GalleryStore;
  let tmpDir: string;
  let dbPath: string;
  let outputsDir: string;

  beforeAll(async () => {
    // Isolated schema — no DDL conflict with other parallel integration tests.
    const admin = new Pool({ connectionString: url });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.end();

    pool = new Pool({ connectionString: url, options: `-c search_path=${SCHEMA}` });
    await runPgMigrations(pool);
    galleryStore = new GalleryStore(pool);

    // Tmp sqlite for video_jobs
    tmpDir = mkdtempSync(join(tmpdir(), 'se2-int-'));
    dbPath = join(tmpDir, 'cost.db');
    outputsDir = join(tmpDir, 'outputs');
    mkdirSync(outputsDir, { recursive: true });
  });

  afterAll(async () => {
    closeDb(dbPath);
    await pool.end();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Clean gallery rows between tests for isolation.
    await pool.query('DELETE FROM generations');
  });

  // Fake fetch: returns a 4-byte buffer for asset download.
  function makeFakeFetch() {
    return async (_url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    }) as unknown as Response;
  }

  function makeKlingPayload() {
    return {
      task_id: 'native-task-se2',
      task_status: 'succeed' as const,
      task_result: {
        videos: [{ id: 'v1', url: 'http://cdn.kling.ai/se2.mp4', duration: '5.0' }],
      },
    };
  }

  it('Task 6: submit→annotate→webhook→gallery row with correct tenant, provider, cost, minio_key', async () => {
    const jobId = 'se2-j-1';
    recordJob({ dbPath, jobId, provider: 'kling', model: 'kling-v1-5', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId, tenantId: 't-1' });
    // Note: recordActualCost is called by the webhook handler itself — no pre-seeding needed.

    const handler = createKlingWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      galleryStore,
    });

    const ctx: WebhookContext = {
      provider: 'kling',
      jobId,
      payload: makeKlingPayload(),
      headers: {},
    };

    await handler(ctx);

    // Assert gallery row exists with correct fields
    const page = await galleryStore.listGenerations({ tenantId: 't-1', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);
    const row = page.items[0]!;
    expect(row.generationId).toBe(jobId);
    expect(row.tenantId).toBe('t-1');
    expect(row.provider).toBe('kling');
    expect(row.costUsd).toBeGreaterThan(0); // computed from duration × rate
    expect(row.status).toBe('completed');
    // D3: minio_key must be set
    expect(row.minioKey).toBe(`outputs/${jobId}.mp4`);
  });

  it('Task 6 idempotency: invoking the webhook twice → exactly ONE gallery row', async () => {
    const jobId = 'se2-j-idem';
    recordJob({ dbPath, jobId, provider: 'kling', model: 'kling-v1-5', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId, tenantId: 't-1' });

    const handler = createKlingWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      galleryStore,
    });

    const ctx: WebhookContext = {
      provider: 'kling',
      jobId,
      payload: makeKlingPayload(),
      headers: {},
    };

    await handler(ctx);
    await handler(ctx); // second call — idempotent via ON CONFLICT DO NOTHING

    const page = await galleryStore.listGenerations({ tenantId: 't-1', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1); // exactly one row
  });

  it('Task 4c dual-writer: sync write first (with minio_key) then webhook → exactly ONE row, minio_key present', async () => {
    const jobId = 'se2-j-dual';
    recordJob({ dbPath, jobId, provider: 'kling', model: 'kling-v1-5', mode: 't2v', paramsHash: 'h', estUsd: 0.5 });
    setJobTenant({ dbPath, jobId, tenantId: 't-1' });

    // Simulate the sync kling_download write (first writer).
    // Matches what handlers.ts media_kling_download now writes (Task 4c: includes minio_key).
    await galleryStore.insertGeneration({
      generationId: jobId,
      tenantId: 't-1',
      model: 'kling',
      provider: 'kling',
      costUsd: 0.63,
      creditsDebited: 0,
      creditValueUsd: 0.01,
      minioKey: `outputs/${jobId}.mp4`,
      status: 'completed',
    });

    // Now fire the webhook (second writer — will hit ON CONFLICT DO NOTHING).
    const handler = createKlingWebhookHandler({
      dbPath,
      outputsDir,
      fetchImpl: makeFakeFetch() as unknown as typeof fetch,
      galleryStore,
    });

    const ctx: WebhookContext = {
      provider: 'kling',
      jobId,
      payload: makeKlingPayload(),
      headers: {},
    };

    await handler(ctx);

    // Assert exactly ONE row
    const page = await galleryStore.listGenerations({ tenantId: 't-1', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);

    // Assert minio_key is present (whichever writer won, the key is present — Task 4c fix)
    expect(page.items[0]!.minioKey).toBe(`outputs/${jobId}.mp4`);
  });
});
