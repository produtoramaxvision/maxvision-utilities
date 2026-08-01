// tests/mcp/higgsfield-cli-routing.test.ts
// Proves MEDIA_FORGE_HF_CLI_ENABLED actually changes routing.
//
// It used to change nothing. 'higgsfield-cli' was registered in PROVIDERS and
// had a working, tested adapter, but handleVideoRoute filtered candidates with
// `getAdaptedProviders().has(spec.provider)` — an identity check. No spec is
// registered under 'higgsfield-cli', because it is a second TRANSPORT to the
// Higgsfield platform rather than a different platform, so the filter matched
// nothing and the flag was inert even when the caller named the provider
// explicitly.
//
// A feature flag that silently does nothing is worse than an absent one: the
// operator believes they switched something on.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleVideoRoute } from '../../src/mcp/handlers.js';
import { providerServesSpec, isSpecRoutable, getAdaptedProviders } from '../../src/mcp/handlers/shared.js';

const HF_FLAG = 'MEDIA_FORGE_HF_CLI_ENABLED';
const CREDIT_RATE = 'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT';

describe('higgsfield-cli routing', () => {
  let prevFlag: string | undefined;
  let prevRate: string | undefined;

  beforeEach(() => {
    prevFlag = process.env[HF_FLAG];
    prevRate = process.env[CREDIT_RATE];
    // Higgsfield models are credit-priced; without a rate they normalize to
    // Infinity and the router rejects them as unpriceable, which would mask the
    // behaviour under test.
    process.env[CREDIT_RATE] = '0.01';
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env[HF_FLAG];
    else process.env[HF_FLAG] = prevFlag;
    if (prevRate === undefined) delete process.env[CREDIT_RATE];
    else process.env[CREDIT_RATE] = prevRate;
  });

  // The higgsfield-cli -> higgsfield mapping this file used to assert was
  // REMOVED: the two catalogues do not intersect. Live proof — routing
  // higgsfield-soul2 through the CLI adapter returns
  // `exit 4: No model with job_type "higgsfield-soul2"`. The mapping did not
  // make the flag work, it moved the failure past the cost guard and into the
  // provider.
  it('providerServesSpec is identity — no adapter serves another provider’s specs', () => {
    expect(providerServesSpec('higgsfield', 'higgsfield')).toBe(true);
    expect(providerServesSpec('higgsfield-cli', 'higgsfield-cli')).toBe(true);

    expect(providerServesSpec('higgsfield-cli', 'higgsfield')).toBe(false);
    expect(providerServesSpec('higgsfield', 'higgsfield-cli')).toBe(false);
    expect(providerServesSpec('higgsfield-cli', 'kling')).toBe(false);
    expect(providerServesSpec('kling', 'higgsfield')).toBe(false);
  });

  it('the flag adds higgsfield-cli to the adapted set, and its absence removes it', () => {
    delete process.env[HF_FLAG];
    expect(getAdaptedProviders().has('higgsfield-cli')).toBe(false);

    process.env[HF_FLAG] = 'true';
    expect(getAdaptedProviders().has('higgsfield-cli')).toBe(true);
  });

  it('only the exact string "true" enables it', () => {
    // A permissive parse makes this easier to switch on by accident, and
    // switching it on in a hosted deployment routes every tenant's work through
    // one machine's OAuth session.
    for (const value of ['TRUE', '1', 'yes', 'on', '']) {
      process.env[HF_FLAG] = value;
      expect(getAdaptedProviders().has('higgsfield-cli'), `value: "${value}"`).toBe(false);
    }
  });

  // This test used to assert that the provider had NO routable spec — it pinned
  // the broken state as if it were the design. The provider was declared with an
  // empty catalogue, so naming it always failed: the CLI's job_type values and
  // the `higgsfield` registry ids are disjoint sets, and `higgsfield-soul2` (a
  // video spec) is not another name for `text2image_soul_v2` (an image job type).
  //
  // Registering the CLI's OWN job types under its OWN provider is what fixed it,
  // and that is not a mapping table: id === job_type, which is exactly what
  // `buildCliArgs` passes through.
  it('preferProvider: "higgsfield-cli" now resolves to one of its own job types', async () => {
    process.env[HF_FLAG] = 'true';

    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a slow push-in on a quiet street',
      durationSec: 5,
      resolution: '1080p',
      preferProvider: 'higgsfield-cli',
    });

    expect(result.provider).toBe('higgsfield-cli');
    // The id IS the CLI job type. Anything else here would mean the router
    // handed the adapter a string the CLI has never heard of, which is the
    // failure this whole entry exists to end.
    expect(['kling3_0_turbo', 'kling3_0', 'seedance_2_0', 'seedance_2_0_mini']).toContain(
      result.modelId,
    );
  });

  it('a CLI spec is never auto-selected without a declared credit rate', async () => {
    process.env[HF_FLAG] = 'true';
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];

    // No preferProvider: this is the open cost sort. Credits are a prepaid
    // bucket that expires; converting them to dollars on a rate nobody supplied
    // would let the router spend a different currency than the caller budgeted
    // in. `credits-per-second` throws without the rate and normalizeCostUSDSafe
    // turns that into POSITIVE_INFINITY, so the spec is reachable by name and
    // never wins on price.
    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a slow push-in on a quiet street',
      durationSec: 5,
      resolution: '720p',
    });

    expect(result.provider).not.toBe('higgsfield-cli');
  });

  it('the same call fails when the flag is off — proving the flag is load-bearing', async () => {
    delete process.env[HF_FLAG];

    await expect(
      handleVideoRoute({
        mode: 't2v',
        prompt: 'a slow push-in on a quiet street',
        durationSec: 5,
        resolution: '1080p',
        preferProvider: 'higgsfield-cli',
      }),
    ).rejects.toThrow(/higgsfield-cli/);
  });

  it('isSpecRoutable still accepts the always-on providers regardless of the flag', () => {
    delete process.env[HF_FLAG];
    expect(isSpecRoutable('google')).toBe(true);
    expect(isSpecRoutable('kling')).toBe(true);
    expect(isSpecRoutable('higgsfield')).toBe(true);
  });
});
