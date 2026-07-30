import {
  VideoCostEstimateInput,
  type VideoCostEstimateInputT,
  VideoCostReportInput,
  type VideoCostReportInputT,
  VideoRouteInput,
  type VideoRouteInputT,
} from '../schemas.js';
import { queryReport, type CostReport } from '../../core/cost-tracker.js';
import { normalizeCostUSD } from '../../core/pricing.js';
import type { Provider, VideoModelSpec } from '../../core/models.js';
import { GoogleVeoProvider } from '../../video/providers/google-veo.js';
import { VIDEO_MODELS } from '../../core/models.js';
import { defaultDbPath, getAdaptedProviders } from './shared.js';

// ---------------------------------------------------------------------------
// handleVideoCostEstimate — estimate USD cost for a video generation request
// ---------------------------------------------------------------------------

export async function handleVideoCostEstimate(rawInput: unknown): Promise<{
  estimatedCostUSD: number;
  provider: string;
  modelId: string;
}> {
  const input: VideoCostEstimateInputT = VideoCostEstimateInput.parse(rawInput);
  const spec = VIDEO_MODELS[input.modelId];
  if (!spec) throw new Error(`unknown model: ${input.modelId}`);
  if (spec.provider !== 'google') {
    throw new Error(
      `provider ${spec.provider} not yet wired in P13 — only google/Veo supported`,
    );
  }
  const provider = new GoogleVeoProvider({ dbPath: defaultDbPath() });
  const usd = provider.estimateCostUSD(input);
  return { estimatedCostUSD: usd, provider: spec.provider, modelId: input.modelId };
}

// ---------------------------------------------------------------------------
// handleVideoCostReport — aggregate cost report from the local SQLite ledger
// ---------------------------------------------------------------------------

export async function handleVideoCostReport(rawInput: unknown): Promise<CostReport> {
  const input: VideoCostReportInputT = VideoCostReportInput.parse(rawInput);
  return queryReport({ dbPath: defaultDbPath(), periodDays: input.periodDays });
}

// ---------------------------------------------------------------------------
// handleVideoRoute — pick optimal provider+model for a video generation request
// ---------------------------------------------------------------------------
// Capability-before-cost routing heuristic. P14 adds Higgsfield, P15 adds Kling.
//
// Ranking rules (in priority order):
//   1. preferProvider filter — caller can force a specific provider.
//   2. P15 explicit tier overrides (pickExplicitTier) — certain modes/resolutions
//      are hard-wired to a specific Kling model before cost sort:
//        resolution=4k → kling-v3-master
//        mode=multi-shot → kling-v3-omni
//        mode=motion-brush | elements | lip-sync → kling-v3-pro
//   3. Pure cost sort (cheapest USD-equivalent wins) — google-default tiebreaker
//      removed in P15 (Option A). When preferProvider is 'google', caller must
//      pass it explicitly.
//
// P16: 'bytedance' will integrate here when SeedanceProvider lands.

/**
 * Providers that must never be chosen by the automatic cost sort (T16).
 *
 * The test is the PRICE, not a provider allowlist: anything that costs nothing
 * per generation wins an ascending cost sort unconditionally, so the rule has to
 * key on that property or it goes stale the next time a free provider is added.
 *
 * Callers reach these by naming them in `preferProvider`. That is the whole
 * mechanism — deliberate selection, never inference from cost.
 */
export function isOptInOnlyProvider(
  spec: { pricing: { rate: number } },
  _input: unknown,
): boolean {
  return spec.pricing.rate === 0;
}

export interface VideoRouteResult {
  readonly provider: Provider;
  readonly modelId: string;
  readonly mode: string;
  readonly estimatedCostUSD: number;
  readonly rationale: string;
}

export async function handleVideoRoute(rawInput: unknown): Promise<VideoRouteResult> {
  const input: VideoRouteInputT = VideoRouteInput.parse(rawInput);

  const allByMode = Object.values(VIDEO_MODELS)
    .filter((spec) => spec.modes.includes(input.mode as never))
    // Constrain to providers with a wired adapter. Models registered for
    // future providers (Kling P15, Seedance P16) must not be selected until
    // their adapter is available in getAdaptedProviders(). When
    // MEDIA_FORGE_SEEDANCE_ENABLED=false, 'bytedance' is excluded here.
    .filter((spec) => getAdaptedProviders().has(spec.provider))
    // FIX (Codex P2, PR#10): filter candidates by requested duration +
    // resolution BEFORE cost sort. Without this, sorter could pick cheapest
    // model that fails downstream validation (e.g. higgsfield-speak with
    // maxDurationSec=30 cheaper than higgsfield-speak2 maxDurationSec=60 for
    // a 45s lip-sync request → submit rejected). Defensive: spec missing
    // maxDurationSec or resolutions arrays does not filter out.
    .filter((spec) =>
      typeof spec.maxDurationSec === 'number'
        ? spec.maxDurationSec >= input.durationSec
        : true,
    )
    .filter((spec) =>
      Array.isArray(spec.resolutions) && spec.resolutions.length > 0
        ? (spec.resolutions as readonly string[]).includes(input.resolution)
        : true,
    );
  if (allByMode.length === 0) {
    throw new Error(
      `no provider supports mode='${input.mode}' with durationSec=${input.durationSec} resolution=${input.resolution} in current registry`,
    );
  }

  const preferred = input.preferProvider
    ? allByMode.filter((c) => c.provider === input.preferProvider)
    : allByMode;
  if (preferred.length === 0) {
    throw new Error(
      `preferProvider ${input.preferProvider} has no model supporting mode ${input.mode}`,
    );
  }

  // P15: attempt an explicit-tier override before falling back to cost sort.
  // pickExplicitTier hard-wires certain modes/resolutions to a specific Kling model
  // regardless of cost. Only applies when preferProvider is NOT set (caller override wins).
  const explicit = input.preferProvider ? undefined : pickExplicitTier(input, preferred);

  // T16 — zero-cost providers are OPT-IN ONLY, never picked by the cost sort.
  //
  // A locally-hosted provider (Wan2GP) and a subscription-included one (Codex
  // image_gen, T17) both price at 0 because no per-generation charge exists.
  // Under a pure ascending cost sort, 0 is unbeatable: such a provider would win
  // EVERY route the moment it is enabled, silently replacing Veo and Kling for
  // all work.
  //
  // That is wrong on quality and wrong on intent. Free does not mean equivalent —
  // a local Wan2GP render is not a substitute for Veo, and the user enabling a
  // local server to try it has not asked for their entire pipeline to move there.
  // Cost is a tiebreaker among comparable options, and a zero-cost provider is
  // not comparable; it is a different decision.
  //
  // So they are excluded from automatic selection and reachable only through an
  // explicit preferProvider. `preferred` above already narrows to that provider
  // when preferProvider is set, so filtering here removes them from the automatic
  // path without ever blocking a deliberate request.
  const costSortCandidates = input.preferProvider
    ? preferred
    : preferred.filter((spec) => !isOptInOnlyProvider(spec, input));

  // Sort remaining candidates by USD-equivalent cost ascending.
  // P15 (Option A): google-default tiebreaker removed — pure cost sort.
  const sorted = [...costSortCandidates].sort((a, b) => {
    const aUsd = normalizeCostUSDSafe(a, input);
    const bUsd = normalizeCostUSDSafe(b, input);
    return aUsd - bUsd;
  });

  if (explicit === undefined && sorted.length === 0) {
    // Every candidate was opt-in-only. Say so, rather than reporting the generic
    // "no provider supports this mode" — the user has a provider that CAN do it
    // and only needs to name it.
    const names = [...new Set(preferred.map((s) => s.provider))].join(', ');
    throw new Error(
      `the only provider(s) supporting mode='${input.mode}' at durationSec=${input.durationSec} ` +
        `resolution=${input.resolution} are opt-in only (${names}). They price at $0 and are ` +
        `excluded from automatic cost-based routing so they cannot silently displace paid ` +
        `providers. Pass preferProvider explicitly to use one.`,
    );
  }

  const picked = explicit ?? sorted[0]!;

  const estimatedCostUSD = normalizeCostUSDSafe(picked, input);
  // FIX (Codex P2 round 5, PR#10): when ALL viable candidates ended up
  // unpriced (Infinity), surface the misconfiguration instead of returning a
  // routing decision whose cost is NaN-equivalent. Triggers when all matches
  // are credit-priced AND MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is unset.
  if (!Number.isFinite(estimatedCostUSD)) {
    throw new Error(
      `no priceable provider for mode='${input.mode}' durationSec=${input.durationSec} resolution=${input.resolution}. ` +
        `All candidates are credit-priced and MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is unset/invalid. ` +
        `Set the env var to a positive number (USD per Higgsfield credit) before routing.`,
    );
  }
  const rationale = buildRationale(picked, input, sorted.length, explicit !== undefined);

  return {
    provider: picked.provider,
    modelId: picked.id,
    mode: input.mode,
    estimatedCostUSD,
    rationale,
  };
}

function normalizeCostUSDSafe(spec: VideoModelSpec, input: VideoRouteInputT): number {
  try {
    const usdPerCredit = parseFloat(
      process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] ?? 'NaN',
    );
    const result = normalizeCostUSD(spec, {
      durationSec: input.durationSec,
      usdPerCredit,
      // FIX (Codex P2 round 16, PR#12): forward resolution so per-second specs
      // with resolutionMultipliers (Seedance) price 1080p/480p correctly during
      // cross-provider ranking instead of always at 720p baseline.
      resolution: input.resolution,
    });
    // Guard against NaN / ±Infinity from malformed env values (e.g. usdPerCredit=NaN
    // multiplied by rate produces NaN, which breaks sort comparisons).
    return Number.isFinite(result) ? result : Number.POSITIVE_INFINITY;
  } catch {
    // If a credits-per-video spec is missing a valid usdPerCredit, treat it as
    // infinite cost so it never wins ranking against a priced provider. The
    // director surfaces the configuration error to the user separately.
    return Number.POSITIVE_INFINITY;
  }
}

// P15: explicit tier overrides — hard-wire specific modes/resolutions to a Kling model
// before the cost-based sort. Only checked when preferProvider is not set.
function pickExplicitTier(
  input: VideoRouteInputT,
  candidates: ReadonlyArray<VideoModelSpec>,
): VideoModelSpec | undefined {
  // 4K resolution → kling-v3-master (only registered 4K-native provider)
  if (input.resolution === '4k') {
    return candidates.find((c) => c.id === 'kling-v3-master');
  }
  // Multi-shot routing (Codex P2 round 12, PR#12): P15 hard-wired this to
  // kling-v3-omni because Veo + Higgsfield did not support it. P16 added
  // Seedance which advertises 'multi-shot' too. Kling-omni only retains
  // the explicit-tier crown when the request exceeds Seedance's caps
  // (>15s total OR >4 shots — see SeedanceMultishotInput refines).
  // Otherwise fall through to the cost sort so the cheaper provider wins.
  if (input.mode === 'multi-shot') {
    const beyondSeedance = input.durationSec > 15;
    if (beyondSeedance) {
      return candidates.find((c) => c.id === 'kling-v3-omni');
    }
    // For requests within Seedance's range, let the cost sort decide
    // between kling-v3-omni and seedance-2.0-standard/fast.
    return undefined;
  }
  // Motion-brush, elements, and lip-sync are Kling V3 Pro-only modes in the current registry
  if (input.mode === 'motion-brush' || input.mode === 'elements' || input.mode === 'lip-sync') {
    return candidates.find((c) => c.id === 'kling-v3-pro');
  }
  return undefined;
}

function buildRationale(
  picked: VideoModelSpec,
  input: VideoRouteInputT,
  candidateCount: number,
  isExplicitTier: boolean,
): string {
  if (isExplicitTier) {
    return `P15 explicit tier: mode=${input.mode}/resolution=${input.resolution} routes to ${picked.id}.`;
  }
  if (input.mode === 'targeted-edit') {
    // FIX (CodeRabbit round 12, PR#12): stale exclusivity claim. P16 added
    // Seedance Standard/Fast which also support targeted-edit (via i2v.endImageUrl).
    // Reflect provider in the rationale instead of asserting Recast exclusivity.
    if (picked.provider === 'higgsfield') {
      return `higgsfield Recast handles targeted-edit (P14) → ${picked.id}.`;
    }
    if (picked.provider === 'bytedance') {
      return `Seedance absorbs targeted-edit via i2v.endImageUrl (P16) → ${picked.id}.`;
    }
    return `targeted-edit routed to ${picked.id}.`;
  }
  if (input.preferProvider) {
    return `preferProvider=${input.preferProvider} → ${picked.id}.`;
  }
  if (candidateCount === 1) {
    return `${picked.id} is the only candidate for mode ${input.mode}.`;
  }
  return (
    `Cheapest USD-equivalent candidate for mode ${input.mode}: ${picked.id} at ` +
    `$${normalizeCostUSDSafe(picked, input).toFixed(4)}/s. ` +
    `Use preferProvider to override.`
  );
}
