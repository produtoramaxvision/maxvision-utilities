// src/core/prompt-budget.ts
// Per-provider prompt contract. Every number here is copied from that provider's
// own documentation with the date it was read; nothing is inferred from a sibling
// provider. Where a provider publishes no bound, `promptMaxChars` is `null` and
// the caller must NOT invent one — an unverified limit rejects work the provider
// would have accepted.
//
// Source of truth shared with skills/_shared/references/surface-prompt-profiles.md.
// The two must agree; tests/unit/core/prompt-budget.test.ts is the gate.
//
// Why this module exists: six places across the skill pack instruct the model to
// keep a prompt "under the verified active-provider prompt budget", and before
// this file no such budget existed anywhere in the repo. Every prompt field in
// src/mcp/schemas.ts was `z.string().min(1)` with no upper bound, so an
// over-length prompt travelled to the provider and failed there — after the cost
// guard ran and after the job row was written.
import type { Provider } from './models.js';
import { ValidationError } from './errors.js';

export interface SurfacePromptProfile {
  /** Max characters the provider accepts in the main prompt. `null` = not published. */
  readonly promptMaxChars: number | null;
  /** Max characters in the negative prompt, when the provider has one. */
  readonly negativePromptMaxChars: number | null;
  /** Per-shot limit when the provider takes a multi-shot array. `null` = no such surface. */
  readonly multiShotPromptMaxChars: number | null;
  /** Max shots in that array. `null` = no such surface. */
  readonly multiShotMaxShots: number | null;
  /** Documentation this row was read from. */
  readonly source: string;
  /** ISO date the row was verified. Re-verify rather than trusting an old row. */
  readonly verifiedAt: string;
}

/**
 * Kling publishes hard character limits; they are the only provider of the four
 * that does. Read 2026-07-30 from kling.ai/document-api pages api/video/2-6,
 * api/video/3-0-omni and api/video/o1.
 */
const KLING: SurfacePromptProfile = {
  promptMaxChars: 2500,
  negativePromptMaxChars: 2500,
  multiShotPromptMaxChars: 512,
  multiShotMaxShots: 6,
  source: 'kling.ai/document-api (api/video/2-6, 3-0-omni, o1)',
  verifiedAt: '2026-07-30',
};

/**
 * docs.higgsfield.ai documents prompt *shape* (motion first, then pace, then
 * explicit camera, then atmosphere) but no character bound. Leaving this null is
 * deliberate: guessing a limit here would reject prompts the platform accepts.
 */
const HIGGSFIELD: SurfacePromptProfile = {
  promptMaxChars: null,
  negativePromptMaxChars: null,
  multiShotPromptMaxChars: null,
  multiShotMaxShots: null,
  source: 'docs.higgsfield.ai (guides/video, guides/images) — no published bound',
  verifiedAt: '2026-07-30',
};

/**
 * @google/genai types `prompt` as a bare string in GenerateVideosParameters with
 * no stated bound, so there is nothing to enforce locally.
 */
const GOOGLE: SurfacePromptProfile = {
  promptMaxChars: null,
  negativePromptMaxChars: null,
  multiShotPromptMaxChars: null,
  multiShotMaxShots: null,
  source: '@google/genai GenerateVideosConfig reference — no published bound',
  verifiedAt: '2026-07-30',
};

/**
 * Not verified. fal.ai (default route) and BytePlus ModelArk (ARK-direct route)
 * have their own docs which have not been read for this field. Do NOT copy
 * Kling's 2500 here; they are unrelated platforms that media-forge happens to
 * route side by side.
 */
const BYTEDANCE: SurfacePromptProfile = {
  promptMaxChars: null,
  negativePromptMaxChars: null,
  multiShotPromptMaxChars: null,
  multiShotMaxShots: null,
  source: 'NOT VERIFIED — read fal.ai / BytePlus ModelArk docs and date the row',
  verifiedAt: 'unverified',
};

/**
 * T5 — the CLI transport reaches the same Higgsfield platform as the API-key
 * adapter, so it inherits that platform's (absent) published bound. Aliased to
 * HIGGSFIELD rather than copied: two profiles for one platform would drift the
 * moment Higgsfield publishes a limit and only one row gets updated.
 *
 * Confirmed against `higgsfield 1.1.20` on 2026-07-30 — `generate create --help`
 * documents `--prompt` with no stated length bound.
 */
const HIGGSFIELD_CLI: SurfacePromptProfile = HIGGSFIELD;

/**
 * PR7 — MuAPI is an aggregator: the effective prompt bound is whatever the
 * underlying vendor enforces, and that differs per model in its catalogue.
 *
 * Left null rather than guessed. Copying Kling's 2500 here would be wrong for
 * every non-Kling model MuAPI resells, and a bound that is wrong in the
 * restrictive direction rejects prompts the provider would have accepted.
 */
const MUAPI: SurfacePromptProfile = {
  promptMaxChars: null,
  negativePromptMaxChars: null,
  multiShotPromptMaxChars: null,
  multiShotMaxShots: null,
  source: 'muapi.ai/docs — aggregator; the real bound is the resold vendor\'s, per model',
  verifiedAt: '2026-07-30',
};

export const SURFACE_PROMPT_PROFILES: Readonly<Record<Provider, SurfacePromptProfile>> = {
  kling: KLING,
  higgsfield: HIGGSFIELD,
  'higgsfield-cli': HIGGSFIELD_CLI,
  google: GOOGLE,
  bytedance: BYTEDANCE,
  muapi: MUAPI,
};

export function promptProfileFor(provider: Provider): SurfacePromptProfile {
  return SURFACE_PROMPT_PROFILES[provider];
}

/**
 * Google's own prompt-rewriting pass. Left OFF so the Director Formula ordering
 * that `mf-video-prompt` produces survives to the model: with rewriting on,
 * Google reorders and re-words the prompt, which silently undoes deliberate slot
 * ordering and any preservation constraint phrased as prose.
 *
 * Set explicitly rather than inherited, because the SDK reference does not
 * document the default — so "we didn't set it" was never a known state.
 * Override per call when a caller genuinely wants Google to expand a terse
 * prompt.
 */
export const VEO_ENHANCE_PROMPT_DEFAULT = false;

export interface AssertPromptWithinBudgetArgs {
  readonly provider: Provider;
  readonly prompt: string;
  /** Field name used in the error message so the caller knows what to shorten. */
  readonly field?: string;
  /** Check against the multi-shot per-shot limit instead of the main prompt. */
  readonly kind?: 'prompt' | 'negativePrompt' | 'multiShotPrompt';
}

/**
 * Fails fast, locally, before a submit spends a round trip — and before the cost
 * guard and the ledger row that a submit triggers. A provider with no published
 * bound is a no-op: silence here means "the provider did not publish a limit",
 * never "any length is fine".
 */
export function assertPromptWithinBudget(args: AssertPromptWithinBudgetArgs): void {
  const { provider, prompt } = args;
  const kind = args.kind ?? 'prompt';
  const field = args.field ?? kind;
  const profile = promptProfileFor(provider);

  const limit =
    kind === 'negativePrompt'
      ? profile.negativePromptMaxChars
      : kind === 'multiShotPrompt'
        ? profile.multiShotPromptMaxChars
        : profile.promptMaxChars;

  if (limit === null) return; // provider publishes no bound — nothing to enforce
  if (prompt.length <= limit) return;

  throw new ValidationError(
    `${field} is ${prompt.length} characters; ${provider} accepts at most ${limit}. ` +
      `Shorten it before submitting — the provider would reject this after the ` +
      `request is billed as an attempt. Source: ${profile.source} (verified ${profile.verifiedAt}).`,
  );
}

/**
 * Multi-shot arrays carry two limits at once: a per-shot character cap and a cap
 * on how many shots. Kling additionally requires the shot durations to sum to the
 * task total, which is a separate concern validated where duration is assembled.
 */
export function assertMultiShotWithinBudget(args: {
  readonly provider: Provider;
  readonly prompts: ReadonlyArray<string>;
}): void {
  const { provider, prompts } = args;
  const profile = promptProfileFor(provider);

  if (profile.multiShotMaxShots !== null && prompts.length > profile.multiShotMaxShots) {
    throw new ValidationError(
      `${prompts.length} shots requested; ${provider} accepts at most ` +
        `${profile.multiShotMaxShots}. Source: ${profile.source} ` +
        `(verified ${profile.verifiedAt}).`,
    );
  }

  prompts.forEach((p, i) => {
    assertPromptWithinBudget({
      provider,
      prompt: p,
      kind: 'multiShotPrompt',
      field: `shot ${i + 1} prompt`,
    });
  });
}
