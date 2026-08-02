/**
 * D-6 — boot-time validation of MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT.
 *
 * Valid range: 0.001 ≤ value ≤ 1.0
 *   Plus tier ≈ 0.039  ($39 / 1000 credits)
 *   Ultra tier ≈ 0.0316 ($79 / 2500 credits)
 *   Business tier ≈ 0.0266 ($399 / 15000 credits)
 * The 0.001–1.0 envelope leaves three orders of magnitude of headroom in either direction
 * — anything outside is almost certainly a config typo.
 *
 * ## Two pools, two rates
 *
 * Higgsfield bills the Cloud API and the `higgsfield` CLI from SEPARATE credit
 * balances at different prices:
 *
 *   Cloud API     top-up, "16 credits = $1"   → 0.0625 USD/credit
 *   CLI (OAuth)   the monthly plan bucket     → plan price ÷ plan credits
 *
 * One global rate priced both, and the CLI transport is the one that actually
 * ran: on 2026-08-01 an accidental burst of 350 CLI credits cost $16.92 at the
 * subscription rate while this module would have reported $21.88 — every CLI
 * job overstated by 29.3%.
 *
 * The objection this used to answer ("two rates for one provider's credit is how
 * the cost report starts disagreeing with the invoice") does not apply, because
 * they are not one provider: the registry declares `higgsfield` and
 * `higgsfield-cli` as distinct `Provider` values, so the rate resolves from
 * `spec.provider` with no ambiguity about which pool a job draws from.
 *
 * The CLI rate is NOT defaulted. Its value is the operator's own plan arithmetic
 * ($29/mo ÷ 600 credits for Pro), not a public constant, and silently falling
 * back to the API rate is exactly the bug above. Unset ⇒ NaN ⇒ CLI specs price
 * as unpriced, which is the behaviour the router already applies to every
 * credit-priced spec with no declared rate.
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

/**
 * Validated USD-per-credit rate for the CLI/subscription pool.
 *
 * NaN unless MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT is set. Optional by
 * design — see the two-pools note at the top of this file for why it has no
 * default and why the API rate is not a legal stand-in.
 */
export let CLI_USD_PER_CREDIT: number = Number.NaN;

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

  // Optional, but validated to the same envelope when present: an unnoticed typo
  // in the CLI rate is the same class of failure as one in the API rate, and the
  // CLI is the transport that spends.
  const cliRaw = process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'];
  if (cliRaw !== undefined && cliRaw !== '') {
    const cliValue = Number(cliRaw);
    if (!Number.isFinite(cliValue) || cliValue < MIN || cliValue > MAX) {
      throw new Error(
        `MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT='${cliRaw}' is outside valid range ` +
          `[${MIN}, ${MAX}]. It is your plan price divided by the plan's monthly credits ` +
          '(Pro: 29 / 600 = 0.0483333).',
      );
    }
    CLI_USD_PER_CREDIT = cliValue;
  }

  return v;
}

/**
 * The rate that applies to a given provider's credits.
 *
 * Returns NaN when the pool has no declared rate. Callers already treat a
 * non-finite rate as "unpriced" rather than substituting one, which is the whole
 * point: an unset CLI rate must not silently borrow the API rate.
 */
export function usdPerCreditFor(provider: string): number {
  const isCli = provider === 'higgsfield-cli';
  const validated = isCli ? CLI_USD_PER_CREDIT : USD_PER_CREDIT;
  if (Number.isFinite(validated) && validated > 0) return validated;

  // Env fallback for the paths that never run boot validation — direct provider
  // construction and unit tests that set the variable without booting. It reads
  // the SAME variable the boot validator reads, so nothing is priced at a number
  // nobody configured; it just skips the range check.
  const raw =
    process.env[
      isCli
        ? 'MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'
        : 'MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'
    ];
  if (raw === undefined || raw === '') return Number.NaN;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
}

/** Test utility — restores the unvalidated state so each test starts clean. */
export function _resetValidatedPricingForTests(): void {
  _validated = undefined;
  USD_PER_CREDIT = Number.NaN;
  CLI_USD_PER_CREDIT = Number.NaN;
}
