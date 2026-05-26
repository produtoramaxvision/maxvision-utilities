import { describe, it, expect, vi } from 'vitest';
import { sampleByCategory } from '../../../src/refs/tag-search.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';

function fakeClient(objectsByPrefix: Record<string, { key: string; size: number }[]>): MinioClient {
  return {
    listObjects: vi.fn(async (prefix: string) => ({
      objects: objectsByPrefix[prefix] ?? [],
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
});
