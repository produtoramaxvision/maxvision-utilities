// Live gate: the credit rates in src/core/models.ts against Higgsfield's own answer.
//
// `higgsfield generate cost <job_type>` is documented as "Estimate credits
// without creating a job" — it is a read, it spends nothing, and it is the only
// authority on what a CLI generation will actually cost. Every credits-per-second
// rate in the registry was measured through it; this asserts they still hold.
//
// Drift here is not cosmetic. These rates feed the pre-submit estimate, which
// feeds the daily cap and the cost guard, so a stale rate makes the guard wrong
// in whichever direction the platform moved.
//
// It runs through HiggsfieldCliProvider.fetchCostCredits with the real runner
// rather than shelling out directly, so buildCliArgs, the Windows shim
// resolution and the JSON parsing are all covered by the same assertion. That
// is what caught `kling3_0` rejecting `--resolution`: a hand-rolled exec would
// have been written with the flag the platform accepts, and proved nothing
// about what the provider actually sends.
//
// CONTRACT NOTE — the installed binary beats the published autodocs.
// context7's copy of the CLI autodocs describes `generate cost create <model>
// … | jq '.cost'` and `higgsfield account credits`. The installed binary
// (v1.1.20) takes `generate cost <job_type>` and returns `{"credits": N}`, and
// the account command is `account status`. Do not "fix" this file toward the
// docs without running the binary first.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  HiggsfieldCliProvider,
  defaultRunner,
} from '../../../src/video/providers/higgsfield-cli.js';
import { VIDEO_MODELS } from '../../../src/core/models.js';
import type { VideoGenerationRequest } from '../../../src/video/providers/base.js';

/**
 * Three conditions, not one — and the last two SKIP rather than fail.
 *
 * The flag alone used to gate this file, which made it the odd one out: with
 * MEDIA_FORGE_RUN_LIVE_TESTS=true on a machine that has no `higgsfield` binary
 * or no OAuth session, every assertion ERRORED. That reads as "the registry
 * rates are wrong" when the truth is "this machine cannot ask the question".
 *
 * A missing tool is not a failing test. The flag is the operator's intent and
 * stays a hard gate; the binary and the session are environment facts, and their
 * absence skips with a reason printed once.
 *
 * `preflight()` is the provider's own check and reports the two separately
 * (install vs `higgsfield auth login`), so the skip reason names the actual
 * remedy instead of a generic "unavailable".
 */
const FLAG_ON = process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true';

let unavailableReason: string | undefined;
if (FLAG_ON) {
  try {
    await new HiggsfieldCliProvider().preflight();
  } catch (err) {
    unavailableReason = err instanceof Error ? err.message : String(err);
  }
} else {
  unavailableReason = 'MEDIA_FORGE_RUN_LIVE_TESTS is not "true"';
}

if (FLAG_ON && unavailableReason !== undefined) {
  console.warn(`[higgsfield-cli-cost-live] skipped — ${unavailableReason}`);
}

const describeIfLive = unavailableReason === undefined ? describe : describe.skip;

/** The baseline every credits-per-second rate in the registry is expressed against. */
const BASELINE_RESOLUTION = '720p';
const BASELINE_DURATION_SEC = 5;

const CLI_SPECS = Object.values(VIDEO_MODELS).filter((m) => m.provider === 'higgsfield-cli');

function req(
  modelId: string,
  resolution: VideoGenerationRequest['resolution'],
): VideoGenerationRequest {
  return {
    modelId,
    mode: 't2v',
    prompt: 'registry rate check',
    durationSec: BASELINE_DURATION_SEC,
    resolution,
  };
}

describeIfLive('higgsfield-cli credit rates match the platform', () => {
  const provider = new HiggsfieldCliProvider();

  it('has CLI specs to check', () => {
    expect(CLI_SPECS.length).toBeGreaterThan(0);
  });

  for (const spec of CLI_SPECS) {
    it(`${spec.id}: ${spec.pricing.rate} credits/s at the ${BASELINE_RESOLUTION} baseline`, async () => {
      const actual = await provider.fetchCostCredits(req(spec.id, BASELINE_RESOLUTION));
      expect(actual).toBeCloseTo(spec.pricing.rate * BASELINE_DURATION_SEC, 5);
    }, 60_000);

    for (const [resolution, multiplier] of Object.entries(spec.pricing.resolutionMultipliers ?? {})) {
      it(`${spec.id}: ${resolution} costs ${multiplier}x the baseline`, async () => {
        const actual = await provider.fetchCostCredits(
          req(spec.id, resolution as VideoGenerationRequest['resolution']),
        );
        expect(actual).toBeCloseTo(spec.pricing.rate * BASELINE_DURATION_SEC * multiplier, 4);
      }, 60_000);
    }
  }
});

// ---------------------------------------------------------------------------
// The OTHER half of the fixture contract.
//
// tests/core/higgsfield-cli-catalogue-fixture.test.ts asserts registry-vs-fixture
// offline, every CI run. This asserts fixture-vs-PLATFORM, and it is the only
// one of the two that can tell you the catalogue itself moved — a model
// withdrawn, a workflow added, a price changed on Higgsfield's side.
//
// Keeping them separate keeps the failures readable. A red test here means
// re-run scripts/capture-higgsfield-cli-catalogue.mjs and look at the diff; a red
// test there means someone edited a rate without measuring it.
// ---------------------------------------------------------------------------

interface CapturedCatalogue {
  readonly capturedAt: string;
  readonly videoModels: readonly string[];
  readonly imageModels: readonly string[];
  readonly workflows: readonly string[];
}

const CATALOGUE: CapturedCatalogue = JSON.parse(
  readFileSync(resolve(__dirname, '../../fixtures/higgsfield-cli-catalogue.json'), 'utf8'),
) as CapturedCatalogue;

async function jobTypes(args: readonly string[]): Promise<string[]> {
  // The timeout is REQUIRED by CliRunner, and omitting it does not fail loudly:
  // the reject message formats `Math.round(undefined / 1000)` and reads
  // "timed out after NaNs", which looks like a platform hang rather than a
  // caller bug. 60s matches the per-test timeout below.
  const { stdout } = await defaultRunner([...args, '--json'], 60_000);
  const rows = JSON.parse(stdout) as Array<{ job_type: string }>;
  return rows.map((r) => r.job_type).sort();
}

describeIfLive('the captured catalogue still matches the platform', () => {
  it('video models are unchanged since the capture', async () => {
    expect(await jobTypes(['model', 'list', '--video'])).toEqual([...CATALOGUE.videoModels]);
  }, 60_000);

  it('image models are unchanged since the capture', async () => {
    expect(await jobTypes(['model', 'list', '--image'])).toEqual([...CATALOGUE.imageModels]);
  }, 60_000);

  it('workflows are unchanged since the capture', async () => {
    expect(await jobTypes(['workflow', 'list'])).toEqual([...CATALOGUE.workflows]);
  }, 60_000);
});
