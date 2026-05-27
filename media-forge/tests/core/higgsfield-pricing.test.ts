import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('higgsfield-pricing (D-6)', () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prev;
  });

  it('validateHiggsfieldPricingAtBoot accepts Plus plan (0.039)', async () => {
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    const { validateHiggsfieldPricingAtBoot } = await import('../../src/core/higgsfield-pricing.js');
    expect(() => validateHiggsfieldPricingAtBoot()).not.toThrow();
  });

  it('rejects values outside 0.001–1.0', async () => {
    const { validateHiggsfieldPricingAtBoot } = await import('../../src/core/higgsfield-pricing.js');
    for (const bad of ['0', '-0.5', 'abc', 'Infinity', '5.0', '0.0001']) {
      process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = bad;
      expect(() => validateHiggsfieldPricingAtBoot(), `expected ${bad} invalid`).toThrow();
    }
  });

  it('rejects missing env var', async () => {
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    const { validateHiggsfieldPricingAtBoot } = await import('../../src/core/higgsfield-pricing.js');
    expect(() => validateHiggsfieldPricingAtBoot()).toThrow(/MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT/);
  });
});
