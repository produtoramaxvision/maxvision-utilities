// tests/unit/billing/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { priceCredits } from '../../../src/billing/pricing.js';

describe('priceCredits', () => {
  it('exact division → integer credits', () => {
    // 0.20 * 10 / 0.01 = 200
    expect(priceCredits({ costUsd: 0.2, markup: 10, creditValueUsd: 0.01 })).toBe(200);
  });

  it('ceil rounding up on fractional credits (never under-charge)', () => {
    // 0.134 * 10 / 0.01 = 134.0000... → guard against float drift, still 134
    expect(priceCredits({ costUsd: 0.134, markup: 10, creditValueUsd: 0.01 })).toBe(134);
    // 0.06 * 4 / 0.01 = 24
    expect(priceCredits({ costUsd: 0.06, markup: 4, creditValueUsd: 0.01 })).toBe(24);
  });

  it('rounds a fractional result UP to the next whole credit', () => {
    // 0.0235 * 10 / 0.01 = 23.5 → 24
    expect(priceCredits({ costUsd: 0.0235, markup: 10, creditValueUsd: 0.01 })).toBe(24);
    // 0.001 * 1 / 0.01 = 0.1 → 1
    expect(priceCredits({ costUsd: 0.001, markup: 1, creditValueUsd: 0.01 })).toBe(1);
  });

  it('video markup 4 at conservative creditValue', () => {
    // 0.40 * 4 / 0.01 = 160
    expect(priceCredits({ costUsd: 0.4, markup: 4, creditValueUsd: 0.01 })).toBe(160);
  });

  it('zero cost → zero credits', () => {
    expect(priceCredits({ costUsd: 0, markup: 10, creditValueUsd: 0.01 })).toBe(0);
  });
});
