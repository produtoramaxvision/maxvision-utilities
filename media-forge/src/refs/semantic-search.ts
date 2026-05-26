// src/refs/semantic-search.ts
// Phase 2: embed query (image path) → pgvector cosine top-K → presign hits.
// Text-only queries (queryText without queryImagePath) are deferred to a
// follow-up that wires the Voyage text-embedding endpoint.
import type { PgvectorClient } from './pgvector-client.js';
import type { MinioClient } from './minio-client.js';
import type { EmbedResult } from './voyage-embed.js';
import { embedImages } from './voyage-embed.js';

export interface SemanticSearchOpts {
  pg: PgvectorClient;
  minio: MinioClient;
  queryText?: string;
  queryImagePath?: string;
  categoryFilter?: string[];
  topK: number;
  ttlSeconds: number;
  voyageApiKey?: string;
  /** Injected embed function — defaults to embedImages(voyageApiKey). For tests. */
  embed?: (jpegs: Buffer[]) => Promise<EmbedResult[]>;
}

export interface SemanticRef {
  category: string;
  objectKey: string;
  frameIdx: number;
  distance: number;
  presignedUrl: string;
}

async function embedQuery(opts: SemanticSearchOpts): Promise<Float32Array> {
  const embed = opts.embed ?? ((jpegs) => embedImages(jpegs, opts.voyageApiKey ?? ''));
  if (opts.queryImagePath) {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(opts.queryImagePath);
    const res = await embed([buf]);
    return res[0]!.vector;
  }
  if (opts.queryText) {
    // Voyage multimodal text-query path is deferred to a follow-up.
    // Emitting a clear error helps callers fall back to tag mode.
    throw new Error('queryText embedding pending follow-up — use queryImagePath');
  }
  throw new Error('semantic search requires queryText or queryImagePath');
}

export async function semanticSearch(opts: SemanticSearchOpts): Promise<SemanticRef[]> {
  const vec = await embedQuery(opts);
  const hits = await opts.pg.searchByEmbedding(vec, {
    topK: opts.topK,
    categoryFilter: opts.categoryFilter,
  });
  const out: SemanticRef[] = [];
  for (const h of hits) {
    const url = await opts.minio.presignObject(h.objectKey, opts.ttlSeconds);
    out.push({
      category: h.category,
      objectKey: h.objectKey,
      frameIdx: h.frameIdx,
      distance: h.distance,
      presignedUrl: url,
    });
  }
  return out;
}
