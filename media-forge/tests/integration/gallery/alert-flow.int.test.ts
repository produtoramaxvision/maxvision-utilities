// media-forge/tests/integration/gallery/alert-flow.int.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GalleryStore } from '../../../src/gallery/gallery-store.js';
import { computeMargin } from '../../../src/gallery/margin.js';
import { evaluateAndAlert } from '../../../src/gallery/margin-alert.js';
import type { Notifier } from '../../../src/gallery/margin-alert.js';

const url = process.env.GALLERY_DATABASE_URL;
const d = url ? describe : describe.skip;

d('alert-flow (integration)', () => {
  let pool: Pool;
  let store: GalleryStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS generations');
    await pool.query(
      readFileSync(join(process.cwd(), 'migrations', '002_generations.sql'), 'utf8'),
    );
    store = new GalleryStore(pool);
  });

  it('insere geracao, computa margem e dispara alerta quando abaixo do limiar', async () => {
    // Generation with 0% margin (cost == revenue)
    await store.insertGeneration({
      generationId: 'job-margem-zero',
      tenantId: 't-alert',
      model: 'veo-3-1-pro',
      provider: 'google',
      costUsd: 4.0,
      creditsDebited: 400,  // 400 * 0.01 = $4.00 = cost (margin 0%)
      creditValueUsd: 0.01,
      status: 'completed',
    });

    const { rows } = await pool.query<{
      generation_id: string; tenant_id: string; model: string; provider: string;
      cost_usd: string; credits_debited: string; credit_value_usd: string;
      minio_key: string | null; signed_url: string | null; status: string; created_at: Date;
    }>(`SELECT * FROM generations WHERE tenant_id = 't-alert'`);

    const records = rows.map((r) => ({
      generationId: r.generation_id, tenantId: r.tenant_id, model: r.model,
      provider: r.provider, costUsd: Number(r.cost_usd), creditsDebited: Number(r.credits_debited),
      creditValueUsd: Number(r.credit_value_usd), minioKey: r.minio_key, signedUrl: r.signed_url,
      status: r.status as 'completed' | 'failed', createdAt: r.created_at.toISOString(),
    }));

    const report = computeMargin(records);
    expect(report.marginPct).toBeCloseTo(0, 2);

    const sent: string[] = [];
    const notifier: Notifier = { async send(s) { sent.push(s); } };
    const { alerted } = await evaluateAndAlert(report, { thresholdPct: 30, notifier });

    expect(alerted).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('[media-forge]');
  });

  it('nao alerta quando margem acima do limiar', async () => {
    await store.insertGeneration({
      generationId: 'job-margem-boa',
      tenantId: 't-ok',
      model: 'imagen-4-ultra',
      provider: 'google',
      costUsd: 0.02,
      creditsDebited: 20,   // 20 * 0.01 = $0.20 = 10x markup => ~90% margin
      creditValueUsd: 0.01,
      status: 'completed',
    });
    const page = await store.listGenerations({ tenantId: 't-ok', page: 1, pageSize: 10 });
    const report = computeMargin(page.items);
    const sent: string[] = [];
    const notifier: Notifier = { async send(s) { sent.push(s); } };
    await evaluateAndAlert(report, { thresholdPct: 30, notifier });
    expect(sent).toHaveLength(0);
  });
});
