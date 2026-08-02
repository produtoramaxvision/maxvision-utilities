import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateHiggsfieldPricingAtBoot,
  _resetValidatedPricingForTests,
  usdPerCreditFor,
  USD_PER_CREDIT,
} from '../../src/core/higgsfield-pricing.js';

describe('higgsfield-pricing (D-6)', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });
  afterEach(() => {
    // FIX (CodeRabbit round 10, PR#10): the "accepts Plus plan" test leaves
    // USD_PER_CREDIT and the private _validated set to 0.039 in the ESM
    // module cache. Subsequent tests that read the binding would see the
    // stale validated value. Reset both via the exported test utility.
    _resetValidatedPricingForTests();
    if (prev === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prev;
  });

  it('validateHiggsfieldPricingAtBoot accepts Plus plan (0.039)', () => {
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    expect(() => validateHiggsfieldPricingAtBoot()).not.toThrow();
  });

  it('updates the exported USD_PER_CREDIT binding to the validated value (CodeRabbit round 10)', async () => {
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    validateHiggsfieldPricingAtBoot();
    // Re-import to read the LIVE binding (not the captured value at the top of this file).
    const mod = await import('../../src/core/higgsfield-pricing.js');
    expect(mod.USD_PER_CREDIT).toBeCloseTo(0.039, 6);
    // Sanity: the top-of-file import was captured BEFORE validate ran, so it's still NaN
    // (or whatever the live binding was at that moment).
    expect(typeof USD_PER_CREDIT).toBe('number');
  });

  it('rejects values outside 0.001–1.0', () => {
    for (const bad of ['0', '-0.5', 'abc', 'Infinity', '5.0', '0.0001']) {
      process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = bad;
      expect(() => validateHiggsfieldPricingAtBoot(), `expected ${bad} invalid`).toThrow();
    }
  });

  it('rejects trailing-garbage strings (CodeRabbit round 9 — Number() vs parseFloat)', () => {
    // parseFloat('0.039abc') silently returns 0.039; Number('0.039abc') returns NaN.
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039abc';
    expect(() => validateHiggsfieldPricingAtBoot()).toThrow();
  });

  it('rejects missing env var', () => {
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    expect(() => validateHiggsfieldPricingAtBoot()).toThrow(/MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT/);
  });
});

// ---------------------------------------------------------------------------
// Two pools, two rates.
//
// The Cloud API and the `higgsfield` CLI bill SEPARATE credit balances at
// separate prices. One global rate priced both, and on 2026-08-01 an accidental
// 350-credit CLI burst that cost $16.92 at the subscription rate would have been
// reported as $21.88 — 29.3% high on every CLI job.
// ---------------------------------------------------------------------------
describe('usdPerCreditFor — API and CLI pools resolve independently', () => {
  const API = 'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT';
  const CLI = 'MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT';
  let prevApi: string | undefined;
  let prevCli: string | undefined;

  beforeEach(() => {
    prevApi = process.env[API];
    prevCli = process.env[CLI];
    _resetValidatedPricingForTests();
  });
  afterEach(() => {
    _resetValidatedPricingForTests();
    if (prevApi === undefined) delete process.env[API];
    else process.env[API] = prevApi;
    if (prevCli === undefined) delete process.env[CLI];
    else process.env[CLI] = prevCli;
  });

  it('prices the CLI pool at the subscription rate, not the API rate', () => {
    process.env[API] = '0.0625';
    process.env[CLI] = '0.0483333';
    validateHiggsfieldPricingAtBoot();

    expect(usdPerCreditFor('higgsfield')).toBeCloseTo(0.0625, 7);
    expect(usdPerCreditFor('higgsfield-cli')).toBeCloseTo(0.0483333, 7);
  });

  it('reports the incident spend at the invoiced figure', () => {
    // The exact numbers from the 2026-08-01 burst: 350 CLI credits, invoiced
    // $16.92. At the API rate the same jobs report $21.88.
    process.env[API] = '0.0625';
    process.env[CLI] = '0.0483333';
    validateHiggsfieldPricingAtBoot();

    expect(350 * usdPerCreditFor('higgsfield-cli')).toBeCloseTo(16.92, 2);
    expect(350 * usdPerCreditFor('higgsfield')).toBeCloseTo(21.88, 2);
  });

  it('leaves the CLI pool unpriced when its rate is unset — never borrows the API rate', () => {
    // Silently substituting the API rate is the bug, not the fallback. NaN
    // propagates to POSITIVE_INFINITY in the router, which is how every
    // credit-priced spec with no declared rate already behaves.
    process.env[API] = '0.0625';
    delete process.env[CLI];
    validateHiggsfieldPricingAtBoot();

    expect(usdPerCreditFor('higgsfield')).toBeCloseTo(0.0625, 7);
    expect(usdPerCreditFor('higgsfield-cli')).toBeNaN();
  });

  it('validates the CLI rate against the same envelope when present', () => {
    process.env[API] = '0.0625';
    for (const bad of ['0', '-0.5', 'abc', '5.0', '0.0001']) {
      process.env[CLI] = bad;
      expect(() => validateHiggsfieldPricingAtBoot(), `expected ${bad} invalid`).toThrow(
        /MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT/,
      );
    }
  });

  it('creditsToUsd on the CLI transport uses the CLI rate', async () => {
    process.env[API] = '0.0625';
    process.env[CLI] = '0.0483333';
    validateHiggsfieldPricingAtBoot();

    const { creditsToUsd } = await import('../../src/video/providers/higgsfield-cli.js');
    expect(creditsToUsd(350)).toBeCloseTo(16.92, 2);
  });
});
