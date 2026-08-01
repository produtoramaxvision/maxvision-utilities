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
import { HiggsfieldCliProvider } from '../../../src/video/providers/higgsfield-cli.js';
import { VIDEO_MODELS } from '../../../src/core/models.js';
import type { VideoGenerationRequest } from '../../../src/video/providers/base.js';

const SHOULD_RUN = process.env['MEDIA_FORGE_RUN_LIVE_TESTS'] === 'true';
const describeIfLive = SHOULD_RUN ? describe : describe.skip;

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
