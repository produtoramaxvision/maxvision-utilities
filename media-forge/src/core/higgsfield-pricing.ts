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

/**
 * Validated USD-per-credit rate. NaN until validateHiggsfieldPricingAtBoot()
 * runs successfully; once validated, gets updated here too so consumers reading
 * the exported binding see the live value (not a captured NaN snapshot).
 *
 * FIX (CodeRabbit round 9, PR#10, Critical): previously this was declared
 * `export const ... = _validated ?? Number.NaN`, which captured `_validated`
 * at module-load time (always `undefined` → `NaN`). The boot validator updated
 * the private `_validated` but never the exported binding, so consumers saw
 * NaN forever and silently fell back to a more-permissive env-var parser in
 * `resolveUsdPerCredit()`, bypassing the boot range check [0.001, 1.0].
 */
export let USD_PER_CREDIT: number = Number.NaN;

export function validateHiggsfieldPricingAtBoot(): number {
  const raw = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  if (raw === undefined || raw === '') {
    throw new Error(
      'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is required at boot. ' +
        'Set it in your project .env (Plus plan: 0.039). See commands/setup.md.',
    );
  }
  // Reject any input that does not stringify-roundtrip — guards against
  // trailing garbage that `parseFloat` would silently strip ('0.039abc').
  const v = Number(raw);
  if (!Number.isFinite(v) || v < MIN || v > MAX) {
    throw new Error(
      `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT='${raw}' is outside valid range [${MIN}, ${MAX}]. ` +
        'Likely a typo. Plus plan: 0.039; Ultra: 0.0316; Business: 0.0266.',
    );
  }
  _validated = v;
  USD_PER_CREDIT = v;
  return v;
}

/** Test utility — restores the unvalidated state so each test starts clean. */
export function _resetValidatedPricingForTests(): void {
  _validated = undefined;
  USD_PER_CREDIT = Number.NaN;
}
