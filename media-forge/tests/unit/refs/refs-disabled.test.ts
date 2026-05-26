import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports of the module under test.
// ---------------------------------------------------------------------------

const sampleByCategoryMock = vi.fn();
vi.mock('../../../src/refs/tag-search.js', () => ({
  sampleByCategory: (...a: unknown[]) => sampleByCategoryMock(...a),
}));

// generateImageNanoBananaPro is imported transitively via refs-service; mock it
// so the test has no real NBP dependency.
vi.mock('../../../src/image/image-service.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../src/image/image-service.js');
  return { ...actual, generateImageNanoBananaPro: vi.fn() };
});

import { createRefsServiceWithClient } from '../../../src/refs/refs-service.js';
import type { MinioClient } from '../../../src/refs/minio-client.js';
import type { MediaForgeClient } from '../../../src/core/client.js';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeFakeMinioClient(): MinioClient {
  return {
    listObjects: vi.fn(),
    headObject: vi.fn(),
    downloadObject: vi.fn(),
    presignObject: vi.fn(),
  } as unknown as MinioClient;
}

const fakeMfClient = {} as MediaForgeClient;

// ---------------------------------------------------------------------------
// Task 1.15 — refsDisabled short-circuit
// ---------------------------------------------------------------------------

describe('searchRefs — refsDisabled opt-out', () => {
  it('short-circuits when refsDisabled=true (no MinIO call)', async () => {
    const minio = makeFakeMinioClient();
    const svc = createRefsServiceWithClient(minio, fakeMfClient);

    const result = await svc.searchRefs({
      tags: ['dolly-zoom'],
      mode: 'tag',
      limit: 5,
      seed: 1,
      ttlSeconds: 600,
      refsDisabled: true,
    });

    expect(result).toEqual([]);
    expect(sampleByCategoryMock).not.toHaveBeenCalled();
    expect(minio.listObjects).not.toHaveBeenCalled();
  });
});
