// src/refs/indexer.ts
// Batch indexer: list bucket per category → extract keyframes → embed via Voyage
// Multimodal-3 → UPSERT into pgvector. ON CONFLICT makes every run idempotent and
// resumable: re-running from a checkpoint simply re-stamps already-indexed rows.
//
// Carry-over patch (Task 2.2 EA2): catches VoyageCircuitOpenError at the flush()
// level, dumps a structured checkpoint to stderr, then re-throws unchanged so the
// caller (run-indexer-once.ts, Task 2.5) can decide whether to re-run.
//
// Task 2.8: added `backend: 'voyage' | 'marengo'` option (default: 'voyage').
// When marengo: skip keyframe extraction, pass raw buffer to embedVideos,
// UPSERT into refs_index_marengo (512-dim, no frame_idx).
import type { MinioClient } from './minio-client.js';
import type { PgvectorClient, UpsertRow, UpsertRowMarengo } from './pgvector-client.js';
import { extractKeyframesFromBuffer, normaliseToJpeg } from './keyframe-extractor.js';
import { embedImages, VoyageCircuitOpenError } from './voyage-embed.js';
import type { EmbedResult } from './voyage-embed.js';
import { embedVideos } from './marengo-embed.js';
import type { MarengoEmbedCfg, MarengoEmbedResult } from './marengo-embed.js';

export interface IndexerOpts {
  minio: MinioClient;
  pg: PgvectorClient;
  categories: readonly string[];
  batchSize: number;
  framesPerObject?: number;
  voyageApiKey?: string;
  /**
   * Which embedding backend to use. Defaults to 'voyage'.
   * 'marengo' skips keyframe extraction and embeds the raw video buffer via
   * Bedrock/Marengo 3.0 into refs_index_marengo (512-dim table).
   */
  backend?: 'voyage' | 'marengo';
  /** Marengo AWS config — only used when backend='marengo'. */
  marengo?: MarengoEmbedCfg;
  /** Injectable embed fn — defaults to Voyage Multimodal-3. Used by tests. */
  embed?: (jpegs: Buffer[]) => Promise<EmbedResult[]>;
  /** Injectable Marengo embed fn — defaults to embedVideos. Used by tests. */
  embedMarengo?: (clips: Buffer[], cfg: MarengoEmbedCfg) => Promise<MarengoEmbedResult[]>;
}

export interface IndexerSummary {
  totalObjects: number;
  totalFrames: number;
  totalBatches: number;
}

export async function runIndexer(opts: IndexerOpts): Promise<IndexerSummary> {
  const backend = opts.backend ?? 'voyage';

  if (backend === 'marengo') {
    return runIndexerMarengo(opts);
  }
  return runIndexerVoyage(opts);
}

async function runIndexerVoyage(opts: IndexerOpts): Promise<IndexerSummary> {
  const framesPerObject = opts.framesPerObject ?? 3;
  const embed = opts.embed ?? ((jpegs) => embedImages(jpegs, opts.voyageApiKey ?? ''));

  let totalObjects = 0;
  let totalFrames = 0;
  let totalBatches = 0;
  // Tracks current category so the circuit-breaker checkpoint can report it
  let currentCategory: string | undefined;

  // Internal buffer: rows accumulate until batchSize is hit, then flush() drains.
  // The `_jpeg` field temporarily holds the normalised JPEG for embed, stripped before upsert.
  const buffer: Array<UpsertRow & { _jpeg?: Buffer }> = [];

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    const jpegs = buffer.map((r) => r._jpeg!);

    let embeddings: EmbedResult[];
    try {
      embeddings = await embed(jpegs);
    } catch (err) {
      if (err instanceof VoyageCircuitOpenError) {
        // Dump checkpoint to stderr so the operational script (Task 2.5) can resume.
        console.error(
          JSON.stringify({
            event: 'indexer_checkpoint',
            reason: 'voyage_circuit_open',
            totalObjects,
            totalFrames,
            totalBatches,
            category: currentCategory,
          }),
        );
      }
      // Re-throw unchanged — caller decides whether to retry.
      throw err;
    }

    for (let i = 0; i < buffer.length; i++) {
      const row = buffer[i];
      const result = embeddings[i];
      if (row && result) {
        row.embedding = result.vector;
      }
    }
    // Strip _jpeg before persisting — it is not a column in pgvector
    for (const r of buffer) {
      delete r._jpeg;
    }

    await opts.pg.upsertBatch(buffer as UpsertRow[]);
    totalBatches += 1;
    buffer.length = 0;
  }

  for (const category of opts.categories) {
    currentCategory = category;
    let token: string | undefined;

    do {
      const { objects, truncated, nextContinuationToken } = await opts.minio.listObjects(
        `${category}/`,
        1000,
        token,
      );

      for (const obj of objects) {
        const raw = await opts.minio.downloadObject(obj.key);
        const frames = await extractKeyframesFromBuffer(raw, { maxFrames: framesPerObject });

        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          if (!frame) continue;
          const norm = await normaliseToJpeg(frame, { minSide: 512 });
          buffer.push({
            objectKey: obj.key,
            frameIdx: i,
            category,
            embedding: new Float32Array(1024), // placeholder; filled after embed() in flush()
            bytes: obj.size,
            format: obj.key.endsWith('.webp') ? 'webp' : 'gif',
            _jpeg: norm,
          });
          totalFrames += 1;

          if (buffer.length >= opts.batchSize) {
            await flush();
          }
        }

        totalObjects += 1;
      }

      token = truncated ? nextContinuationToken : undefined;
    } while (token);
  }

  // Flush any remaining rows that did not fill a full batch
  await flush();

  return { totalObjects, totalFrames, totalBatches };
}

async function runIndexerMarengo(opts: IndexerOpts): Promise<IndexerSummary> {
  const marengoEmbedFn = opts.embedMarengo ?? embedVideos;
  const marengocfg: MarengoEmbedCfg = opts.marengo ?? {
    region: process.env.AWS_REGION ?? 'us-east-1',
    accessKey: process.env.AWS_ACCESS_KEY_ID,
    secretKey: process.env.AWS_SECRET_ACCESS_KEY,
  };

  let totalObjects = 0;
  // Marengo embeds full clip — no frame split. totalFrames mirrors totalObjects.
  let totalFrames = 0;
  let totalBatches = 0;

  const buffer: Array<UpsertRowMarengo & { _raw?: Buffer }> = [];

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;
    const clips = buffer.map((r) => r._raw!);
    const embeddings = await marengoEmbedFn(clips, marengocfg);

    for (let i = 0; i < buffer.length; i++) {
      const row = buffer[i];
      const result = embeddings[i];
      if (row && result) {
        row.embedding = result.vector;
      }
    }
    for (const r of buffer) {
      delete r._raw;
    }

    await opts.pg.upsertBatchMarengo(buffer as UpsertRowMarengo[]);
    totalBatches += 1;
    buffer.length = 0;
  }

  for (const category of opts.categories) {
    let token: string | undefined;

    do {
      const { objects, truncated, nextContinuationToken } = await opts.minio.listObjects(
        `${category}/`,
        1000,
        token,
      );

      for (const obj of objects) {
        const raw = await opts.minio.downloadObject(obj.key);
        buffer.push({
          objectKey: obj.key,
          category,
          embedding: new Float32Array(512), // placeholder; filled after embed() in flush()
          bytes: obj.size,
          format: obj.key.endsWith('.webp') ? 'webp' : 'gif',
          _raw: raw,
        });
        totalObjects += 1;
        totalFrames += 1; // 1 clip = 1 frame-equivalent for summary consistency

        if (buffer.length >= opts.batchSize) {
          await flush();
        }
      }

      token = truncated ? nextContinuationToken : undefined;
    } while (token);
  }

  await flush();

  return { totalObjects, totalFrames, totalBatches };
}
