// src/refs/semantic-search.ts
// Phase 2: embed query (image path) → pgvector cosine top-K → presign hits.
// Text-only queries (queryText without queryImagePath) are deferred to a
// follow-up that wires the Voyage text-embedding endpoint.
//
// Task 2.8: reads MEDIA_FORGE_EMBED_BACKEND at query time.
// When 'marengo': queries refs_index_marengo table (512-dim) instead of refs_index.
// The query image is embedded as a raw buffer via Marengo embedVideos.
// Text-only queries remain deferred (same as Voyage path).
import type { PgvectorClient } from './pgvector-client.js';
import type { MinioClient } from './minio-client.js';
import type { EmbedResult } from './voyage-embed.js';
import { embedImages } from './voyage-embed.js';
import { embedVideos } from './marengo-embed.js';
import type { MarengoEmbedCfg } from './marengo-embed.js';

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
  /**
   * Override the backend at call time. When omitted, falls back to
   * MEDIA_FORGE_EMBED_BACKEND env var (default: 'voyage').
   */
  backend?: 'voyage' | 'marengo';
  /** Marengo AWS config — only used when backend='marengo'. Falls back to env vars. */
  marengo?: MarengoEmbedCfg;
}

export interface SemanticRef {
  category: string;
  objectKey: string;
  frameIdx: number;
  distance: number;
  presignedUrl: string;
}

async function embedQueryVoyage(opts: SemanticSearchOpts): Promise<Float32Array> {
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

async function embedQueryMarengo(opts: SemanticSearchOpts): Promise<Float32Array> {
  if (opts.queryImagePath) {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(opts.queryImagePath);
    const cfg: MarengoEmbedCfg = opts.marengo ?? {
      region: process.env.AWS_REGION ?? 'us-east-1',
      accessKey: process.env.AWS_ACCESS_KEY_ID,
      secretKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
    const res = await embedVideos([buf], cfg);
    return res[0]!.vector;
  }
  if (opts.queryText) {
    // Text-only Marengo path is deferred — same as Voyage.
    throw new Error('queryText embedding pending follow-up — use queryImagePath');
  }
  throw new Error('semantic search requires queryText or queryImagePath');
}

export async function semanticSearch(opts: SemanticSearchOpts): Promise<SemanticRef[]> {
  // Determine effective backend: explicit opt > env var > default voyage
  const backend =
    opts.backend ?? (process.env.MEDIA_FORGE_EMBED_BACKEND as 'voyage' | 'marengo' | undefined) ?? 'voyage';

  const vec =
    backend === 'marengo' ? await embedQueryMarengo(opts) : await embedQueryVoyage(opts);

  const hits =
    backend === 'marengo'
      ? await opts.pg.searchByEmbeddingMarengo(vec, {
          topK: opts.topK,
          categoryFilter: opts.categoryFilter,
        })
      : await opts.pg.searchByEmbedding(vec, {
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
