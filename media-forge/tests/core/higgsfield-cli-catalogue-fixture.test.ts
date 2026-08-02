// The registry's CLI specs, checked against a captured catalogue — offline.
//
// Until this file existed, the only thing proving `higgsfield-cli` specs matched
// the platform was tests/video/providers/higgsfield-cli-cost-live.test.ts, which
// needs network and an OAuth session. CI has neither, so a wrong rate or a
// withdrawn model was invisible until somebody happened to run the live gate on
// their own machine.
//
// The fixture splits that into two failures that mean different things:
//
//   this file            registry vs fixture. Offline, every CI run.
//                        Fails when the CODE drifts from what was measured.
//   the live gate        fixture vs platform.
//                        Fails when the PLATFORM drifts from what we captured.
//
// Only the second one is a reason to re-run
// scripts/capture-higgsfield-cli-catalogue.mjs. A failure here means someone
// edited a rate without measuring it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VIDEO_MODELS, type VideoModelSpec } from '../../src/core/models.js';

interface Catalogue {
  readonly capturedAt: string;
  readonly counts: { videoModels: number; imageModels: number; workflows: number };
  readonly videoModels: readonly string[];
  readonly imageModels: readonly string[];
  readonly workflows: readonly string[];
  readonly costs: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const FIXTURE: Catalogue = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/higgsfield-cli-catalogue.json'), 'utf8'),
) as Catalogue;

const CLI_SPECS: VideoModelSpec[] = Object.values(VIDEO_MODELS).filter(
  (s) => s.provider === 'higgsfield-cli',
);

/** What the registry says a render costs, in credits, before the USD conversion. */
function expectedCredits(spec: VideoModelSpec, resolution: string, durationSec: number): number {
  const multiplier =
    spec.pricing.resolutionMultipliers?.[
      resolution as keyof NonNullable<typeof spec.pricing.resolutionMultipliers>
    ] ?? 1.0;
  return spec.pricing.rate * multiplier * durationSec;
}

describe('higgsfield-cli catalogue fixture', () => {
  it('was captured, and says when', () => {
    expect(FIXTURE.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the counts agree with the lists they summarise', () => {
    // A hand-edited fixture is the failure mode this catches: the counts are the
    // headline number quoted in TODOS.md and the arrays are what the assertions
    // below actually read.
    expect(FIXTURE.counts.videoModels).toBe(FIXTURE.videoModels.length);
    expect(FIXTURE.counts.imageModels).toBe(FIXTURE.imageModels.length);
    expect(FIXTURE.counts.workflows).toBe(FIXTURE.workflows.length);
  });

  it('every registry CLI spec is a job type the platform publishes', () => {
    // `buildCliArgs` passes `req.modelId` straight through as the job type, so a
    // spec id absent from the catalogue is a guaranteed `exit 4: No model with
    // job_type "..."` at submit time.
    const published = new Set([...FIXTURE.videoModels, ...FIXTURE.workflows]);
    for (const spec of CLI_SPECS) {
      expect(published.has(spec.id), `${spec.id} is not in the captured catalogue`).toBe(true);
    }
  });

  it('prices every resolution each spec declares — no silent gaps', () => {
    // A spec that advertises 480p and has no 480p measurement is a rate applied
    // to a resolution nobody priced. Missing cells must fail, not be skipped.
    for (const spec of CLI_SPECS) {
      const grid = FIXTURE.costs[spec.id];
      expect(grid, `${spec.id} has no captured costs`).toBeDefined();
      for (const resolution of spec.resolutions) {
        const cells = Object.keys(grid!).filter((k) => k.startsWith(`${resolution}@`));
        expect(cells.length, `${spec.id} declares ${resolution} but nothing priced it`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('the registry rate reproduces every measured price exactly', () => {
    // rate x resolutionMultiplier x durationSec. Every CLI model came back
    // exactly linear in duration when measured, which is why the unit is
    // credits-per-SECOND — this assertion is what keeps that claim true.
    for (const spec of CLI_SPECS) {
      const grid = FIXTURE.costs[spec.id] ?? {};
      for (const [cell, measured] of Object.entries(grid)) {
        const [resolution, durationPart] = cell.split('@');
        const durationSec = Number.parseInt(durationPart!.replace('s', ''), 10);
        expect(
          expectedCredits(spec, resolution!, durationSec),
          `${spec.id} ${cell}: registry says ${expectedCredits(spec, resolution!, durationSec)}, ` +
            `the platform charged ${measured}`,
        ).toBeCloseTo(measured, 6);
      }
    }
  });

  it('never prices a duration past the spec ceiling', () => {
    // maxDurationSec on the two Studios is CONSERVATIVE and unmeasured —
    // `generate cost` accepts 600 and just multiplies, because it is a pricing
    // function and not a validator. A fixture cell above the ceiling would look
    // like evidence the ceiling is wrong when it is only evidence the pricer
    // does arithmetic.
    for (const spec of CLI_SPECS) {
      for (const cell of Object.keys(FIXTURE.costs[spec.id] ?? {})) {
        const durationSec = Number.parseInt(cell.split('@')[1]!.replace('s', ''), 10);
        expect(durationSec, `${spec.id} ${cell} exceeds maxDurationSec`).toBeLessThanOrEqual(
          spec.maxDurationSec,
        );
      }
    }
  });
});
