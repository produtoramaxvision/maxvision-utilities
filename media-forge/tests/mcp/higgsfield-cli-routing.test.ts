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

  it('providerServesSpec maps higgsfield-cli onto higgsfield specs, and nothing else', () => {
    expect(providerServesSpec('higgsfield-cli', 'higgsfield')).toBe(true);
    expect(providerServesSpec('higgsfield', 'higgsfield')).toBe(true);
    // The mapping is one-directional and narrow. The API adapter must not be
    // treated as able to run CLI-only specs, and neither serves anyone else.
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

  it('preferProvider: "higgsfield-cli" resolves to a Higgsfield model when enabled', async () => {
    process.env[HF_FLAG] = 'true';

    const result = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a slow push-in on a quiet street',
      durationSec: 5,
      resolution: '1080p',
      preferProvider: 'higgsfield-cli',
    });

    // The chosen spec is registered under 'higgsfield' — that is the point. The
    // CLI runs the same models; only the credential and the bill differ.
    expect(result.provider).toBe('higgsfield');
    expect(result.modelId).toMatch(/^higgsfield-/);
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
