import { join } from 'node:path';
import type { Provider } from '../../core/models.js';
import { isSeedanceEnabled } from '../../core/feature-flags.js';
import {
  isHiggsfieldCliEnabled,
  HiggsfieldCliProvider,
  defaultRunner,
  type CliRunner,
} from '../../video/providers/higgsfield-cli.js';
import type { WebhookRouter } from '../../video/providers/webhook-router.js';
import { HiggsfieldProvider } from '../../video/providers/higgsfield.js';

// ---------------------------------------------------------------------------
// ADAPTED_PROVIDERS — routing gate: only providers with a wired adapter here.
// Prevents the router from selecting models that have no execution backend.
//
// P14: HiggsfieldProvider landed in Task 6 — 'higgsfield' enters ADAPTED_PROVIDERS.
// P15: KlingProvider landed in Task 4 — 'kling' enters ADAPTED_PROVIDERS.
// P16: BytedanceSeedanceProvider landed in Task 6 — 'bytedance' enters ADAPTED_PROVIDERS (Task 7).
//      Task 8.5: 'bytedance' is excluded when MEDIA_FORGE_SEEDANCE_ENABLED=false.
// ---------------------------------------------------------------------------
const ADAPTED_PROVIDERS_BASE = new Set<Provider>(['google', 'higgsfield', 'kling']);

/**
 * Returns the active set of adapted providers, excluding 'bytedance' when the
 * MEDIA_FORGE_SEEDANCE_ENABLED feature flag is false. Evaluated at call time
 * (not module load) so tests can toggle the env var per-test.
 */
export function getAdaptedProviders(): ReadonlySet<Provider> {
  const active = new Set<Provider>(ADAPTED_PROVIDERS_BASE);
  // Build on-demand — avoids mutating the base set.
  if (isSeedanceEnabled()) active.add('bytedance');
  if (isHiggsfieldCliEnabled()) active.add('higgsfield-cli');
  return active;
}

/**
 * Which registry entries a given adapter can actually execute.
 *
 * A plain identity check, and the 'higgsfield-cli' -> 'higgsfield' mapping that
 * used to live here was REMOVED on 2026-07-31. It was wrong, and the way it was
 * wrong is worth keeping written down.
 *
 * The reasoning was that the CLI is a second TRANSPORT to the same platform, so
 * it should be able to run the same specs. Enabling MEDIA_FORGE_HF_CLI_ENABLED
 * had done nothing observable without it, and a flag that changes nothing is
 * worse than an absent one. That premise was never checked against the CLI.
 *
 * Checked on 2026-07-31, and the two catalogues do not intersect at all:
 *
 *   registry `higgsfield` specs   higgsfield-soul2, -dop, -dop-turbo, -speak …
 *                                 Higgsfield's OWN products, modes t2v/i2v
 *                                 (-recast, -cinema-studio-3.5 and
 *                                 -marketing-studio were in this list until
 *                                 2026-08-01; the first has no surface at all
 *                                 and the other two moved to the CLI transport)
 *   `higgsfield model list --video`  veo3_1, kling3_0, seedance_2_0, wan2_7 …
 *                                 third-party models it RESELLS, plus utilities
 *   `higgsfield model list --image`  text2image_soul_v2, soul_cast,
 *                                 soul_cinematic … Soul exists, as IMAGE types
 *
 * Not one registry id is a CLI job_type. Live proof: routing
 * `higgsfield-soul2` through the adapter returns
 * `exit 4: No model with job_type "higgsfield-soul2"`. So the mapping did not
 * make the flag work — it made it fail one layer later, at the provider, after
 * the cost guard had run.
 *
 * The flag is inert again, and that is now the honest state: naming
 * `higgsfield-cli` in preferProvider fails at the router with "no model
 * supporting mode", which is true, instead of failing at the CLI with a
 * confusing job_type error.
 *
 * A mapping table is NOT the fix. There is nothing to map — `higgsfield-soul2`
 * is a video spec and `text2image_soul_v2` is an image job type; they are not
 * the same model wearing two names. What the CLI transport could legitimately
 * serve is the resold catalogue (kling3_0_turbo, seedance_2_0 …), and those are
 * registered under `kling`/`bytedance`, not `higgsfield`. Reaching them needs
 * the async catalogue-aware router recorded in TODOS.md.
 *
 * Soul-ID is unaffected and still works: `higgsfield soul-id create|list` takes
 * no job_type, and `soul-id list --json` was exercised live on 2026-07-31.
 */
export function providerServesSpec(adapter: Provider, specProvider: Provider): boolean {
  return adapter === specProvider;
}

/** True when any active adapter can execute this spec. */
export function isSpecRoutable(specProvider: Provider): boolean {
  for (const adapter of getAdaptedProviders()) {
    if (providerServesSpec(adapter, specProvider)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Webhook router module-level handle (P13 scaffold for P14+ provider callbacks)
// ---------------------------------------------------------------------------
// Owned by the runtime entrypoint (`startStdioServer` in src/mcp/server.ts) —
// `buildServer()`-based tests do NOT start the router, so the handler reports
// `{ running: false, handlers: [] }` in that path. This keeps the test suite
// from binding TCP ports.
let _webhookRouter: WebhookRouter | undefined;

export function setWebhookRouter(r: WebhookRouter | undefined): void {
  _webhookRouter = r;
}

export interface VideoWebhookStatusResult {
  running: boolean;
  address?: { address: string; port: number };
  handlers: string[];
}

export async function handleVideoWebhookStatus(): Promise<VideoWebhookStatusResult> {
  if (!_webhookRouter) return { running: false, handlers: [] };
  return {
    running: true,
    address: _webhookRouter.address,
    handlers: Array.from(_webhookRouter.handlers.keys()),
  };
}

// ---------------------------------------------------------------------------
// defaultDbPath — resolves the SQLite cost DB path from env or cwd default
// ---------------------------------------------------------------------------

export function defaultDbPath(): string {
  const projectDir =
    process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
  return join(projectDir, 'cost.db');
}

// ---------------------------------------------------------------------------
// D-7: lazy singleton — HiggsfieldProvider is constructed on first use and
// cached for the lifetime of the MCP server process. Avoids per-call
// construction overhead AND ensures all handlers share the in-memory
// `provider-request-map` cache + the same HiggsfieldProvider instance.
// ---------------------------------------------------------------------------
let _hfProvider: HiggsfieldProvider | undefined;

export function higgsfieldProvider(): HiggsfieldProvider {
  if (_hfProvider) return _hfProvider;
  _hfProvider = new HiggsfieldProvider({
    dbPath: defaultDbPath(),
    publicWebhookBaseUrl: process.env['MEDIA_FORGE_WEBHOOK_PUBLIC_URL'],
  });
  return _hfProvider;
}

/** Test utility — resets the singleton so each test gets a fresh provider bound to the
 *  current dbPath / env. Tests with their own tmp dbPath MUST call this in beforeEach. */
export function _resetHiggsfieldProviderForTests(): void {
  _hfProvider = undefined;
}

// ---------------------------------------------------------------------------
// higgsfieldCliProvider — the CLI transport, which nothing in src/ constructed.
//
// `HiggsfieldCliProvider` is fully implemented (preflight, fetchCostCredits,
// generate, pollStatus, download, ledger hooks) and covered by a live gate, but
// a repo-wide search for `new HiggsfieldCliProvider` found only its own class
// declaration. Meanwhile MEDIA_FORGE_HF_CLI_ENABLED=true adds 'higgsfield-cli'
// to getAdaptedProviders() above, which makes kling3_0 / kling3_0_turbo /
// seedance_2_0 / seedance_2_0_mini pass isSpecRoutable — so the flag promised
// routes that nothing could execute.
//
// This closes the construction half. The submit TOOLS that call it land with the
// Marketing Studio / UGC work; until then the flag stays default-off and the
// only consumer is that work.
// ---------------------------------------------------------------------------
let _hfCliProvider: HiggsfieldCliProvider | undefined;

export function higgsfieldCliProvider(): HiggsfieldCliProvider {
  if (_hfCliProvider) return _hfCliProvider;
  // dbPath is what makes poll and download reachable: it is where the local
  // job id is paired with the one `higgsfield generate get` understands.
  _hfCliProvider = new HiggsfieldCliProvider({ dbPath: defaultDbPath() });
  return _hfCliProvider;
}

/** Test utility — mirrors _resetHiggsfieldProviderForTests for the CLI transport. */
export function _resetHiggsfieldCliProviderForTests(): void {
  _hfCliProvider = undefined;
}

/**
 * Test utility — installs a provider built with a fake CLI runner.
 *
 * The HTTP provider can be tested by stubbing global.fetch, but this transport
 * spawns a binary, so the seam has to be the runner and the runner is a
 * constructor argument. Without a setter a test can only reach the singleton by
 * mutating the instance it already returned, which is both fragile and a lie
 * about how the object is built.
 */
export function _setHiggsfieldCliProviderForTests(p: HiggsfieldCliProvider): void {
  _hfCliProvider = p;
}

/**
 * The CLI runner to hand the Soul-ID handlers, or undefined when the CLI is off.
 *
 * `handleSoulIdTrain` has always accepted an optional runner and thrown a clear
 * "enable MEDIA_FORGE_HF_CLI_ENABLED" message without one — but register.ts never
 * passed one, from any code path, so `media_higgsfield_soul_id_train` threw
 * UNCONDITIONALLY. The flag was not the gate; there was no gate, only a dead
 * tool. `handleSoulIdList` degraded to local-cache-only forever for the same
 * reason, which is worse than throwing: it answered, and the answer was
 * silently partial.
 *
 * Gated at call time so tests can toggle the env var per-test, matching
 * getAdaptedProviders above.
 */
export function higgsfieldCliRunnerIfEnabled(): CliRunner | undefined {
  return isHiggsfieldCliEnabled() ? defaultRunner : undefined;
}
