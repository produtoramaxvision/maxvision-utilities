import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutputStorageClient } from '../../output/storage.js';
import { presignExistingArtifact } from '../../output/output-storage.js';
import { KlingProvider } from '../../video/providers/kling.js';
import type { VideoLedgerHooks } from '../../video/providers/base.js';
import { KlingMotionBrushInput, type KlingMotionBrushInputT } from '../schemas.js';
import {
  KlingElementCreateInput,
  type KlingElementCreateInputT,
  KlingElementListInput,
  type KlingElementListInputT,
  KlingElementDeleteInput,
  type KlingElementDeleteInputT,
  KlingElementsInput,
  type KlingElementsInputT,
  KlingLipSyncInput,
  type KlingLipSyncInputT,
  KlingOmniMultiShotInput,
  type KlingOmniMultiShotInputT,
  KlingVideoExtendInput,
  type KlingVideoExtendInputT,
  KlingPollInput,
  type KlingPollInputT,
  KlingDownloadInput,
  type KlingDownloadInputT,
} from '../schemas.js';
import {
  createKlingElement,
  listKlingElementsFromBackend,
  deleteKlingElement,
} from '../../video/providers/kling-elements.js';
import { openDb, runMigrations } from '../../core/db.js';
import { recordActualCost } from '../../core/cost-tracker.js';
import { videoActualCredits } from '../../billing/pricing.js';
import { defaultDbPath } from './shared.js';
import { assertPromptWithinBudget, assertMultiShotWithinBudget } from '../../core/prompt-budget.js';

// ---------------------------------------------------------------------------
// handleKlingMotionBrush — Kling V3 Pro motion brush: paint regions with motion vectors (P15 Task 6)
// Per-call KlingProvider construction is intentional: KlingProvider takes env in constructor
// and per-call construction ensures tests using tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export interface KlingHandlerExecOpts {
  readonly fetchImpl?: typeof fetch;
  /** F-B: when present, handleKlingPoll presigns the MinIO artifact uploaded by the webhook handler. */
  readonly storage?: OutputStorageClient;
  /**
   * Cost-guard hook (media-forge cost guards). Called SYNCHRONOUSLY with the
   * pure cost estimate, BEFORE provider.generate() ever submits to the Kling
   * API. Throws CostGuardError to block the call; returns `{ costWarning }`
   * to surface a non-blocking warning in the tool response; returns
   * undefined to allow silently. Optional — submit handlers called directly
   * (e.g. in tests) without this hook behave exactly as before.
   */
  readonly checkCostGuard?: (estimateUsd: number) => { costWarning?: string } | undefined;
  /**
   * Credit preflight hook (media-forge cost guards, F-E). Called BEFORE
   * provider.generate() — a cheap balance read that fails fast without
   * building the request body. Throws InsufficientCreditError on
   * insufficient balance; no-op when omitted. Distinct from `ledgerHooks`
   * below: this only READS the balance; `ledgerHooks.beforeSubmit` is the
   * REAL reserve, keyed on the jobId KlingProvider.generate() mints, and
   * also throws InsufficientCreditError on a race that slips past this
   * pre-check (a concurrent submit from the same tenant landing in between).
   */
  readonly preflightCredit?: (estimateUsd: number) => Promise<void>;
  /**
   * A5 (2026-07-30): reserve-BEFORE-submit ledger hooks, forwarded verbatim
   * to `KlingProvider.generate()` as its second argument — see
   * `VideoLedgerHooks` in base.ts for the contract. Optional so every
   * existing direct-provider test / direct handler call keeps working
   * unchanged when omitted, same as `checkCostGuard`/`preflightCredit` above.
   */
  readonly ledgerHooks?: VideoLedgerHooks;
}

/**
 * Shared cost-guard + credit-preflight gate run by every Kling submit handler
 * below, BEFORE provider.generate() ever reaches the network. Both hooks are
 * optional (submit handlers called directly without opts, e.g. in tests,
 * behave exactly as before this change). checkCostGuard throws
 * CostGuardError synchronously to block; preflightCredit throws
 * InsufficientCreditError to block. Returns the costWarning (if any) so the
 * caller can attach it to the handler's return value.
 */
async function runCostGuards(
  estimateUsd: number,
  opts: KlingHandlerExecOpts,
): Promise<string | undefined> {
  const costWarning = opts.checkCostGuard?.(estimateUsd)?.costWarning;
  if (opts.preflightCredit) {
    await opts.preflightCredit(estimateUsd);
  }
  return costWarning;
}

export async function handleKlingMotionBrush(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number; costWarning?: string }> {
  const input: KlingMotionBrushInputT = KlingMotionBrushInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'kling', prompt: input.prompt, field: 'prompt' });
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: input.modelId,
    mode: 'motion-brush' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: '1080p' as const,
    firstFrameImagePath: input.imageUrl,
    extras: {
      providerKind: 'kling' as const,
      motionBrushRegions: input.regions,
      watermarkEnabled: input.watermarkEnabled,
      characterOrientation: input.characterOrientation,
      motionReferenceVideoUrl: input.videoReferenceUrl,
      klingMode: 'pro' as const,
    },
  };
  // Cost-guard + credit-preflight run BEFORE generate() submits to the Kling
  // API — estimateCostUSD is pure (no I/O), so this is genuinely pre-submit.
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleKlingElementCreate — create element from image URL or base64 (P15 Task 6.5)
// Per-call construction (no singleton) — KlingProvider / kling-elements use env in call.
// ---------------------------------------------------------------------------

export async function handleKlingElementCreate(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ elementId: string; displayName: string; category?: string; createdAt: string }> {
  const input: KlingElementCreateInputT = KlingElementCreateInput.parse(rawInput);
  const meta = await createKlingElement({
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
    imageUrl: input.imageUrl,
    imageBase64: input.imageBase64,
    displayName: input.displayName,
    category: input.category,
  });
  const db = openDb(defaultDbPath());
  runMigrations(db);
  db.prepare(
    `INSERT OR REPLACE INTO kling_elements (element_id, display_name, category, source_url, created_at, last_used_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(meta.elementId, meta.displayName, meta.category ?? null, input.imageUrl ?? null);
  return meta;
}

// ---------------------------------------------------------------------------
// handleKlingElementList — list elements from local cache (+ optional backend sync) (P15 Task 6.6)
// ---------------------------------------------------------------------------

export async function handleKlingElementList(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{
  source: 'cache' | 'cache+backend';
  elements: Array<{ elementId: string; displayName: string; category?: string; createdAt: string; lastUsedAt?: string }>;
}> {
  const input: KlingElementListInputT = KlingElementListInput.parse(rawInput);
  const db = openDb(defaultDbPath());
  runMigrations(db);

  let where = input.includeDeleted ? '1=1' : 'deleted_at IS NULL';
  const params: string[] = [];
  if (input.category) {
    where += ' AND category = ?';
    params.push(input.category);
  }
  const localRows = db.prepare(`SELECT element_id, display_name, category, created_at, last_used_at FROM kling_elements WHERE ${where}`).all(...params) as Array<{
    element_id: string;
    display_name: string;
    category?: string;
    created_at: string;
    last_used_at?: string;
  }>;
  type ElementRow = { elementId: string; displayName: string; category: string | undefined; createdAt: string; lastUsedAt: string | undefined };
  let elements: ElementRow[] = localRows.map((r) => ({
    elementId: r.element_id,
    displayName: r.display_name,
    category: r.category,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));

  if (input.syncWithBackend) {
    const remote = await listKlingElementsFromBackend({ env: process.env as never, fetchImpl: opts.fetchImpl });
    const localById = new Map(elements.map((e) => [e.elementId, e]));
    // Upsert ALL remote rows so the local cache stays complete regardless of
    // caller's category filter — cache freshness is independent of the query.
    const upsert = db.prepare(
      `INSERT OR REPLACE INTO kling_elements (element_id, display_name, category, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const e of remote) {
      upsert.run(e.elementId, e.displayName, e.category ?? null, e.createdAt, localById.get(e.elementId)?.lastUsedAt ?? null);
    }
    // FIX (Codex P2 round 12, PR#11): preserve `input.category` filter when
    // returning the synced list. Round 9 added the local SQL WHERE clause for
    // category, but the sync branch overwrote `elements` with the unfiltered
    // remote map — so `{ category: 'character', syncWithBackend: true }`
    // returned products/locations too. Filter the returned list only; the
    // upsert above keeps the cache fresh either way.
    const remoteMapped = remote.map((r) => ({
      ...r,
      category: r.category,
      lastUsedAt: localById.get(r.elementId)?.lastUsedAt,
    }));
    elements = input.category
      ? remoteMapped.filter((e) => e.category === input.category)
      : remoteMapped;
    return { source: 'cache+backend', elements };
  }
  return { source: 'cache', elements };
}

// ---------------------------------------------------------------------------
// handleKlingElementDelete — soft-delete locally + (default) hard-delete on backend (P15 Task 6.7)
//
// Two separate fields decide two separate things, and the difference matters
// because only one of them is reversible:
//
//   confirm          z.literal(true) in KlingElementDeleteInput. Enforced by the
//                    schema at parse time, which is why nothing in this body
//                    checks it — a request without it never reaches here.
//   alsoDeleteRemote defaults to TRUE. This is the branch below, and it is the
//                    irreversible half: the local row is only soft-deleted
//                    (deleted_at), while the backend delete cannot be undone.
//
// A caller who wants the local-only, recoverable delete has to pass
// alsoDeleteRemote:false explicitly. Confirming is not the same as opting into
// the remote delete, and the default is the destructive one.
// ---------------------------------------------------------------------------

export async function handleKlingElementDelete(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ elementId: string; localDeleted: boolean; remoteDeleted: boolean }> {
  const input: KlingElementDeleteInputT = KlingElementDeleteInput.parse(rawInput);
  let remoteDeleted = false;
  if (input.alsoDeleteRemote) {
    await deleteKlingElement({ env: process.env as never, fetchImpl: opts.fetchImpl, elementId: input.elementId });
    remoteDeleted = true;
  }
  const db = openDb(defaultDbPath());
  runMigrations(db);
  const result = db.prepare(`UPDATE kling_elements SET deleted_at = datetime('now') WHERE element_id = ?`).run(input.elementId);
  return { elementId: input.elementId, localDeleted: result.changes > 0, remoteDeleted };
}

// ---------------------------------------------------------------------------
// handleKlingElements — compose up to 4 frame-locked element identities into one shot (P15 Task 7)
// Per-call KlingProvider construction is intentional: KlingProvider takes env in constructor
// and per-call construction ensures tests using tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export async function handleKlingElements(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number; costWarning?: string }> {
  const input: KlingElementsInputT = KlingElementsInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'kling', prompt: input.prompt, field: 'prompt' });
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: input.modelId,
    mode: 'elements' as const,
    prompt: input.prompt,
    durationSec: input.durationSec,
    resolution: '1080p' as const,
    aspectRatio: input.aspectRatio,
    firstFrameImagePath: input.imageUrl,
    extras: {
      providerKind: 'kling' as const,
      elementIds: input.elementIds,
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro' as const,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleKlingLipSync — Kling V3 Pro lip-sync: text or audio driven (P15 Task 8)
// Per-call KlingProvider construction ensures tests with tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export async function handleKlingLipSync(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number; costWarning?: string }> {
  const input: KlingLipSyncInputT = KlingLipSyncInput.parse(rawInput);
  if (input.text) {
    assertPromptWithinBudget({ provider: 'kling', prompt: input.text, field: 'text' });
  }
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: input.modelId,
    mode: 'lip-sync' as const,
    prompt: input.text ?? '(audio-driven lip-sync)',
    durationSec: 5,
    resolution: '1080p' as const,
    extras: {
      providerKind: 'kling' as const,
      lipSync: {
        mode: (input.text ? 'text' : 'audio') as 'text' | 'audio',
        text: input.text,
        audioUrl: input.audioUrl,
        emotion: input.emotion,
      },
      motionReferenceVideoUrl: input.videoUrl,
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro' as const,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// handleKlingOmniMultiShot — Kling V3 Omni multi-shot orchestration (P15 Task 9)
// Single API call generates up to 6 contiguous cuts with per-shot prompt + duration.
// Per-call KlingProvider construction ensures tests with tmp envs get isolated instances.
// ---------------------------------------------------------------------------

export async function handleKlingOmniMultiShot(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{ jobId: string; provider: string; modelId: string; estimatedCostUSD: number; costWarning?: string }> {
  const input: KlingOmniMultiShotInputT = KlingOmniMultiShotInput.parse(rawInput);
  assertMultiShotWithinBudget({ provider: 'kling', prompts: input.shots.map((s) => s.prompt) });
  const totalDuration = input.shots.reduce((sum, s) => sum + s.duration, 0);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  const req = {
    modelId: 'kling-v3-omni' as const,
    mode: 'multi-shot' as const,
    prompt: input.shots.map((s) => s.prompt).join(' | '),
    durationSec: totalDuration,
    resolution: '1080p' as const,
    aspectRatio: input.aspectRatio,
    extras: {
      providerKind: 'kling' as const,
      omniMultiShot: {
        multiPrompt: input.shots,
        imageList: input.imageRefs,
        videoList: input.videoRefs,
      },
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro' as const,
    },
  };
  const estimateUsd = provider.estimateCostUSD(req);
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate(req, opts.ledgerHooks);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: estimateUsd,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleKlingVideoExtend — Kling V3 Pro video extension: add ~4.5s per hop (P15 Task 10)
// Per-call KlingProvider construction ensures tests with tmp envs get isolated instances.
// ---------------------------------------------------------------------------

/** Duration added per single extend hop, in seconds. */
const KLING_EXTEND_HOP_SEC = 4.5;

export async function handleKlingVideoExtend(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{
  jobId: string;
  provider: string;
  modelId: string;
  estimatedCostUSD: number;
  hopsRemaining: number;
  costWarning?: string;
}> {
  const input: KlingVideoExtendInputT = KlingVideoExtendInput.parse(rawInput);
  assertPromptWithinBudget({ provider: 'kling', prompt: input.prompt, field: 'prompt' });
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  // FIX (Codex P2 round 13, PR#11): this handler submits a SINGLE hop per
  // call (durationSec: KLING_EXTEND_HOP_SEC above) and asks the caller to
  // re-invoke for the rest via `hopsRemaining`. The estimate must match
  // what actually goes through recordJob — multiplying by input.hops over-
  // reports the cost on call 1 and under-reports on later calls, breaking
  // any client that sums estimates across the chain.
  const estimateUsd = provider.estimateCostUSD({
    modelId: input.modelId,
    mode: 'extend',
    prompt: input.prompt,
    durationSec: KLING_EXTEND_HOP_SEC,
    resolution: '1080p',
  });
  // Cost-guard + credit-preflight run BEFORE generate() — same estimate value
  // used above, computed pre-submit.
  const costWarning = await runCostGuards(estimateUsd, opts);
  const handle = await provider.generate({
    modelId: input.modelId,
    mode: 'extend',
    prompt: input.prompt,
    durationSec: KLING_EXTEND_HOP_SEC,
    resolution: '1080p',
    extras: {
      providerKind: 'kling',
      motionReferenceVideoUrl: input.videoUrl,
      watermarkEnabled: input.watermarkEnabled,
      klingMode: 'pro',
    },
  }, opts.ledgerHooks);
  return {
    jobId: handle.jobId,
    provider: handle.provider,
    modelId: handle.model,
    estimatedCostUSD: estimateUsd,
    hopsRemaining: input.hops - 1,
    ...(costWarning ? { costWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// handleKlingPoll / handleKlingDownload — manual completion path
// FIX (Codex P1 round 6, PR#11): default MCP Kling tools suppress callback_url
// (HMAC mismatch) and the throwaway provider's per-process jobTypeMap dies
// the moment the handler returns. These tools rehydrate the provider state
// from the cost-tracker DB so an operator can drive a submitted job to
// completion without depending on a registered webhook.
// ---------------------------------------------------------------------------

interface KlingPollResult {
  jobId: string;
  state: string;
  assetUrls?: readonly string[];
  url?: string;
  expires_at?: string;
  errorMessage?: string;
  progress?: number;
}

export async function handleKlingPoll(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<KlingPollResult> {
  const input: KlingPollInputT = KlingPollInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  provider.hydrateFromDb(input.jobId);
  const status = await provider.pollStatus(input.jobId);
  // FIX (Codex P2 round 13, PR#11): when callbacks are suppressed (the default
  // for the MCP Kling tools — HMAC mismatch blocks the webhook path) and the
  // task polls as `failed`, the row stays `pending` forever because no other
  // path persists the terminal state. Mirror kling-webhook-handler.ts:
  // UPDATE video_jobs SET status='failed' WHERE status != 'completed'.
  if (status.state === 'failed') {
    const db = openDb(defaultDbPath());
    runMigrations(db);
    db.prepare(
      "UPDATE video_jobs SET status = 'failed', actual_usd = COALESCE(actual_usd, 0), completed_at = ? WHERE id = ? AND status != 'completed'",
    ).run(new Date().toISOString(), input.jobId);
  }

  // F-B: quando completed e storage configurado, presign do artefato já no MinIO
  // (uploaded pelo webhook handler). Se o objeto não existir (webhook não chegou /
  // callback suprimido no path manual), cair no fallback assetUrls do provider.
  let signedUrl: string | undefined;
  let expiresAt: string | undefined;
  if (status.state === 'completed' && opts.storage) {
    const artifact = await presignExistingArtifact({
      storage: opts.storage,
      jobId: input.jobId,
      contentType: 'video/mp4',
    }).catch(() => null);
    if (artifact) {
      signedUrl = artifact.url;
      expiresAt = artifact.expiresAt;
    }
  }

  return {
    jobId: status.jobId,
    state: status.state,
    ...(status.assetUrls ? { assetUrls: status.assetUrls } : {}),
    ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
    ...(typeof status.progress === 'number' ? { progress: status.progress } : {}),
    ...(signedUrl !== undefined ? { url: signedUrl, expires_at: expiresAt } : {}),
  };
}

export async function handleKlingDownload(
  rawInput: unknown,
  opts: KlingHandlerExecOpts = {},
): Promise<{
  jobIdOrUrl: string;
  outputPath: string;
  sizeBytes: number;
  contentType: string;
  actualUsd?: number;
}> {
  const input: KlingDownloadInputT = KlingDownloadInput.parse(rawInput);
  const provider = new KlingProvider({
    dbPath: defaultDbPath(),
    env: process.env as never,
    fetchImpl: opts.fetchImpl,
  });
  // Hydrate only when caller passed a jobId (not a raw URL).
  const looksLikeUrl =
    input.jobIdOrUrl.startsWith('http://') || input.jobIdOrUrl.startsWith('https://');
  if (!looksLikeUrl) provider.hydrateFromDb(input.jobIdOrUrl);
  const asset = await provider.download(input.jobIdOrUrl);

  const projectDir =
    process.env['MEDIA_FORGE_PROJECT_DIR'] ?? join(process.cwd(), '.media-forge');
  const outputsDir = process.env['MEDIA_FORGE_OUTPUTS_DIR'] ?? join(projectDir, 'outputs');
  mkdirSync(outputsDir, { recursive: true });
  const baseName = looksLikeUrl
    ? `kling-download-${Date.now()}.mp4`
    : `${input.jobIdOrUrl}.mp4`;
  const outputPath = join(outputsDir, baseName);
  writeFileSync(outputPath, asset.buffer);

  // FIX (Codex P1 round 7, PR#11): manual completion path must flip the
  // video_jobs row to terminal. Without this, jobs downloaded via
  // media_kling_download stayed 'pending' forever (symmetric to the round 6
  // webhook-handler bug). Use est_usd as the actualUsd fallback when no
  // explicit duration is available locally.
  //
  // FIX (Codex local round 8, PR#11): emit stderr warnings whenever the
  // cost ledger is touched without authoritative pricing data. Operators
  // pulling the cost-report later need a way to spot rows that were closed
  // with a fallback or skipped entirely; silent 0/skip masked dropped data.
  let actualUsd: number | undefined;
  if (looksLikeUrl) {
    process.stderr.write(
      `[kling-download] raw URL path — no jobId to reconcile; cost-tracker NOT updated for ${input.jobIdOrUrl}\n`,
    );
  } else {
    const db = openDb(defaultDbPath());
    runMigrations(db);
    const row = db
      .prepare('SELECT est_usd FROM video_jobs WHERE id = ?')
      .get(input.jobIdOrUrl) as { est_usd?: number } | undefined;
    if (typeof row?.est_usd === 'number' && Number.isFinite(row.est_usd)) {
      actualUsd = row.est_usd;
    } else {
      actualUsd = 0;
      process.stderr.write(
        `[kling-download] job ${input.jobIdOrUrl} has no est_usd in video_jobs — ` +
          `recording actualUsd=0 to flip terminal status. Cost ledger may underreport.\n`,
      );
    }
    const actualCreditsForRecord =
      typeof actualUsd === 'number' ? videoActualCredits(actualUsd) : undefined;
    recordActualCost({ dbPath: defaultDbPath(), jobId: input.jobIdOrUrl, actualUsd, actualCredits: actualCreditsForRecord });
  }

  return {
    jobIdOrUrl: input.jobIdOrUrl,
    outputPath,
    sizeBytes: asset.metadata.sizeBytes ?? asset.buffer.length,
    contentType: asset.metadata.contentType,
    ...(typeof actualUsd === 'number' ? { actualUsd } : {}),
  };
}
