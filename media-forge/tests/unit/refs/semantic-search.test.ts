import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { semanticSearch } from '../../../src/refs/semantic-search.js';
import type { PgvectorClient } from '../../../src/refs/pgvector-client.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';

const pg: PgvectorClient = {
  searchByEmbedding: vi.fn(async () => [
    { objectKey: 'dolly-zoom/a.gif', frameIdx: 0, category: 'dolly-zoom', distance: 0.05 },
    { objectKey: 'dolly-zoom/b.gif', frameIdx: 1, category: 'dolly-zoom', distance: 0.10 },
  ]),
  upsertBatch: vi.fn(),
  searchByEmbeddingMarengo: vi.fn(async () => []),
  upsertBatchMarengo: vi.fn(async () => 0),
  close: vi.fn(),
};

const minio: MinioClient = {
  listObjects: vi.fn(),
  headObject: vi.fn(),
  presignObject: vi.fn(async (k: string) => `https://signed/${k}`),
  downloadObject: vi.fn(),
};

const embed = vi.fn(async () => [{ vector: new Float32Array(1024) }]);

// Use the committed tiny.gif fixture so readFile succeeds without live Voyage.
const TINY_GIF = resolve('tests/unit/refs/fixtures/tiny.gif');

describe('semanticSearch', () => {
  it('embeds query image and presigns hits', async () => {
    const out = await semanticSearch({
      pg, minio, embed,
      queryImagePath: TINY_GIF,
      categoryFilter: ['dolly-zoom'],
      topK: 2, ttlSeconds: 600,
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.presignedUrl).toMatch(/^https:\/\/signed\//);
    expect(embed).toHaveBeenCalled();
  });

  it('throws for queryText-only path (pending follow-up)', async () => {
    await expect(
      semanticSearch({
        pg, minio, embed,
        queryText: 'tense scene with shaky camera',
        topK: 2, ttlSeconds: 600,
      }),
    ).rejects.toThrow('queryText embedding pending follow-up — use queryImagePath');
  });
});
