import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateHiggsfieldPricingAtBoot,
  _resetValidatedPricingForTests,
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
