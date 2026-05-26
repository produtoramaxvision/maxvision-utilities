import { describe, it, expect, vi } from 'vitest';
import { sampleByCategory } from '../../../src/refs/tag-search.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';

function fakeClient(objectsByPrefix: Record<string, { key: string; size: number }[]>): MinioClient {
  return {
    listObjects: vi.fn(async (prefix: string) => ({
      objects: objectsByPrefix[prefix] ?? [],
      commonPrefixes: [],
      truncated: false,
    })),
    headObject: vi.fn(),
    presignObject: vi.fn(async (k: string) => `https://signed.example/${k}`),
    downloadObject: vi.fn(),
  } as unknown as MinioClient;
}

describe('sampleByCategory', () => {
  it('returns up to N presigned refs for a single category', async () => {
    const client = fakeClient({
      'dolly-zoom/': [
        { key: 'dolly-zoom/aaa.gif', size: 100 },
        { key: 'dolly-zoom/bbb.webp', size: 200 },
        { key: 'dolly-zoom/ccc.gif', size: 300 },
        { key: 'dolly-zoom/ddd.webp', size: 400 },
      ],
    });
    const refs = await sampleByCategory(client, ['dolly-zoom'], { limitPerCategory: 2, seed: 42, ttlSeconds: 3000 });
    expect(refs).toHaveLength(2);
    expect(refs[0].category).toBe('dolly-zoom');
    expect(refs[0].presignedUrl).toMatch(/^https:\/\/signed\.example\//);
    expect(refs[0].objectKey.startsWith('dolly-zoom/')).toBe(true);
    expect(refs[0].rationale.mode).toBe('tag');
    expect(refs[0].rationale.rank).toBeDefined();
    expect(refs[0].rationale.seedUsed).toBe(42);
  });

  it('deterministic ordering across runs with same seed', async () => {
    const objs = [
      { key: 'dolly-zoom/aaa.gif', size: 100 },
      { key: 'dolly-zoom/bbb.webp', size: 200 },
      { key: 'dolly-zoom/ccc.gif', size: 300 },
      { key: 'dolly-zoom/ddd.webp', size: 400 },
    ];
    const client = fakeClient({ 'dolly-zoom/': objs });
    const r1 = await sampleByCategory(client, ['dolly-zoom'], { limitPerCategory: 2, seed: 7, ttlSeconds: 3000 });
    const r2 = await sampleByCategory(client, ['dolly-zoom'], { limitPerCategory: 2, seed: 7, ttlSeconds: 3000 });
    expect(r1.map((x) => x.objectKey)).toEqual(r2.map((x) => x.objectKey));
  });

  it('fans out across multiple categories', async () => {
    const client = fakeClient({
      'dolly-zoom/': [{ key: 'dolly-zoom/a.gif', size: 1 }],
      'bullet-time/': [{ key: 'bullet-time/b.gif', size: 1 }],
    });
    const refs = await sampleByCategory(client, ['dolly-zoom', 'bullet-time'], { limitPerCategory: 1, seed: 1, ttlSeconds: 3000 });
    expect(refs.map((r) => r.category).sort()).toEqual(['bullet-time', 'dolly-zoom']);
  });

  it('throws on unknown category before hitting MinIO', async () => {
    const client = fakeClient({});
    await expect(
      sampleByCategory(client, ['not-a-real-category'], { limitPerCategory: 1, seed: 1, ttlSeconds: 3000 }),
    ).rejects.toThrow(/unknown category/i);
  });

  // R2: pagination — two pages merged before shuffle
  it('paginates listObjects and includes objects from both pages', async () => {
    const page1Objs = [
      { key: 'dolly-zoom/page1-a.gif', size: 10 },
      { key: 'dolly-zoom/page1-b.gif', size: 20 },
    ];
    const page2Objs = [
      { key: 'dolly-zoom/page2-a.gif', size: 30 },
      { key: 'dolly-zoom/page2-b.gif', size: 40 },
    ];
    let callCount = 0;
    const paginatedClient: MinioClient = {
      listObjects: vi.fn(async (_prefix: string, _max?: number, token?: string) => {
        callCount++;
        if (token === undefined) {
          // First page: truncated, returns continuation token
          return { objects: page1Objs, commonPrefixes: [], truncated: true, nextContinuationToken: 'tok2' };
        }
        // Second page: not truncated
        return { objects: page2Objs, commonPrefixes: [], truncated: false };
      }),
      headObject: vi.fn(),
      presignObject: vi.fn(async (k: string) => `https://signed.example/${k}`),
      downloadObject: vi.fn(),
    } as unknown as MinioClient;

    // limitPerCategory=4 so all 4 objects can appear
    const refs = await sampleByCategory(paginatedClient, ['dolly-zoom'], { limitPerCategory: 4, seed: 1, ttlSeconds: 3000 });
    expect(callCount).toBe(2); // both pages fetched
    const keys = refs.map((r) => r.objectKey).sort();
    const allKeys = [...page1Objs, ...page2Objs].map((o) => o.key).sort();
    expect(keys).toEqual(allKeys);
  });
});
