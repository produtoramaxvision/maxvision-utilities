// media-forge/tests/integration/gallery/margin-query.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GalleryStore } from '../../../src/gallery/gallery-store.js';
import { computeMargin } from '../../../src/gallery/margin.js';

const url = process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('generationsInPeriod', () => {
  let store: GalleryStore;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS generations');
    await pool.query(
      readFileSync(join(process.cwd(), 'migrations', '002_generations.sql'), 'utf8'),
    );
    store = new GalleryStore(pool);
    await store.insertGeneration({
      generationId: 'j1', tenantId: 't1', model: 'veo-3-1-pro', provider: 'google',
      costUsd: 4, creditsDebited: 1600, creditValueUsd: 0.01, status: 'completed',
    });
    await store.insertGeneration({
      generationId: 'j2', tenantId: 't1', model: 'imagen-4-ultra', provider: 'google',
      costUsd: 0.02, creditsDebited: 20, creditValueUsd: 0.01, status: 'completed',
    });
  });

  it('retorna registros dentro do período', async () => {
    const since = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
    const until = new Date(Date.now() + 60 * 1000).toISOString(); // 1 min ahead
    const rows = await store.generationsInPeriod({ since, until });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const report = computeMargin(rows);
    expect(report.marginUsd).toBeGreaterThan(0);
    expect(report.byModel).toHaveProperty('veo-3-1-pro');
    expect(report.byModel).toHaveProperty('imagen-4-ultra');
  });

  it('período fora do range retorna vazio', async () => {
    const since = '2020-01-01T00:00:00Z';
    const until = '2020-01-02T00:00:00Z';
    const rows = await store.generationsInPeriod({ since, until });
    expect(rows).toHaveLength(0);
  });
});
