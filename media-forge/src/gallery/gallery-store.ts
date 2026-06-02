// media-forge/src/gallery/gallery-store.ts
// Postgres adapter for the gallery (F-I). Uses the shared mcp-postgres pool (DATABASE_URL).
import type { Pool } from 'pg';
import type {
  GenerationRecord,
  GalleryPage,
  InsertGenerationOpts,
  ListGenerationsOpts,
} from './schema.js';

export class GalleryStore {
  constructor(private pool: Pool) {}

  /** Insert idempotente por generation_id. Replay de webhook nao duplica. */
  async insertGeneration(opts: InsertGenerationOpts): Promise<void> {
    await this.pool.query(
      `INSERT INTO generations
         (generation_id, tenant_id, model, provider, cost_usd, credits_debited, credit_value_usd, minio_key, signed_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (generation_id) DO NOTHING`,
      [
        opts.generationId,
        opts.tenantId,
        opts.model,
        opts.provider,
        opts.costUsd,
        opts.creditsDebited,
        opts.creditValueUsd,
        opts.minioKey ?? null,
        opts.signedUrl ?? null,
        opts.status ?? 'completed',
      ],
    );
  }

  /** Query paginada (1-based page) ordenada por created_at DESC, filtrada por tenant_id. */
  async listGenerations(opts: ListGenerationsOpts): Promise<GalleryPage> {
    const { tenantId, page, pageSize } = opts;
    const size = Math.min(Math.max(pageSize, 1), 100);
    const offset = (Math.max(page, 1) - 1) * size;

    const r = await this.pool.query<{
      generationId: string; tenantId: string; model: string; provider: string;
      costUsd: string | number; creditsDebited: string | number; creditValueUsd: string | number;
      minioKey: string | null; signedUrl: string | null; status: string;
      createdAt: Date | string; total_count: string;
    }>(
      `SELECT
         generation_id   AS "generationId",
         tenant_id       AS "tenantId",
         model,
         provider,
         cost_usd::float        AS "costUsd",
         credits_debited::bigint AS "creditsDebited",
         credit_value_usd::float AS "creditValueUsd",
         minio_key       AS "minioKey",
         signed_url      AS "signedUrl",
         status,
         created_at      AS "createdAt",
         COUNT(*) OVER() AS total_count
       FROM generations
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, size, offset],
    );

    const total = r.rows.length > 0 ? Number(r.rows[0]!.total_count) : 0;
    const items = r.rows.map(({ total_count: _tc, createdAt, ...rest }) => ({
      ...rest,
      costUsd: Number(rest.costUsd),
      creditsDebited: Number(rest.creditsDebited),
      creditValueUsd: Number(rest.creditValueUsd),
      status: rest.status as 'completed' | 'failed',
      createdAt: (createdAt as unknown) instanceof Date
        ? (createdAt as unknown as Date).toISOString()
        : String(createdAt),
    })) as GenerationRecord[];

    return {
      items,
      total,
      page: Math.max(page, 1),
      pageSize: size,
      hasMore: offset + items.length < total,
    };
  }

  /** Retorna linhas de gerações concluídas num intervalo (para agregação de margem). */
  async generationsInPeriod(opts: { since: string; until: string }): Promise<GenerationRecord[]> {
    const r = await this.pool.query<{
      generationId: string;
      tenantId: string;
      model: string;
      provider: string;
      costUsd: string;
      creditsDebited: string;
      creditValueUsd: string;
      minioKey: string | null;
      signedUrl: string | null;
      status: string;
      createdAt: Date;
    }>(
      `SELECT
         generation_id AS "generationId", tenant_id AS "tenantId", model, provider,
         cost_usd AS "costUsd", credits_debited AS "creditsDebited",
         credit_value_usd AS "creditValueUsd", minio_key AS "minioKey",
         signed_url AS "signedUrl", status, created_at AS "createdAt"
       FROM generations
       WHERE status = 'completed' AND created_at >= $1 AND created_at < $2
       ORDER BY created_at DESC
       LIMIT 10000`,
      [opts.since, opts.until],
    );
    return r.rows.map((x) => ({
      ...x,
      costUsd: Number(x.costUsd),
      creditsDebited: Number(x.creditsDebited),
      creditValueUsd: Number(x.creditValueUsd),
      status: x.status as 'completed' | 'failed',
      createdAt: x.createdAt instanceof Date ? x.createdAt.toISOString() : String(x.createdAt),
    }));
  }
}
