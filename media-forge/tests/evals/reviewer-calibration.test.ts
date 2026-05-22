/**
 * Reviewer calibration eval — 15 scenarios, ≥80% accuracy target.
 *
 * Gated by MEDIA_FORGE_RUN_EVALS=true. Requires ANTHROPIC_API_KEY (judge SDK mode).
 * Skipped by default in CI — no API key needed for standard test runs.
 *
 * Results are appended to tests/evals/results.jsonl (gitignored).
 *
 * Usage:
 *   pnpm test:evals
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { judgeAsset } from '../../src/review/llm-judge.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  expected_verdict: string;
  expected_root_cause: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Load scenarios via fs.readFileSync (Node 20 compatible — avoids import assertions)
// ---------------------------------------------------------------------------

const scenariosPath = resolve('tests/evals/fixtures/scenarios.json');
const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf8')) as Scenario[];

const SHOULD_RUN = process.env['MEDIA_FORGE_RUN_EVALS'] === 'true';
const PLACEHOLDER_ASSET = resolve('tests/evals/fixtures/placeholder.png');
const RESULTS_LOG = resolve('tests/evals/results.jsonl');

// ---------------------------------------------------------------------------
// Eval suite
// ---------------------------------------------------------------------------

describe.skipIf(!SHOULD_RUN)('Reviewer calibration eval (≥80% accuracy)', () => {
  it('judges 15 scenarios, accuracy ≥80%', async () => {
    let correct = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const s of scenarios) {
      // Build a refined_spec that matches the scenario description
      const verdict = await judgeAsset(
        {
          refinedSpec: { description: s.description, domain: 'product' },
          assetPath: PLACEHOLDER_ASSET,
          traceExcerpt: '',
          jobId: s.id,
        },
        { forceMode: 'sdk' },
      );

      // Skip directives — shouldn't happen with forceMode: 'sdk'
      if ('mode' in verdict) {
        results.push({
          ts: new Date().toISOString(),
          scenario: s.id,
          expected: s.expected_verdict,
          got: 'directive',
          correct: false,
        });
        continue;
      }

      const isCorrect =
        verdict.verdict === s.expected_verdict &&
        (s.expected_root_cause === 'none' ||
          verdict.errors.some((e) => e.class.includes(s.expected_root_cause)));

      if (isCorrect) correct++;

      results.push({
        ts: new Date().toISOString(),
        scenario: s.id,
        expected: s.expected_verdict,
        got: verdict.verdict,
        rootCauseStage: verdict.rootCauseStage,
        errors: verdict.errors.map((e) => e.class),
        correct: isCorrect,
      });
    }

    // Append to results.jsonl
    for (const r of results) {
      appendFileSync(RESULTS_LOG, `${JSON.stringify(r)}\n`);
    }

    const accuracy = correct / scenarios.length;
    // Log for visibility
    console.warn(
      `\nReviewer calibration: ${correct}/${scenarios.length} correct (${(accuracy * 100).toFixed(1)}%)`,
    );

    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  }, 600_000);
});
