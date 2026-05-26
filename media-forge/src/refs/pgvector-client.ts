// src/refs/pgvector-client.ts
// Thin pg pool wrapper specialised for the refs_index table. Embeddings are
// passed as Float32Array and serialised in pgvector's literal format.
import { Pool } from 'pg';

export interface SemanticHit {
  objectKey: string;
  frameIdx: number;
  category: string;
  distance: number;
}

export interface UpsertRow {
  objectKey: string;
  frameIdx: number;
  category: string;
  embedding: Float32Array;
  palette?: string[];
  durationMs?: number;
  bytes?: number;
  width?: number;
  height?: number;
  format?: string;
  sourceFilm?: string;
}

export interface SearchOpts {
  topK: number;
  categoryFilter?: string[];
}

export interface PgvectorClient {
  searchByEmbedding(vec: Float32Array, opts: SearchOpts): Promise<SemanticHit[]>;
  upsertBatch(rows: UpsertRow[]): Promise<number>;
  close(): Promise<void>;
}

function vectorLiteral(vec: Float32Array): string {
  return `[${Array.from(vec).join(',')}]`;
}

export function createPgvectorClient(connStr: string): PgvectorClient {
  const pool = new Pool({ connectionString: connStr });

  return {
    async searchByEmbedding(vec, opts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any[] = [vectorLiteral(vec), opts.topK];
      let where = '';
      if (opts.categoryFilter && opts.categoryFilter.length > 0) {
        where = ' WHERE category = ANY($3)';
        params.push(opts.categoryFilter);
      }
      const sql = `
        SELECT object_key, frame_idx, category, embedding <=> $1::vector AS distance
        FROM media_forge_refs.refs_index${where}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `;
      const res = await pool.query(sql, params);
      return res.rows.map((r) => ({
        objectKey: r.object_key as string,
        frameIdx: r.frame_idx as number,
        category: r.category as string,
        distance: Number(r.distance),
      }));
    },

    async upsertBatch(rows) {
      if (rows.length === 0) return 0;
      const cols = [
        'object_key', 'frame_idx', 'category', 'embedding',
        'palette', 'duration_ms', 'bytes', 'width', 'height', 'format', 'source_film',
      ];
      const values: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any[] = [];
      let i = 1;
      for (const r of rows) {
        values.push(
          `($${i++}, $${i++}, $${i++}, $${i++}::vector, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
        );
        params.push(
          r.objectKey,
          r.frameIdx,
          r.category,
          vectorLiteral(r.embedding),
          r.palette ?? null,
          r.durationMs ?? null,
          r.bytes ?? null,
          r.width ?? null,
          r.height ?? null,
          r.format ?? null,
          r.sourceFilm ?? null,
        );
      }
      const sql = `
        INSERT INTO media_forge_refs.refs_index (${cols.join(',')})
        VALUES ${values.join(',')}
        ON CONFLICT (object_key, frame_idx) DO UPDATE
          SET embedding = EXCLUDED.embedding,
              indexed_at = now()
      `;
      const res = await pool.query(sql, params);
      return res.rowCount ?? 0;
    },

    async close() {
      await pool.end();
    },
  };
}
