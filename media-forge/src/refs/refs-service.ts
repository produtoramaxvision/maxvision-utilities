// src/refs/refs-service.ts
// High-level orchestration consumed by mcp/handlers.ts. Wires together the
// MinIO client, tag-search, keyframe-extractor, and the NBP image-generation
// SDK for moodboard fusion.
//
// NBP BRIDGE NOTE:
// The real generateImageNanoBananaPro signature uses file-path-based reference
// images (Array<{path:string; roleLabel?:string}>) and size tokens ('1K'|'2K'|'4K'),
// not raw Buffers or pixel-count strings. This service is the production call site
// and handles the full bridge: download → normalise → tmpdir → NBP → base64 → file.
// moodboard-composer.ts retains the slot/safety class definitions for test reuse only.
//
// NOTE: production NBP call lives in refs-service.ts due to SDK signature differences. This module retains slot/safety logic for unit-test reuse.

import { createMinioClient, type MinioClient, type MinioConfig } from './minio-client.js';
// Re-export for hooks that dynamically import dist/refs/refs-service.js at runtime
export { createMinioClient } from './minio-client.js';
import { sampleByCategory, type RefRecord } from './tag-search.js';
import { extractKeyframesFromBuffer, normaliseToJpeg } from './keyframe-extractor.js';
import { SafetyRejectedError, type ComposeResult } from './moodboard-composer.js';
import { PresignedUrlCache } from './ref-cache.js';
import { generateImageNanoBananaPro } from '../image/image-service.js';
import { NanoBananaProInput } from '../image/image-schemas.js';
import type { MediaForgeClient } from '../core/client.js';
import type {
  RefsSearchInputT,
  RefsComposeMoodboardInputT,
  RefsPresignInputT,
} from './refs-schemas.js';
import { appendRefsSelectionTrace } from '../trace/trace-writer.js';
import { logger } from '../core/logger.js';
import { logUnresolvedAlias } from './aliases-learn.js';
import { isCategory, resolveAliases, CATEGORIES } from './taxonomy.js';
import { join } from 'node:path';

export interface RefsTraceCtx {
  jobId: string;
  jobDir: string;
}

export interface RefsService {
  searchRefs(input: RefsSearchInputT, traceCtx?: RefsTraceCtx): Promise<RefRecord[]>;
  composeMoodboardFromKeys(input: RefsComposeMoodboardInputT): Promise<ComposeResult>;
  presignKeys(input: RefsPresignInputT): Promise<Array<{ key: string; url: string }>>;
}

/**
 * Create a refs service from raw MinIO config. MediaForgeClient is required
 * for composeMoodboardFromKeys (NBP call); it is passed as an explicit param
 * rather than built internally to keep the service testable without real creds.
 */
export function createRefsService(
  cfg: MinioConfig,
  mfClient: MediaForgeClient,
): RefsService {
  return createRefsServiceWithClient(createMinioClient(cfg), mfClient);
}

export function createRefsServiceWithClient(
  minio: MinioClient,
  mfClient: MediaForgeClient,
): RefsService {
  const cache = new PresignedUrlCache({ maxItems: 500, ttlMs: 50 * 60 * 1000 });

  return {
    // -----------------------------------------------------------------------
    // searchRefs — tag-based (Phase 1) or semantic (Phase 2, not yet impl)
    // -----------------------------------------------------------------------
    async searchRefs(input: RefsSearchInputT, traceCtx?: RefsTraceCtx): Promise<RefRecord[]> {
      if (input.refsDisabled) return [];
      if (input.mode === 'semantic') {
        const { createPgvectorClient } = await import('./pgvector-client.js');
        const { semanticSearch } = await import('./semantic-search.js');
        const pg = createPgvectorClient(process.env['PGVECTOR_URL'] ?? '');
        try {
          const hits = await semanticSearch({
            pg,
            minio,
            queryText: input.queryText,
            queryImagePath: input.queryImagePath,
            categoryFilter: input.tags,
            topK: input.limit,
            ttlSeconds: input.ttlSeconds,
            voyageApiKey: process.env['VOYAGE_API_KEY'],
          });
          return hits.map((h) => ({
            category: h.category,
            objectKey: h.objectKey,
            size: 0,
            presignedUrl: h.presignedUrl,
            rationale: { mode: 'semantic' as const, cosineDistance: h.distance, seedUsed: input.seed },
          }));
        } finally {
          await pg.close();
        }
      }
      // Pre-resolve tags: log unresolved ones (best-effort) and drop them so
      // sampleByCategory never sees an unknown category and throws.
      const resolvedTags: string[] = [];
      for (const raw of input.tags) {
        const cat = isCategory(raw) ? raw : resolveAliases(raw);
        if (!cat) {
          // Best-effort: find 3 closest categories via dumb substring match
          const phrase = raw.trim().toLowerCase();
          const candidates = (CATEGORIES as readonly string[])
            .filter(
              (c) =>
                phrase.includes(c.split('-')[0] ?? '') ||
                phrase.split(/\s+/).some((w) => c.includes(w)),
            )
            .slice(0, 3);
          const logPath = join(
            process.env['MEDIA_FORGE_PROJECT_DIR'] ?? '.media-forge',
            'aliases-learn.jsonl',
          );
          logUnresolvedAlias({
            logPath,
            phrase,
            briefSnippet: input.queryText ?? '',
            candidateMatches: candidates,
          }).catch((err: unknown) => {
            logger.warn('aliases-learn log failed (best-effort)', { err: String(err) });
          });
        } else {
          resolvedTags.push(cat);
        }
      }

      const t0 = Date.now();
      const refs = await sampleByCategory(minio, resolvedTags, {
        limitPerCategory: input.limit,
        seed: input.seed,
        ttlSeconds: input.ttlSeconds,
      });
      const searchLatencyMs = Date.now() - t0;

      // Best-effort trace emission — never fail refs delivery due to trace error
      if (traceCtx) {
        try {
          const refsChosen = refs.map((r) => ({
            category: r.category,
            objectKey: r.objectKey,
            rank: r.rationale.rank,
            cosineDistance: r.rationale.cosineDistance,
          }));
          // Calculate how many objects were available but not chosen per category.
          // We don't have that count here, so refsSkipped = 0 (conservative).
          // A future patch can pass the full count through sampleByCategory.
          await appendRefsSelectionTrace({
            jobId: traceCtx.jobId,
            jobDir: traceCtx.jobDir,
            entry: {
              type: 'refs_selection',
              jobId: traceCtx.jobId,
              refMode: input.mode === 'tag' ? 'tag' : 'semantic',
              seedUsed: input.seed,
              refsChosen,
              refsSkipped: 0,
              searchLatencyMs,
            },
          });
        } catch (err) {
          logger.warn('refs_selection trace failed (best-effort)', { err: String(err) });
        }
      }

      return refs;
    },

    // -----------------------------------------------------------------------
    // composeMoodboardFromKeys — NBP bridge (real production call site)
    // Downloads refs from MinIO → extracts keyframe → normalises to JPEG →
    // writes to tmpdir → calls generateImageNanoBananaPro with file paths →
    // writes base64 result to output file → returns ComposeResult.
    // -----------------------------------------------------------------------
    async composeMoodboardFromKeys(input: RefsComposeMoodboardInputT): Promise<ComposeResult> {
      if (input.refKeys.length === 0 && input.subjectImagePaths.length === 0) {
        throw new Error('composeMoodboardFromKeys requires at least one ref or subject image');
      }

      const { mkdtemp, writeFile, readFile, rm, mkdir: mkdirP } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');

      // Map outputSize string ('1024'|'2048'|'4096') → SDK token ('1K'|'2K'|'4K')
      const sizeMap: Record<'1024' | '2048' | '4096', '1K' | '2K' | '4K'> = {
        '1024': '1K',
        '2048': '2K',
        '4096': '4K',
      };
      const sdkImageSize = sizeMap[input.outputSize];

      const dir = await mkdtemp(join(tmpdir(), 'mf-moodboard-'));
      try {
        // 1) Download each ref from MinIO → extract first keyframe → normalise to JPEG
        const refPaths: string[] = [];
        for (let i = 0; i < input.refKeys.length; i++) {
          const refKey = input.refKeys[i];
          if (!refKey) continue;
          const raw = await minio.downloadObject(refKey);
          const frames = await extractKeyframesFromBuffer(raw, { maxFrames: 1 });
          const frame = frames[0];
          if (!frame) continue;
          const norm = await normaliseToJpeg(frame, { minSide: 1024 });
          const p = join(dir, `ref-${i}.jpg`);
          await writeFile(p, norm);
          refPaths.push(p);
        }

        // 2) Read subject images from disk → normalise → write to tmpdir
        const subjectPaths: string[] = [];
        for (let i = 0; i < input.subjectImagePaths.length; i++) {
          const subjectPath = input.subjectImagePaths[i];
          if (!subjectPath) continue;
          const raw = await readFile(subjectPath);
          const norm = await normaliseToJpeg(raw, { minSide: 1024 });
          const p = join(dir, `subject-${i}.jpg`);
          await writeFile(p, norm);
          subjectPaths.push(p);
        }

        // 3) Slot allocation: subjects first (identity priority), refs fill remaining up to 14
        const NBP_MAX_REFS = 14;
        const subjectSlots = subjectPaths.slice(0, NBP_MAX_REFS);
        const remaining = NBP_MAX_REFS - subjectSlots.length;
        const refSlots = refPaths.slice(0, Math.max(0, remaining));
        const refsSkipped = Math.max(0, refPaths.length - refSlots.length);

        const referenceImages = [...subjectSlots, ...refSlots].map((path, idx) => ({
          path,
          roleLabel: idx < subjectSlots.length ? 'subject' : 'reference',
        }));

        // 4) Build prompt — high-reject categories get a safe prefix on first attempt
        const HIGH_REJECT = new Set([
          'datamosh', 'dreamcore', 'dystopian', 'wierdcore', 'surrealism',
          'trip', 'thermal', 'x-ray', 'night-vision', 'glitch',
        ]);
        const isRisky = input.effectTags.some((t) => HIGH_REJECT.has(t));
        const safePrefix = isRisky
          ? 'Family-friendly cinematic mood study, no blood, no gore, no explicit content. '
          : '';
        const basePrompt =
          `Fuse ${referenceImages.length} reference images into one cohesive moodboard keyframe. ` +
          `Primary effect(s): ${input.effectTags.join(', ')}. ` +
          (input.styleHint ? `Style hint: ${input.styleHint}. ` : '') +
          `Preserve identity of any subject reference. Capture lighting, palette, lens character, and framing. ` +
          `Output a single still suitable as image-to-video seed for Veo 3.1. ` +
          `Forbidden: text overlays, watermarks, frames, borders, multi-panel layouts.`;

        let safetyRetryUsed = false;

        // Inner helper — calls NBP with the real two-param signature.
        // NanoBananaProInput.parse() applies all zod defaults (model, aspectRatio, etc.)
        // so the object satisfies NanoBananaProInputT without unsafe casts.
        const callNbp = async (prompt: string) => {
          try {
            const nbpInput = NanoBananaProInput.parse({
              op: 'nano-banana-pro',
              prompt,
              referenceImages,
              imageSize: sdkImageSize,
            });
            return await generateImageNanoBananaPro(nbpInput, mfClient);
          } catch (err) {
            const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            if (/safety|blocked|filtered|prohibited/i.test(msg)) {
              throw new SafetyRejectedError(msg, input.effectTags);
            }
            throw err;
          }
        };

        // 5) First attempt, with optional safety-aware prefix
        let nbpResult;
        try {
          nbpResult = await callNbp(safePrefix + basePrompt);
        } catch (err) {
          if (err instanceof SafetyRejectedError) {
            safetyRetryUsed = true;
            // One retry with a more conservative abstract prompt
            const retryPrompt =
              'Abstract stylised composition study. Soft conceptual rendering, painterly, ' +
              'no realistic depiction of harmful content. ' + basePrompt;
            try {
              nbpResult = await callNbp(retryPrompt);
            } catch (err2) {
              if (err2 instanceof SafetyRejectedError) {
                // Both attempts blocked — caller must downgrade to TEXT_ONLY mode
                throw new SafetyRejectedError(
                  `NBP fusion blocked for tags=[${input.effectTags.join(',')}] after safety retry. ` +
                    `Caller should downgrade to TEXT_ONLY mode.`,
                  input.effectTags,
                );
              }
              throw err2;
            }
          } else {
            throw err;
          }
        }

        // 6) Write base64 result to output JPEG, read dimensions via sharp
        const sharp = (await import('sharp')).default;
        const outputBuf = Buffer.from(nbpResult.base64, 'base64');
        const meta = await sharp(outputBuf).metadata();

        const outputDir = join(
          process.env['MEDIA_FORGE_PROJECT_DIR'] ?? '.media-forge',
          'moodboards',
        );
        await mkdirP(outputDir, { recursive: true });
        const outputPath = join(outputDir, `moodboard-${Date.now()}.jpg`);
        await writeFile(outputPath, outputBuf);

        return {
          outputPath,
          width: meta.width ?? parseInt(input.outputSize, 10),
          height: meta.height ?? parseInt(input.outputSize, 10),
          costUsd: 0.05, // approximation; EA1 patch will wire estimateRefsCost
          refsUsed: [...input.refKeys],
          refsSkipped,
          safetyRetryUsed,
        };
      } finally {
        // Always clean up tmp files regardless of success/failure
        await rm(dir, { recursive: true, force: true });
      }
    },

    // -----------------------------------------------------------------------
    // presignKeys — LRU-cached presigned URLs
    // -----------------------------------------------------------------------
    async presignKeys(input: RefsPresignInputT): Promise<Array<{ key: string; url: string }>> {
      const out: Array<{ key: string; url: string }> = [];
      for (const key of input.objectKeys) {
        const cached = cache.get(key);
        if (cached) {
          out.push({ key, url: cached });
          continue;
        }
        const url = await minio.presignObject(key, input.ttlSeconds);
        cache.set(key, url);
        out.push({ key, url });
      }
      return out;
    },
  };
}
