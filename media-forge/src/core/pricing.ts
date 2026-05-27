import { PRICING_OVERRIDES, type VideoModelSpec, type PricingUnit } from './models.js';

export interface NormalizeInput {
  readonly durationSec: number;
  /**
   * USD value of 1 Higgsfield (or other credit-based provider) credit.
   * Derive from active plan: Plus $39/mo for 1000 credits → 0.039.
   * Required when spec.pricing.unit === 'credits-per-video'.
   */
  readonly usdPerCredit?: number;
}

/**
 * Resolves effective pricing for a spec — checks PRICING_OVERRIDES first
 * (user / env-loaded contract pricing), falls back to spec's compiled-in pricing.
 */
function effectivePricing(spec: VideoModelSpec): VideoModelSpec['pricing'] {
  return PRICING_OVERRIDES.get(spec.id) ?? spec.pricing;
}

/**
 * Returns the USD-equivalent cost of generating one video matching `req` with `spec`,
 * regardless of the provider's native pricing unit. Used by `video-router` to rank
 * candidates across providers with heterogeneous pricing models.
 *
 * | unit                | formula                          |
 * |---------------------|----------------------------------|
 * | usd-per-second      | rate * durationSec               |
 * | usd-per-video       | rate (flat)                      |
 * | credits-per-video   | rate * usdPerCredit (required)   |
 */
export function normalizeCostUSD(spec: VideoModelSpec, req: NormalizeInput): number {
  const pricing = effectivePricing(spec);
  const unit: PricingUnit = pricing.unit;
  switch (unit) {
    case 'usd-per-second':
      return pricing.rate * req.durationSec;
    case 'usd-per-video':
      return pricing.rate;
    case 'credits-per-video':
      if (typeof req.usdPerCredit !== 'number' || req.usdPerCredit <= 0) {
        throw new Error(
          `usdPerCredit required for credits-per-video pricing (spec: ${spec.id})`,
        );
      }
      return pricing.rate * req.usdPerCredit;
    default: {
      const exhaustive: never = unit;
      throw new Error(`unsupported pricing unit: ${exhaustive as string}`);
    }
  }
}

/**
 * Loads runtime pricing overrides from env: MEDIA_FORGE_PRICING_OVERRIDES is a
 * JSON object mapping model id → { unit, rate, source, updatedAt, notes? }. Call
 * once at MCP server startup to honor enterprise contracts without recompile.
 */
export function loadPricingOverridesFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env['MEDIA_FORGE_PRICING_OVERRIDES'];
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Record<string, VideoModelSpec['pricing']>;
    for (const [id, pricing] of Object.entries(parsed)) {
      PRICING_OVERRIDES.set(id, { ...pricing, source: 'user-override' });
    }
  } catch (err) {
    process.stderr.write(
      `[pricing] failed to parse MEDIA_FORGE_PRICING_OVERRIDES: ${(err as Error).message}\n`,
    );
  }
}
