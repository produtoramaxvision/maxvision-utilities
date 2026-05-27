/**
 * D-6 — boot-time validation of MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT.
 *
 * Valid range: 0.001 ≤ value ≤ 1.0
 *   Plus tier ≈ 0.039  ($39 / 1000 credits)
 *   Ultra tier ≈ 0.0316 ($79 / 2500 credits)
 *   Business tier ≈ 0.0266 ($399 / 15000 credits)
 * The 0.001–1.0 envelope leaves three orders of magnitude of headroom in either direction
 * — anything outside is almost certainly a config typo.
 */

const MIN = 0.001;
const MAX = 1.0;

let _validated: number | undefined;

export function validateHiggsfieldPricingAtBoot(): number {
  const raw = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  if (raw === undefined || raw === '') {
    throw new Error(
      'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is required at boot. ' +
        'Set it in your project .env (Plus plan: 0.039). See commands/setup.md.',
    );
  }
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < MIN || v > MAX) {
    throw new Error(
      `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT='${raw}' is outside valid range [${MIN}, ${MAX}]. ` +
        'Likely a typo. Plus plan: 0.039; Ultra: 0.0316; Business: 0.0266.',
    );
  }
  _validated = v;
  return v;
}

/** Module constant — only safe after validateHiggsfieldPricingAtBoot() has run.
 *  Cost-tracking code reads this instead of re-parsing the env var. */
export const USD_PER_CREDIT: number = _validated ?? Number.NaN;
// Note: at first import time _validated is undefined (boot validation hasn't run).
// Tests that need the validated value should call validateHiggsfieldPricingAtBoot() in their setup.
// Production boot calls it from src/mcp/server.ts before any handler can fire.
