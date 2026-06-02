// media-forge/tests/integration/gallery/gallery-store.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GalleryStore } from '../../../src/gallery/gallery-store.js';

const url = process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('GalleryStore', () => {
  let pool: Pool;
  let store: GalleryStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS generations');
    await pool.query(
      readFileSync(
        join(process.cwd(), 'migrations', '002_generations.sql'),
        'utf8',
      ),
    );
    store = new GalleryStore(pool);
  });

  const base = {
    generationId: 'job-001',
    tenantId: 'tenant-a',
    model: 'veo-3-1-pro',
    provider: 'google',
    costUsd: 4.0,
    creditsDebited: 1600,
    creditValueUsd: 0.01,
    minioKey: 'outputs/tenant-a/job-001.mp4',
    signedUrl: 'https://example.com/signed',
    status: 'completed' as const,
  };

  it('insert e query retornam o registro', async () => {
    await store.insertGeneration(base);
    const page = await store.listGenerations({ tenantId: 'tenant-a', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].generationId).toBe('job-001');
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it('insert idempotente: replay nao duplica linha', async () => {
    await store.insertGeneration(base);  // replay
    const page = await store.listGenerations({ tenantId: 'tenant-a', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(1);
  });

  it('paginacao: pageSize=1 com 2 registros → hasMore=true', async () => {
    await store.insertGeneration({ ...base, generationId: 'job-002' });
    const page = await store.listGenerations({ tenantId: 'tenant-a', page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(2);
  });

  it('isolamento por tenant: tenant-b nao ve registros de tenant-a', async () => {
    const page = await store.listGenerations({ tenantId: 'tenant-b', page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(0);
  });
});
