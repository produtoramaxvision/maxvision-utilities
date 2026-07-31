// src/video/aggregator-routes.ts
// Models that are reachable through more than one provider.
//
// ## The problem
//
// Higgsfield resells Kling and Seedance on its own platform. `higgsfield model
// list --video` returns `kling3_0_turbo`, `kling3_0`, `kling2_6`, `seedance1_5`
// and the Seedance 2.0 family alongside Higgsfield's own models. So the SAME
// underlying model is reachable two ways, at two different prices, and
// `handleVideoRoute` treats every provider as an independent source — it has no
// way to know two entries are the same thing.
//
// ## What this file does, and deliberately does NOT do
//
// It records the relation and the measured price, and surfaces both. It does
// NOT pick between the two paths.
//
// That restraint is the point. Kling direct is metered spend in USD. Higgsfield
// credits are a prepaid monthly subscription bucket that expires — spending one
// is not the same kind of act as spending a dollar, and the plan for this work
// (2026-07-29, T4) already ruled explicitly against crossing the two units.
// Converting credits to dollars and sorting them together would be a modelling
// choice presented as a fact, which is exactly what the settlement work in this
// same branch existed to remove.
//
// So the router reports "this is also available on Higgsfield, at N credits/s"
// and lets the caller decide. Automatic cross-unit selection needs a declared
// conversion (MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT), and that is the operator's
// number to state, not ours to infer.
//
// ## Where the numbers come from
//
// `higgsfield generate cost <job_type>` against the real account on 2026-07-30 —
// a read, zero credits spent. Every model measured came back exactly linear in
// duration, so credits-per-second is the measurement and not an extrapolation:
//
//   kling3_0_turbo  720p   7.5 credits / 5s   15 credits / 10s   -> 1.5 c/s
//   kling3_0_turbo  1080p   10 credits / 5s   20 credits / 10s   -> 2.0 c/s
//   kling3_0        std     10 credits / 5s   20 credits / 10s   -> 2.0 c/s
//   kling3_0        pro   12.5 credits / 5s                      -> 2.5 c/s
//   kling3_0        4k      30 credits / 5s                      -> 6.0 c/s
//   seedance_2_0      480p   15 credits / 5s   30 credits / 10s  -> 3.0 c/s
//   seedance_2_0      720p 22.5 credits / 5s   45 credits / 10s  -> 4.5 c/s
//   seedance_2_0     1080p   45 credits / 5s   90 credits / 10s  -> 9.0 c/s
//   seedance_2_0_mini 480p    5 credits / 5s   10 credits / 10s  -> 1.0 c/s
//   seedance_2_0_mini 720p 12.5 credits / 5s   25 credits / 10s  -> 2.5 c/s
//
// `seedance_2_0_mini` refuses 1080p ("allowed: 480p, 720p"), which matches the
// registry's own resolutions for seedance-2.0-fast — so the omission below is
// the provider's constraint, not a gap in the measurement.
//
// Higgsfield also resells kling2_6 and seedance1_5, both measured, both left out
// of the map: neither has a direct-path entry in src/core/models.ts, so there is
// no second path to compare them against. A key here that names no registered
// model would be a relation to nothing.
//
// Prices are per ACCOUNT tier (this one is `pro`), so they are a measurement of
// one account, not a published rate card. MEASURED_ON carries the date so a
// stale number is visible rather than assumed current.

import type { Provider } from '../core/models.js';

/** The date the credit costs below were read off the live account. */
export const AGGREGATOR_RATES_MEASURED_ON = '2026-07-30';

export interface AggregatorPath {
  /** The provider that resells the model. */
  readonly provider: Provider;
  /** That provider's own identifier for it — what its API/CLI expects. */
  readonly jobType: string;
  /**
   * Credits per second, by resolution key.
   *
   * Credits, not dollars, on purpose: converting here would bake in a rate
   * nobody declared. `default` covers models whose price does not vary by
   * resolution (kling2_6 bills the same at every size it offers).
   */
  readonly creditsPerSecond: Readonly<Record<string, number>>;
}

/**
 * Keyed by the model id in src/core/models.ts — the DIRECT path's id.
 *
 * A model absent from this map is not a claim that no alternate path exists,
 * only that none has been measured. The router says as much rather than
 * implying the direct path is known-cheapest.
 */
export const RESOLD_VIDEO_MODELS: Readonly<Record<string, ReadonlyArray<AggregatorPath>>> =
  Object.freeze({
    'kling-3.0-turbo': [
      {
        provider: 'higgsfield',
        jobType: 'kling3_0_turbo',
        creditsPerSecond: { '720p': 1.5, '1080p': 2.0 },
      },
    ],
    'kling-v3-standard': [
      { provider: 'higgsfield', jobType: 'kling3_0', creditsPerSecond: { default: 2.0 } },
    ],
    'kling-v3-pro': [
      { provider: 'higgsfield', jobType: 'kling3_0', creditsPerSecond: { default: 2.5 } },
    ],
    'kling-v3-master': [
      { provider: 'higgsfield', jobType: 'kling3_0', creditsPerSecond: { default: 6.0 } },
    ],
    'seedance-2.0-standard': [
      {
        provider: 'higgsfield',
        jobType: 'seedance_2_0',
        creditsPerSecond: { '480p': 3.0, '720p': 4.5, '1080p': 9.0 },
      },
    ],
    'seedance-2.0-fast': [
      {
        provider: 'higgsfield',
        jobType: 'seedance_2_0_mini',
        // No 1080p entry: the provider rejects it for this model, matching the
        // registry's resolutions for seedance-2.0-fast.
        creditsPerSecond: { '480p': 1.0, '720p': 2.5 },
      },
    ],
  });

export interface AlternatePath {
  readonly provider: Provider;
  readonly jobType: string;
  readonly credits: number;
  readonly measuredOn: string;
}

/**
 * Alternate paths to the same underlying model, priced in the aggregator's own
 * unit.
 *
 * Returns an empty array — never a guess — when the model has no measured
 * alternate, or when the requested resolution was not among the ones measured.
 * A resolution we never priced must not silently fall back to another one: that
 * would report a number for a configuration nobody checked.
 */
export function alternatePathsFor(args: {
  readonly modelId: string;
  readonly durationSec: number;
  readonly resolution: string;
}): ReadonlyArray<AlternatePath> {
  const paths = RESOLD_VIDEO_MODELS[args.modelId];
  if (paths === undefined) return [];

  const out: AlternatePath[] = [];
  for (const path of paths) {
    const perSecond = path.creditsPerSecond[args.resolution] ?? path.creditsPerSecond['default'];
    if (perSecond === undefined) continue;
    out.push({
      provider: path.provider,
      jobType: path.jobType,
      credits: perSecond * args.durationSec,
      measuredOn: AGGREGATOR_RATES_MEASURED_ON,
    });
  }
  return out;
}

/** One line per alternate, for the routing rationale. */
export function describeAlternatePaths(paths: ReadonlyArray<AlternatePath>): string {
  if (paths.length === 0) return '';
  const each = paths
    .map((p) => `${p.provider} (${p.jobType}) at ${p.credits} credits`)
    .join('; ');
  // Says plainly that the two numbers are not comparable, because a reader who
  // sees a cost in USD next to a cost in credits will otherwise compare them.
  return (
    ` Also available via ${each} — credits are a prepaid subscription unit and are ` +
    `NOT converted to USD here, so this is not a cheaper/costlier claim. Set ` +
    `preferProvider to choose that path deliberately.`
  );
}
