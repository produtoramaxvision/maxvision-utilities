import { join } from 'node:path';
import type { Provider } from '../../core/models.js';
import { isSeedanceEnabled } from '../../core/feature-flags.js';
import { isHiggsfieldCliEnabled } from '../../video/providers/higgsfield-cli.js';
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
 * Normally a provider serves its own specs and this is an identity check. The
 * exception is 'higgsfield-cli', which is a second TRANSPORT to the same
 * Higgsfield platform rather than a different platform: it runs the same models,
 * and the only difference is that it authenticates as the logged-in user and
 * bills their workspace instead of API credits.
 *
 * Without this, enabling MEDIA_FORGE_HF_CLI_ENABLED did nothing observable —
 * 'higgsfield-cli' matched no spec.provider, so the router had zero candidates
 * for it even when named explicitly. A flag that silently changes nothing is
 * worse than an absent one.
 *
 * The two remain separate PROVIDERS entries on purpose: they bill differently,
 * and the cost report has to be able to tell them apart.
 */
export function providerServesSpec(adapter: Provider, specProvider: Provider): boolean {
  if (adapter === specProvider) return true;
  return adapter === 'higgsfield-cli' && specProvider === 'higgsfield';
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
