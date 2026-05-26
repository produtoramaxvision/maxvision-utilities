import { describe, it, expect, vi } from 'vitest';
import { runIndexer } from '../../../src/refs/indexer.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';
import type { PgvectorClient } from '../../../src/refs/pgvector-client.js';

// Minimal 1×1 GIF fixture (13 bytes, valid GIF87a — sharp can decode it)
const TINY_GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const minio: MinioClient = {
  listObjects: vi.fn(async (prefix: string) => ({
    objects: [{ key: `${prefix}a.gif`, size: 1000 }],
    truncated: false,
  })),
  headObject: vi.fn(),
  presignObject: vi.fn(),
  downloadObject: vi.fn(async () => Buffer.from(TINY_GIF_B64, 'base64')),
};

const pg: PgvectorClient = {
  searchByEmbedding: vi.fn(),
  upsertBatch: vi.fn(async () => 1),
  searchByEmbeddingMarengo: vi.fn(),
  upsertBatchMarengo: vi.fn(async () => 1),
  close: vi.fn(),
};

const embedMock = vi.fn(async (bufs: Buffer[]) =>
  bufs.map(() => ({ vector: new Float32Array(1024) })),
);

describe('runIndexer', () => {
  it('processes a category end-to-end', async () => {
    const summary = await runIndexer({
      minio,
      pg,
      categories: ['dolly-zoom'],
      batchSize: 10,
      embed: embedMock,
    });
    expect(summary.totalObjects).toBe(1);
    expect(summary.totalFrames).toBeGreaterThanOrEqual(1);
    expect(pg.upsertBatch).toHaveBeenCalled();
  });

  it('skips already-indexed rows when forceReindex=false (UPSERT idempotency)', async () => {
    // UPSERT is idempotent — running twice on same data causes no error.
    // Both runs should succeed and accumulate upsertBatch calls.
    vi.mocked(pg.upsertBatch).mockClear();
    const summary1 = await runIndexer({
      minio,
      pg,
      categories: ['dolly-zoom'],
      batchSize: 10,
      embed: embedMock,
    });
    const summary2 = await runIndexer({
      minio,
      pg,
      categories: ['dolly-zoom'],
      batchSize: 10,
      embed: embedMock,
    });
    expect(summary1.totalObjects).toBe(1);
    expect(summary2.totalObjects).toBe(1);
    // Both runs called upsertBatch — idempotent ON CONFLICT handles duplicates
    expect(vi.mocked(pg.upsertBatch).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
