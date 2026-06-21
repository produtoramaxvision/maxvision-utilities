// src/billing/pricing.ts
// Local pricing helper — media-forge does NOT depend on @maxvision/credit-core.
// Converts a USD cost into integer credits: ceil((costUsd * markup) / creditValueUsd).
// ceil() guarantees we never under-charge on fractional credits (margin-safe).
export function priceCredits(a: {
  costUsd: number;
  markup: number;
  creditValueUsd: number;
}): number {
  return Math.ceil((a.costUsd * a.markup) / a.creditValueUsd);
}

// Credit-conversion constants (spec §4.3). Centralized so the live download-capture
// path (mcp/handlers) and the webhook-first completion path (kling-webhook-handler)
// agree on the same markup/credit value — a divergence here would mean a job
// captured via webhook bills a different amount than the same job captured live.
export const IMAGE_MARKUP = 10;
export const VIDEO_MARKUP = 4;
export const DEFAULT_CREDIT_VALUE_USD = 0.01;

/** Video actual-cost (USD) → integer credits, using the same default credit value
 *  the live capture path uses. This layer has no tenant-specific creditValueUsd
 *  context (same limit as the live path), so the default is the source of truth
 *  for both — keeping webhook-first and live captures byte-for-byte identical. */
export function videoActualCredits(actualUsd: number): number {
  return priceCredits({
    costUsd: actualUsd,
    markup: VIDEO_MARKUP,
    creditValueUsd: DEFAULT_CREDIT_VALUE_USD,
  });
}
