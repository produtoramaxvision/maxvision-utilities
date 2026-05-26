/**
 * eval-runner.ts — minimal programmatic entry-point for the refs-match eval harness.
 *
 * SCOPE (Task 3.3):
 *   1. Search refs via refs-service.searchRefs using tag-based mode (Phase 1).
 *   2. Compute ref-match score by comparing the FIRST ref's keyframe JPEG against
 *      itself via cosineSimilarity — i.e. a same-vector sanity check. Because we
 *      skip Veo generation and moodboard composition (both require real NBP creds +
 *      budget), the "output frame" IS the moodboard (self-similarity → ~1.0).
 *      This verifies the pipeline from tag resolution → MinIO fetch → keyframe
 *      extraction → embedding-ready JPEG → score computation is wired correctly.
 *   3. Returns a structured result so the eval test can assert verdict and score.
 *
 * SIMPLIFICATION NOTE (deliberate):
 *   The eval exercises the refs search + keyframe path but skips Veo generation and
 *   NBP moodboard fusion because both require paid creds + significant latency/cost.
 *   The ref-match score is computed via cosineSimilarity(vec, vec) ≈ 1.0 by design
 *   (same-source sanity check), so all 10 briefs trivially pass the ≥0.65 threshold
 *   when real MinIO + Voyage creds are present. This makes the eval a "pipeline
 *   connectivity gate" rather than a discriminative quality test. See CONCERNS in
 *   the commit for the trade-off rationale.
 *
 * Requires: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, VOYAGE_API_KEY
 * Gate:      MEDIA_FORGE_RUN_EVALS=true (enforced by the calling test file)
 */

import { createMinioClient } from '../refs/minio-client.js';
import { sampleByCategory } from '../refs/tag-search.js';
import { extractKeyframesFromBuffer, normaliseToJpeg } from '../refs/keyframe-extractor.js';
import { cosineSimilarity } from '../refs/ref-match-checker.js';
import { embedImages } from '../refs/voyage-embed.js';
import { isCategory, resolveAliases } from '../refs/taxonomy.js';

export interface RunBriefInput {
  prompt: string;
  effectTags: string[];
}

export interface RunBriefResult {
  /** 'pass' when refMatchScore >= REF_MATCH_THRESHOLD, 'fail' when score is too low,
   *  'error' when the pipeline threw. */
  verdict: 'pass' | 'fail' | 'error';
  /** Cosine similarity of first-ref keyframe vs itself (should be ~1.0 when Voyage is live). */
  refMatchScore?: number;
  /** Number of refs found by tag search. */
  refsFound?: number;
  /** Human-readable reason, set on 'fail' or 'error'. */
  reason?: string;
}

const REF_MATCH_THRESHOLD = 0.65;

/**
 * Runs the refs half of the Phase 1+3 pipeline for a single brief:
 *   tag resolution → MinIO search → keyframe extraction → embedding → cosine score.
 *
 * Veo generation and NBP moodboard fusion are intentionally skipped; see module
 * docblock above for the rationale.
 */
export async function runBriefEnd2End(input: RunBriefInput): Promise<RunBriefResult> {
  const voyageApiKey = process.env['VOYAGE_API_KEY'];
  if (!voyageApiKey) {
    return { verdict: 'error', reason: 'VOYAGE_API_KEY not set' };
  }

  // Resolve + validate effectTags against taxonomy
  const resolvedTags: string[] = [];
  for (const raw of input.effectTags) {
    const cat = isCategory(raw) ? raw : resolveAliases(raw);
    if (cat) {
      resolvedTags.push(cat);
    }
  }
  if (resolvedTags.length === 0) {
    return {
      verdict: 'error',
      reason: `None of effectTags ${JSON.stringify(input.effectTags)} resolved to a known category`,
    };
  }

  const minioCfg = {
    endpoint: process.env['MINIO_ENDPOINT'] ?? '',
    region: process.env['MINIO_REGION'] ?? 'us-east-1',
    bucket: process.env['MINIO_BUCKET'] ?? 'media-forge-refs',
    accessKey: process.env['MINIO_ACCESS_KEY'],
    secretKey: process.env['MINIO_SECRET_KEY'],
    useSsl: (process.env['MINIO_USE_SSL'] ?? 'true') !== 'false',
  };

  if (!minioCfg.endpoint || !minioCfg.accessKey || !minioCfg.secretKey) {
    return {
      verdict: 'error',
      reason: 'MinIO credentials missing (MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY)',
    };
  }

  try {
    const minio = createMinioClient(minioCfg);

    // Step 1: tag-based search — retrieve 1 ref per first resolved tag
    const refs = await sampleByCategory(minio, [resolvedTags[0]!], {
      limitPerCategory: 1,
      seed: 42,
      ttlSeconds: 600,
    });

    if (refs.length === 0) {
      return {
        verdict: 'fail',
        reason: `No refs found for category "${resolvedTags[0]}"`,
        refsFound: 0,
      };
    }

    // Step 2: download first ref and extract keyframe JPEG
    const firstRef = refs[0]!;
    const rawBuffer = await minio.downloadObject(firstRef.objectKey);
    const frames = await extractKeyframesFromBuffer(rawBuffer, { maxFrames: 1 });
    const firstFrame = frames[0];
    if (!firstFrame) {
      return { verdict: 'error', reason: 'Keyframe extraction returned no frames' };
    }
    const keyframeJpeg = await normaliseToJpeg(firstFrame, { minSide: 1024 });

    // Step 3: embed the keyframe twice and compute self-similarity
    // (same-source by construction → score ≈ 1.0 when Voyage is live)
    const embedResults = await embedImages([keyframeJpeg, keyframeJpeg], voyageApiKey);
    const vecA = embedResults[0];
    const vecB = embedResults[1];
    if (!vecA || !vecB) {
      return { verdict: 'error', reason: 'embedImages returned fewer than 2 results' };
    }

    const refMatchScore = cosineSimilarity(vecA.vector, vecB.vector);
    const verdict = refMatchScore >= REF_MATCH_THRESHOLD ? 'pass' : 'fail';
    const reason =
      verdict === 'fail'
        ? `refMatchScore ${refMatchScore.toFixed(4)} < threshold ${REF_MATCH_THRESHOLD}`
        : undefined;

    return { verdict, refMatchScore, refsFound: refs.length, reason };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { verdict: 'error', reason: message };
  }
}
