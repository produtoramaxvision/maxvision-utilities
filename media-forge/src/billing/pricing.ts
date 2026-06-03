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
