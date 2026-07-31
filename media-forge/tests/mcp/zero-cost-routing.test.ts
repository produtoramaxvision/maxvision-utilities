// tests/mcp/zero-cost-routing.test.ts
// T16 — the zero-cost routing mitigation (src/mcp/handlers/video.ts:
// isOptInOnlyProvider + the costSortCandidates filter inside handleVideoRoute).
//
// The problem this guards against: a provider that costs $0/generation
// (Wan2GP local inference, or any future subscription-included provider) is
// unbeatable in a pure ascending-cost sort. Without the mitigation, enabling
// such a provider would silently move EVERY automatic route onto it the
// instant it registers a model, regardless of whether it is actually a fit.
//
// SITUATION CHECK (per the task's item 13 branching): as of this writing,
// Wan2GP has NO entry in VIDEO_MODELS (see tests/video/providers/wan2gp.test.ts,
// "registry shape") and 'wan2gp' is not in getAdaptedProviders() (shared.ts only
// lists google/higgsfield/kling/[bytedance]). So there is currently no live $0
// candidate reachable through handleVideoRoute — SITUATION 2 of item 13 applies:
// the true end-to-end "$0 provider loses the automatic route, wins via
// preferProvider" scenario cannot be exercised against the live registry today.
// Per the task's explicit fallback for this case, this file:
//   (a) unit-tests isOptInOnlyProvider directly (the actual discriminating
//       logic — keys on price, not a provider allowlist), and
//   (b) proves every model CURRENTLY reachable through the router prices above
//       $0, so the exclusion is not vacuous: the moment any model with
//       pricing.rate === 0 is registered and its provider is added to
//       getAdaptedProviders(), this filter starts excluding it from
//       automatic selection without further code changes.
import { describe, it, expect } from 'vitest';

import { isOptInOnlyProvider } from '../../src/mcp/handlers/video.js';
import { VIDEO_MODELS } from '../../src/core/models.js';
import { getAdaptedProviders } from '../../src/mcp/handlers/shared.js';

// ---------------------------------------------------------------------------
// 12. isOptInOnlyProvider — the discriminating unit. Keyed on rate, not name.
// ---------------------------------------------------------------------------
describe('isOptInOnlyProvider', () => {
  it('rate 0 -> true (opt-in only, excluded from automatic cost sort)', () => {
    expect(isOptInOnlyProvider({ pricing: { rate: 0 } }, {})).toBe(true);
  });

  it.each([0.001, 0.126, 1, 100])('rate %s (positive) -> false', (rate) => {
    expect(isOptInOnlyProvider({ pricing: { rate } }, {})).toBe(false);
  });

  it('the check is purely about price — a $0 spec for ANY provider name is opt-in-only', () => {
    // Deliberately not "wan2gp" — proves the rule does not key on a provider
    // allowlist, which is exactly what would go stale the next time a
    // different free provider (e.g. a subscription-included Codex image_gen,
    // T17) is added.
    expect(isOptInOnlyProvider({ pricing: { rate: 0 } }, { any: 'shape' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. The routing mitigation, end to end (situation 2 — see file header).
// ---------------------------------------------------------------------------
describe('zero-cost exclusion is not vacuous today', () => {
  it('every model reachable through the live router registry prices above $0', () => {
    const adapted = getAdaptedProviders();
    const routableModels = Object.values(VIDEO_MODELS).filter((spec) => adapted.has(spec.provider));

    // Sanity: the registry actually has routable models to check (otherwise
    // this assertion would pass vacuously for the wrong reason — an empty
    // registry, not a correctly-priced one).
    expect(routableModels.length).toBeGreaterThan(0);

    for (const spec of routableModels) {
      expect(spec.pricing.rate).toBeGreaterThan(0);
      // Confirms the mitigation would actually engage: none of today's
      // routable models are (wrongly) treated as opt-in-only.
      expect(isOptInOnlyProvider(spec, {})).toBe(false);
    }
  });

  it('wan2gp itself has no VIDEO_MODELS entry, so it cannot reach handleVideoRoute at all today', () => {
    // This is the reason the true end-to-end scenario (automatic route skips
    // a live $0 model, preferProvider reaches it) is not exercised here: there
    // is no live $0 candidate to route to. The unit test above proves the
    // filter itself is correct and armed for the moment one is registered.
    const wan2gpEntries = Object.values(VIDEO_MODELS).filter((m) => m.provider === 'wan2gp');
    expect(wan2gpEntries).toHaveLength(0);
  });
});
