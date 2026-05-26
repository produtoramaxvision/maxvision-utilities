// src/refs/indexer.ts
// Batch indexer: list bucket per category → extract keyframes → embed via Voyage
// Multimodal-3 → UPSERT into pgvector. ON CONFLICT makes every run idempotent and
// resumable: re-running from a checkpoint simply re-stamps already-indexed rows.
//
// Carry-over patch (Task 2.2 EA2): catches VoyageCircuitOpenError at the flush()
// level, dumps a structured checkpoint to stderr, then re-throws unchanged so the
// caller (run-indexer-once.ts, Task 2.5) can decide whether to re-run.
import type { MinioClient } from './minio-client.js';
import type { PgvectorClient, UpsertRow } from './pgvector-client.js';
import { extractKeyframesFromBuffer, normaliseToJpeg } from './keyframe-extractor.js';
import { embedImages, VoyageCircuitOpenError } from './voyage-embed.js';
import type { EmbedResult } from './voyage-embed.js';

export interface IndexerOpts {
  minio: MinioClient;
  pg: PgvectorClient;
  categories: readonly string[];
  batchSize: number;
  framesPerObject?: number;
  voyageApiKey?: string;
  /** Injectable embed fn — defaults to Voyage Multimodal-3. Used by tests. */
  embed?: (jpegs: Buffer[]) => Promise<EmbedResult[]>;
}

export interface IndexerSummary {
  totalObjects: number;
  totalFrames: number;
  totalBatches: number;
}

export async function runIndexer(opts: IndexerOpts): Promise<IndexerSummary> {
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
