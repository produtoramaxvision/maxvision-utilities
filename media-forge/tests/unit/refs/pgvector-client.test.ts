import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({ query: queryMock, end: vi.fn() })),
}));

import { createPgvectorClient } from '../../../src/refs/pgvector-client.js';

describe('pgvector-client', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('searchByEmbedding executes cosine query with k-nearest', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { object_key: 'dolly-zoom/a.gif', frame_idx: 0, category: 'dolly-zoom', distance: 0.12 },
      ],
    });
    const pg = createPgvectorClient('postgresql://x');
    const out = await pg.searchByEmbedding(new Float32Array(1024), { topK: 5 });
    expect(out).toHaveLength(1);
    expect(out[0].objectKey).toBe('dolly-zoom/a.gif');
    expect(queryMock.mock.calls[0][0]).toContain('ORDER BY embedding <=>');
  });

  it('upsertBatch writes rows in a single statement', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2 });
    const pg = createPgvectorClient('postgresql://x');
    await pg.upsertBatch([
      { objectKey: 'a/1.gif', frameIdx: 0, category: 'a', embedding: new Float32Array(1024) },
      { objectKey: 'a/2.gif', frameIdx: 0, category: 'a', embedding: new Float32Array(1024) },
    ]);
    expect(queryMock.mock.calls[0][0]).toMatch(/INSERT INTO media_forge_refs\.refs_index/);
    expect(queryMock.mock.calls[0][0]).toMatch(/ON CONFLICT/);
  });
});
