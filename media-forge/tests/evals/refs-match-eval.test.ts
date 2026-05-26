/**
 * Refs-match eval harness — 10 briefs, ≥70% pass target.
 *
 * Gated by MEDIA_FORGE_RUN_EVALS=true. Requires real MinIO + Voyage creds
 * at runtime. Skipped unconditionally in default `pnpm test` (unit suite).
 *
 * Usage (with live creds):
 *   MEDIA_FORGE_RUN_EVALS=true \
 *   MINIO_ENDPOINT=https://s3.meuagente.api.br \
 *   MINIO_ACCESS_KEY=<key> MINIO_SECRET_KEY=<secret> \
 *   VOYAGE_API_KEY=<key> \
 *   pnpm test:evals
 *
 * What this eval measures:
 *   For each brief, runBriefEnd2End resolves effectTags → searches MinIO →
 *   downloads first ref → extracts keyframe → computes cosine(vec, vec) ≈ 1.0.
 *   This is a pipeline-connectivity gate, not a discriminative quality test.
 *   See src/cli/eval-runner.ts for the full scope and rationale.
 *
 * Pass criteria:
 *   - Individual: refMatchScore >= 0.65 AND verdict !== 'error'
 *   - Aggregate:  firstAttemptPassRate >= 70% (≥7 of 10 briefs)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Brief {
  id: string;
  brief: string;
  effectTags: string[];
}

// ---------------------------------------------------------------------------
// Load briefs synchronously (matches house style from reviewer-calibration.test.ts)
// ---------------------------------------------------------------------------

const briefs = JSON.parse(
  readFileSync(resolve('tests/evals/fixtures/refs-eval-briefs.json'), 'utf8'),
) as Brief[];

// ---------------------------------------------------------------------------
// Gate — skip the entire suite unless MEDIA_FORGE_RUN_EVALS=true
// ---------------------------------------------------------------------------

const SHOULD_RUN = process.env['MEDIA_FORGE_RUN_EVALS'] === 'true';

// ---------------------------------------------------------------------------
// Eval suite — single it() that loops, so the firstAttemptPass counter is
// coherent and the aggregate assertion is not order-dependent.
// (Deviation from plan's per-brief it() pattern: plan uses mutation across
//  parallel it() callbacks; single-it loop matches reviewer-calibration.test.ts
//  house style and avoids race conditions.)
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)('refs-match eval (10 briefs, ≥70% pass target)', () => {
  it(
    'runs all briefs and checks individual + aggregate pass rate',
    async () => {
      const { runBriefEnd2End } = await import('../../src/cli/eval-runner.js');

      let firstAttemptPass = 0;
      const results: Array<{
        id: string;
        verdict: string;
        refMatchScore?: number;
        refsFound?: number;
        reason?: string;
      }> = [];

      for (const b of briefs) {
        const result = await runBriefEnd2End({ prompt: b.brief, effectTags: b.effectTags });
        const passed =
          result.verdict !== 'error' &&
          result.refMatchScore !== undefined &&
          result.refMatchScore >= 0.65;
        if (passed) firstAttemptPass++;
        results.push({ id: b.id, ...result });
      }

      // Log results for visibility (mirrors reviewer-calibration.test.ts pattern)
      const passRate = firstAttemptPass / briefs.length;
      console.warn(
        `\nRefs-match eval: ${firstAttemptPass}/${briefs.length} passed (${(passRate * 100).toFixed(1)}%)`,
      );
      for (const r of results) {
        const scoreStr =
          r.refMatchScore !== undefined ? r.refMatchScore.toFixed(4) : 'n/a';
        console.warn(
          `  ${r.verdict === 'pass' ? 'PASS' : 'FAIL'} [${r.id}] score=${scoreStr} refs=${r.refsFound ?? 0}${r.reason ? ` reason=${r.reason}` : ''}`,
        );
      }

      // Individual assertions — each brief must not be an error
      for (const r of results) {
        expect(r.verdict, `brief ${r.id} should not error (reason: ${r.reason ?? 'none'})`).not.toBe(
          'error',
        );
      }

      // Aggregate assertion — ≥70% pass rate
      expect(
        passRate,
        `Pass rate ${(passRate * 100).toFixed(1)}% is below the 70% target. ` +
          `Only ${firstAttemptPass}/${briefs.length} briefs passed.`,
      ).toBeGreaterThanOrEqual(0.7);
    },
    // 3-minute budget: 10 briefs × ~15s each (MinIO + Voyage latency) + headroom
    180_000,
  );
});
