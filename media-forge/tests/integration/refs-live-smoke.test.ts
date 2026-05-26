import { describe, it, expect } from 'vitest';
import { createRefsService } from '../../src/refs/refs-service.js';

// ---------------------------------------------------------------------------
// Gate: only run when the caller explicitly opts in by setting
// MEDIA_FORGE_RUN_LIVE_TESTS=true. Any other value (including unset) skips
// the entire describe block so that `pnpm test:integration` stays green with
// no real MinIO credentials in CI or local development.
// ---------------------------------------------------------------------------
const SHOULD_RUN = process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true';
const describeLive = SHOULD_RUN ? describe : describe.skip;

describeLive('refs live smoke (hits real MinIO)', () => {
  function buildSvc() {
    return createRefsService(
      {
        endpoint: process.env['MINIO_ENDPOINT']!,
        region: process.env['MINIO_REGION'] ?? 'us-east-1',
        bucket: process.env['MINIO_BUCKET'] ?? 'media-forge-refs',
        accessKey: process.env['MINIO_ACCESS_KEY'],
        secretKey: process.env['MINIO_SECRET_KEY'],
        useSsl: (process.env['MINIO_USE_SSL'] ?? 'true') !== 'false',
      },
      // mfClient is not needed for search/presign — pass a structural stub.
      // If composeMoodboard is tested live it requires a real MediaForgeClient.
      { mode: 'gemini', dryRun: true, ai: {} as never },
    );
  }

  it('lists at least 1 object under dolly-zoom/', async () => {
    const svc = buildSvc();
    const refs = await svc.searchRefs({
      tags: ['dolly-zoom'],
      mode: 'tag',
      limit: 1,
      seed: 1,
      ttlSeconds: 600,
    });
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].presignedUrl).toMatch(/^https?:\/\//);
  });

  it('presigned URL is HEAD-able (status 200)', async () => {
    const svc = buildSvc();
    const refs = await svc.searchRefs({
      tags: ['dolly-zoom'],
      mode: 'tag',
      limit: 1,
      seed: 2,
      ttlSeconds: 600,
    });
    expect(refs.length).toBeGreaterThanOrEqual(1);
    const resp = await fetch(refs[0].presignedUrl, { method: 'HEAD' });
    expect(resp.status).toBe(200);
  });
});
