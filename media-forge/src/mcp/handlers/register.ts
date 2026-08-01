import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OutputStorageClient } from '../../output/storage.js';
import { safeJoin, jobId as generateJobId } from '../../utils/paths.js';
import { storeArtifact } from '../../output/output-storage.js';
import { ValidationError, CostGuardError, ApiError } from '../../core/errors.js';
import { createClient, type MediaForgeClient } from '../../core/client.js';
import {
  evaluateCostGuard,
  newWorkBudgetUsd,
  type SpendPurpose,
} from '../../core/cost-guard.js';
import { handleNarrativePlan, handleNarrativeAssemble } from './narrative.js';
import {
  handleNarrativeExecuteClip,
  handleNarrativeRecordRun,
  handleNarrativeRecordTake,
} from './narrative-execute.js';
import {
  handleCodexImage,
  handleSoulIdTrain,
  handleSoulIdList,
} from './optional-providers.js';
import type { EditImageInputT, ComposeSceneInputT } from '../../image/image-schemas.js';
import { MCP_TOOLS } from '../schemas.js';
import { isToolAllowed } from '../../http/tier-gates.js';
import { ListMyGenerationsInput } from '../schemas.js';

// Strict jobId pattern: starts with alnum, only alnum + `_.-`, max 128 chars.
// Mirrors the format emitted by OutputManager (YYYYMMDDTHHMMSSZ-<random6>-<slug>)
// and explicitly excludes `/`, `\`, `..`, and NUL so user input cannot escape
// the jobs/ root via media_get_job_metadata.
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
import {
  generateImageNanoBananaPro,
  generateImageImagen4Ultra,
  editImage,
  composeScene,
  describeImage,
  extractPalette,
} from '../../image/image-service.js';
import {
  generateVideoT2V,
  generateVideoI2V,
  generateVideoInterpolate,
  generateVideoWithRefs,
  extendVideo,
  pollVideoOperation,
  downloadVideo,
} from '../../video/video-service.js';
import { extractLastFrame } from '../../video/last-frame.js';
import type { GenerateVideoResult } from '../../video/video-service.js';
import type { VideoLedgerHooks } from '../../video/providers/base.js';
import type {
  GenerateVideoT2VInputT,
  GenerateVideoI2VInputT,
  GenerateVideoInterpolateInputT,
  GenerateVideoWithRefsInputT,
} from '../../video/video-schemas.js';
import { OcrValidator, checkBrand } from '../../review/review-service.js';
import { estimateImageCost, estimateVideoCost, estimateRefsCost, type RefsEstimate } from '../../core/cost.js';
import { createRefsService } from '../../refs/refs-service.js';
import type {
  RefsSearchInputT,
  RefsComposeMoodboardInputT,
  RefsPresignInputT,
  RefsIndexInputT,
} from '../schemas.js';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
  type VideoMode,
} from '../../core/models.js';
import { KlingDownloadInput } from '../schemas.js';
import {
  setJobTenant,
  dailySpendUsd,
  recordImageJob,
  recordImageActualCost,
  recordJob,
  recordActualCost,
  setJobNativeTaskId,
  findJobByNativeTaskId,
  getJobRecord,
} from '../../core/cost-tracker.js';
import { isSeedanceEnabled } from '../../core/feature-flags.js';
import { logger } from '../../core/logger.js';
import {
  defaultDbPath,
  handleVideoWebhookStatus,
  higgsfieldCliRunnerIfEnabled,
} from './shared.js';
import { handleVideoCostEstimate, handleVideoCostReport, handleVideoRoute } from './video.js';
import {
  handleHiggsfieldSoulId,
  handleHiggsfieldDop,
  handleHiggsfieldCinemaStudio,
  handleHiggsfieldSpeak,
  handleHiggsfieldMarketingStudio,
  handleHiggsfieldRecast,
  handleHiggsfieldViralityPredictor,
  handleHiggsfieldGenerate,
  handleHiggsfieldPoll,
  handleHiggsfieldDownload,
} from './higgsfield.js';
import {
  handleKlingMotionBrush,
  handleKlingElementCreate,
  handleKlingElementList,
  handleKlingElementDelete,
  handleKlingElements,
  handleKlingLipSync,
  handleKlingOmniMultiShot,
  handleKlingVideoExtend,
  handleKlingPoll,
  handleKlingDownload,
  handleKlingBillingReconcile,
  handleKlingBillingAudit,
  handleKlingResourcePacks,
} from './kling.js';
import {
  handleMuapiModels,
  handleMuapiGenerate,
  handleMuapiPoll,
  handleMuapiDownload,
  handleWan2gpGenerate,
} from './opt-in-video.js';
import {
  handleSeedanceTextToVideo,
  handleSeedanceImageToVideo,
  handleSeedanceMultishot,
  handleSeedanceReferenceFusion,
} from './seedance.js';
import {
  type HandlersDeps,
  withImageDebit,
  reserveVideoSubmit,
  captureVideoComplete,
  preflightVideoCredit,
  releaseVideoFailed,
} from './billing.js';
import {
  looseRegister,
  wrap,
  asResult,
  validateInput,
  CAPABILITY_MATRIX,
  buildHelpText,
  type LooseRegisterTool,
} from './plumbing.js';

// ---------------------------------------------------------------------------
// registerAllTools — main export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// F-B: image artifact upload helper
// ---------------------------------------------------------------------------
// The image services return { base64, mimeType, ... } (NOT a Buffer and NOT a
// jobId). When storage is configured and the result carries real image bytes
// (not a dry-run), decode base64 -> Buffer, mint a deterministic jobId via the
// shared minter, upload to MinIO and return signed { url, expires_at } merged
// into the result. Graceful degradation: no storage / dry-run / empty bytes ->
// the original result passes through unchanged (F-A behaviour).
type ImageGenResult = {
  base64: string;
  mimeType: string;
  dryRun?: boolean;
};

async function maybeStoreImageArtifact(
  result: ImageGenResult,
  storage: OutputStorageClient | undefined,
  // The jobId the LEDGER row was written under, minted by the caller.
  //
  // This used to mint its own id with generateJobId(prefix), so the `job_id` the
  // caller got back named nothing in image_jobs: a user looking at a result could
  // not find its cost, and a cost row could not be traced to what it produced.
  // Two ids for one generation is not a cosmetic mismatch — it makes the ledger
  // unauditable from the outside, which is the one thing a ledger is for.
  jobId: string,
): Promise<unknown> {
  if (!storage || result.dryRun || !result.base64) {
    return result;
  }
  try {
    const bytes = Buffer.from(result.base64, 'base64');
    const artifact = await storeArtifact({
      storage,
      jobId,
      bytes,
      contentType: result.mimeType,
    });
    return { ...result, job_id: jobId, url: artifact.url, expires_at: artifact.expiresAt };
  } catch (err) {
    // Best-effort: upload failure must not drop the generated image. Surface the
    // base64 result (F-A path) so the caller still receives the artifact.
    process.stderr.write(
      `[image-storage] upload failed (${jobId}): ${(err as Error).message}\n`,
    );
    return result;
  }
}

export function registerAllTools(server: McpServer, deps: HandlersDeps): void {
  const { client, config, storage } = deps;
  const reg = looseRegister(server);

  // F-C: tier gating — pula o registro de tools fora do gate do tier.
  //
  // undefined/missing tier = 'pro'. Correct for stdio, where the person running
  // the process IS the operator and there is no tenant to gate against, and for
  // the existing tests. The hosted path never relies on it: `HttpAuthContext.tier`
  // is required, `app-internal.ts` passes `ctx.tier`, and `FlatKeyStore` only
  // returns a pro record for a key already in MEDIA_FORGE_API_KEYS.
  //
  // Logged anyway. The failure this makes visible is a FUTURE one: a new server
  // construction path that forgets to thread tier would silently register every
  // paid tool, and a silent grant of paid surface is not something to discover
  // from a bill. Cheap trace now beats an audit later.
  const effectiveTier = deps.tier ?? 'pro';
  if (deps.tier === undefined) {
    logger.debug('registerAllTools: no tier supplied, defaulting to pro (stdio/self-host path)');
  }
  function regIfAllowed(name: string, cfg: Parameters<LooseRegisterTool>[1], cb: Parameters<LooseRegisterTool>[2]): void {
    if (!isToolAllowed(effectiveTier, name)) return;
    reg(name, cfg, cb);
  }

  function getTool(name: string) {
    const t = MCP_TOOLS.find((tool) => tool.name === name);
    if (!t) throw new Error(`BUG: tool ${name} not found in MCP_TOOLS registry`);
    return t;
  }

  // ---------------------------------------------------------------------------
  // Per-request dry-run.
  //
  // Every image and video schema declares `dryRun`, and nothing read it: only
  // `client.dryRun`, fixed when the server was constructed, decided anything.
  // A caller passing `dryRun: true` to a normal server got a real generation and
  // a real charge — a parameter that reads like a safety and was not one.
  //
  // ASYMMETRIC on purpose. The request may only ever ADD dry-run, never remove
  // it. The field defaults to `false`, so every request against a server started
  // in dry-run mode carries `dryRun: false`; if the request won, `--dry-run`
  // would generate for real on every call.
  //
  // Resolves to a REAL dry-run client rather than `{ ...client, dryRun: true }`.
  // createClient also installs the SDK proxy, so a code path that ever slips
  // past a flag check still cannot reach the provider. Its `ai` is lazy, so
  // building one costs nothing until something actually asks for the SDK.
  let requestDryRunClient: MediaForgeClient | undefined;
  function clientFor(parsed: unknown): MediaForgeClient {
    if (client.dryRun) return client;
    if ((parsed as { dryRun?: unknown } | null | undefined)?.dryRun !== true) return client;
    return (requestDryRunClient ??= createClient({ config, dryRun: true }));
  }

  // ---------------------------------------------------------------------------
  // media-forge cost guards — evaluated BEFORE every image generation call and
  // (via KlingHandlerExecOpts.checkCostGuard / HiggsfieldHandlerExecOpts /
  // SeedanceHandlerExecOpts) before every Kling, Higgsfield, and Seedance
  // video submit, reading today's UTC spend across both video_jobs and image_jobs.
  //
  // Guard is SKIPPED under dry-run (the EFFECTIVE dry-run for the request — see
  // clientFor) — a dry run never calls the
  // provider and costs $0, so both the guard check and the ledger write it
  // would otherwise produce (recordImageJob, in the 3 image call sites below)
  // are meaningless. Recording a $0-real-cost job as 'pending' at its
  // estimate would count phantom spend against the cap forever (nothing ever
  // captures a dry-run row) — the exact failure mode this task exists to fix,
  // just inverted. Kling has no dry-run path (provider.generate() always
  // hits the network), so no such gating is needed there.
  // ---------------------------------------------------------------------------
  function checkCostGuardOrThrow(
    estimateUsd: number,
    // T14: retakes may draw on the slice of the daily cap reserved for them.
    // Defaults to 'new' so an un-updated call site gets the conservative
    // treatment rather than silently bypassing the reserve.
    purpose: SpendPurpose = deps.spendPurpose ?? 'new',
  ): { costWarning?: string } {
    const spentTodayUsd = dailySpendUsd({ dbPath: defaultDbPath(), tenantId: deps.tenantId ?? 'default' });
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      blockThresholdUsd: config.blockThresholdUsd,
      dailyCapUsd: config.dailyCapUsd,
      confirmThresholdUsd: config.confirmThresholdUsd,
      reservePct: config.budgetReservePct,
      reserveMode: config.budgetReserveMode,
      purpose,
    });
    if (decision.action === 'block') {
      const overBlock = estimateUsd > config.blockThresholdUsd;
      // A reserve block is neither of the two original kinds: the spend is
      // within the daily cap, it is only outside the slice new work may use.
      // Reporting it as 'daily-cap' against the full cap would show the user a
      // limit their spend has not actually reached, and point them at raising a
      // cap that was not the thing blocking them.
      const isReserveBlock =
        !overBlock && spentTodayUsd + estimateUsd <= config.dailyCapUsd;
      if (isReserveBlock) {
        throw new CostGuardError(
          decision.reason,
          estimateUsd,
          newWorkBudgetUsd(config.dailyCapUsd, config.budgetReservePct),
          'retake-reserve',
        );
      }
      throw new CostGuardError(
        decision.reason,
        estimateUsd,
        overBlock ? config.blockThresholdUsd : config.dailyCapUsd,
        overBlock ? 'block' : 'daily-cap',
      );
    }
    if (decision.action === 'warn') {
      return { costWarning: decision.reason };
    }
    return {};
  }

  // Non-cryptographic hash for the image_jobs.params_hash column — mirrors
  // the local hashParams() helpers already used per-provider in
  // src/video/providers/{kling,google-veo,bytedance-seedance}.ts.
  function hashImageParams(obj: unknown): string {
    const json = JSON.stringify(obj);
    let h = 0;
    for (let i = 0; i < json.length; i++) {
      h = ((h << 5) - h + json.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16);
  }

  // ---------------------------------------------------------------------------
  // A5 (2026-07-30) — reserve-BEFORE-submit ledger hooks for Kling, Higgsfield,
  // and Seedance, closing C8 for the three providers where it was still open
  // (see the T15/A5 sections of
  // .maxvision/plans/2026-07-29-higgsfield-kling-api-refresh.md). Built ONCE
  // per registerAllTools() call — i.e. once per request in hosted mode, where
  // `handleMcpRequest` (src/http/app-internal.ts) builds a fresh `deps` per
  // HTTP request — so this closure is scoped to exactly the tenant/credit
  // client this call was made with. See `VideoLedgerHooks` in base.ts for the
  // full contract and why hooks are threaded as a `generate()` parameter
  // rather than stored on the Higgsfield/Seedance provider singletons.
  //
  // `onSubmitFailed` and `onPostSubmitError` must NEVER throw (see base.ts) —
  // both wrap their real work in try/catch and log-and-swallow on failure,
  // mirroring submitVeoWithLedger's own cleanup below (and the precedent
  // pinned by veo-cleanup-failure-surfaces-original-error.test.ts): a failed
  // release must never replace the original error the caller needs to see.
  // ---------------------------------------------------------------------------
  const videoLedgerHooks: VideoLedgerHooks = {
    beforeSubmit: (jobId: string, estimateUsd: number) => reserveVideoSubmit(deps, jobId, estimateUsd),
    onSubmitFailed: async (jobId: string, estimateUsd: number) => {
      try {
        await releaseVideoFailed(deps, jobId, estimateUsd);
      } catch (releaseErr) {
        logger.warn('video submit cleanup: credit release failed, reservation will expire by TTL', {
          jobId,
          msg: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      }
    },
    onPostSubmitError: (jobId: string, estimateUsd: number, err: unknown) => {
      // The provider DID accept the job — do NOT release (see base.ts). This
      // is the known, bounded C8 gap this task cannot fully close (P1,
      // TODOS.md "APIs de dedução e uso do Kling não são usadas"): the
      // reservation expires by TTL and the generation goes unbilled unless an
      // operator reconciles by hand from this log line.
      logger.warn('video submit accepted but post-submit bookkeeping failed — reservation NOT released; will expire by TTL and go unbilled unless reconciled manually', {
        jobId,
        estimateUsd,
        err: err instanceof Error ? err.message : String(err),
      });
    },
  };

  // Shared opts for every Kling / Higgsfield / Seedance submit handler
  // (media-forge cost guards, Step 3 + Step 4; extended to Higgsfield + Seedance
  // in T15 part B, 2026-07-29): checkCostGuard runs the same guard used by the
  // image tools above; preflightCredit is a cheap balance-read fast-fail (see
  // preflightVideoCredit's doc comment in billing.ts). Both hooks run inside
  // the handler, BEFORE provider.generate() submits. `ledgerHooks` (A5,
  // 2026-07-30, built above) is forwarded into `provider.generate()` itself,
  // since the jobId these hooks key off doesn't exist until the provider
  // mints it. Structurally identical to KlingHandlerExecOpts,
  // HiggsfieldHandlerExecOpts, and SeedanceHandlerExecOpts, so this one object
  // is accepted by all three providers' handler functions.
  const videoGuardOpts = {
    checkCostGuard: checkCostGuardOrThrow,
    preflightCredit: (estimateUsd: number) => preflightVideoCredit(deps, estimateUsd),
    ledgerHooks: videoLedgerHooks,
  };

  // Records an image_jobs row around `exec` (skipped entirely under dry-run —
  // see checkCostGuardOrThrow's doc comment above). On success, settles at
  // actualCostUSD when the result carries one (rare) or the estimate
  // (exact for image cost, which is deterministic per size). On a THROWN
  // error (safety block, API error, network failure — all routine for image
  // generation), settles at actualUsd: 0 / finalStatus: 'failed' before
  // rethrowing, so the row does NOT stay 'pending' at its estimate forever —
  // a permanently-pending failed job would otherwise poison the rest of the
  // UTC day's cap for a call that cost nothing.
  async function withImageLedger<T>(
    jobId: string,
    model: string,
    paramsForHash: unknown,
    estimateUsd: number,
    exec: () => Promise<T>,
    // The EFFECTIVE dry-run for this request, not the server-wide flag — see
    // clientFor(). Passed rather than closed over so a request-level dry run
    // skips the ledger for the same reason a server-level one does.
    dryRun: boolean,
  ): Promise<T> {
    if (dryRun) return exec();
    recordImageJob({
      dbPath: defaultDbPath(),
      jobId,
      provider: 'google',
      model,
      paramsHash: hashImageParams(paramsForHash),
      estUsd: estimateUsd,
      tenantId: deps.tenantId ?? 'default',
    });
    let result: T;
    try {
      result = await exec();
    } catch (err) {
      recordImageActualCost({ dbPath: defaultDbPath(), jobId, actualUsd: 0, finalStatus: 'failed' });
      throw err;
    }
    // actualCostUSD is rarely present on image results (cost is deterministic per
    // size) — the estimate fallback is exact in production.
    const actualUsd = (result as { actualCostUSD?: number }).actualCostUSD ?? estimateUsd;
    recordImageActualCost({ dbPath: defaultDbPath(), jobId, actualUsd });
    return result;
  }

  // ---------------------------------------------------------------------------
  // T15/PR3b — Veo submit-before-reserve ledger (2026-07-29).
  //
  // Prior state (see the higgsfield-kling-api-refresh plan, T15): Veo never
  // called recordJob at all — GoogleVeoProvider.generate() is the only site
  // that does, and it's never invoked from the MCP tools below (they call
  // generateVideoT2V/I2V/etc. directly). Result: no video_jobs row, no cost
  // guard, no credit reserve, and dailySpendUsd blind to every Veo generation.
  //
  // This mirrors withImageLedger's shape but reserves credit too (video is
  // async — a submit and its eventual completion are different requests) and,
  // per C8, reserves BEFORE the submit: jobId is minted first, recordJob()
  // writes the 'pending' row using that jobId (the native operationName isn't
  // known yet), then reserveVideoSubmit() reserves — all before the network
  // call.
  //
  // A5 (2026-07-30) UPDATE: Kling, Higgsfield, and Seedance now ALSO reserve
  // credit before their network submit — see `videoLedgerHooks` above and
  // each provider's `generate()` (kling.ts / higgsfield.ts /
  // bytedance-seedance.ts). One real difference remains, and it is
  // deliberate, not an inconsistency to "fix": Veo's `recordJob` ALSO runs
  // before the submit (right here, a few lines down), because Veo has no
  // concept of "the provider accepted the job" distinct from the SDK call
  // itself. Kling/Higgsfield/Seedance keep `recordJob` deferred until AFTER a
  // successful submit — moving it earlier reintroduces the exact defect
  // their own comments describe (a permanent 'pending' row on every failed
  // submit); only their credit RESERVE moved earlier, not their ledger row.
  //
  // On success, setJobNativeTaskId binds the row to the returned
  // operationName so media_poll_video_operation can resolve it back via
  // findJobByNativeTaskId and settle it (capture/release) on completion — see
  // that handler below. On a throw from `exec` (safety block, API error,
  // network failure), the row settles at actualUsd:0/finalStatus:'failed' and
  // the reservation is released before rethrowing, so neither a pending row
  // nor a stuck reservation survives a submit that never charged anything.
  //
  // Dry-run bypasses ALL of this (guard, ledger, reserve) — identical
  // effective-dry-run gate used by the image tools above (see
  // checkCostGuardOrThrow's doc comment). A dry run never reaches the
  // provider and costs $0, so there is nothing to guard, record, or reserve.
  // ---------------------------------------------------------------------------
  async function submitVeoWithLedger(
    mode: VideoMode,
    jobIdPrefix: string,
    paramsForHash: unknown,
    estimateUsd: number,
    exec: () => Promise<GenerateVideoResult>,
    // Effective dry-run for this request — see clientFor() and withImageLedger.
    dryRun: boolean,
  ): Promise<GenerateVideoResult & { jobId?: string; costWarning?: string }> {
    if (dryRun) return exec();

    const guard = checkCostGuardOrThrow(estimateUsd);
    await preflightVideoCredit(deps, estimateUsd);

    const jobId = generateJobId(jobIdPrefix);
    recordJob({
      dbPath: defaultDbPath(),
      jobId,
      provider: 'google',
      model: VIDEO_MODEL_VEO_3_1_PRO,
      mode,
      paramsHash: hashImageParams(paramsForHash),
      estUsd: estimateUsd,
    });
    setJobTenant({ dbPath: defaultDbPath(), jobId, tenantId: deps.tenantId ?? 'default' });
    await reserveVideoSubmit(deps, jobId, estimateUsd);

    let result: GenerateVideoResult;
    try {
      result = await exec();
    } catch (err) {
      // Cleanup must never replace the caller's error. A submit that failed on a
      // safety block is far more actionable than "credit-core 500" from the
      // release that ran afterwards — and swallowing the original would hide the
      // only information the user can act on. releaseJob POSTs to credit-core and
      // throws CreditServiceError on a non-2xx after retries, and recordActualCost
      // hits SQLite, so both can fail independently of `exec`.
      // A release that does not land leaks the reservation until its TTL, which
      // the credit-core sweep already handles via the job-status oracle — the row
      // is 'failed' by then, or 'unknown', and both release rather than charge.
      try {
        recordActualCost({ dbPath: defaultDbPath(), jobId, actualUsd: 0, finalStatus: 'failed' });
      } catch (settleErr) {
        logger.warn('veo submit cleanup: ledger settle failed', {
          jobId,
          msg: settleErr instanceof Error ? settleErr.message : String(settleErr),
        });
      }
      try {
        await releaseVideoFailed(deps, jobId, estimateUsd);
      } catch (releaseErr) {
        logger.warn('veo submit cleanup: credit release failed, reservation will expire by TTL', {
          jobId,
          msg: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        });
      }
      throw err;
    }

    setJobNativeTaskId({ dbPath: defaultDbPath(), jobId, nativeTaskId: result.operationName });
    return { ...result, jobId, ...(guard.costWarning ? { costWarning: guard.costWarning } : {}) };
  }

  // ---- Image tools (6) ----

  {
    const t = getTool('media_generate_image');
    regIfAllowed(
      t.name,
      { title: 'Generate Image (Nano Banana Pro)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<{ imageSize?: '1K' | '2K' | '4K'; dryRun?: boolean }>(t, input);
        const c = clientFor(parsed);
        const estimateUsd = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          imageSize: parsed.imageSize ?? '4K',
        }).usd;
        // Guard + ledger are skipped under dry-run — see checkCostGuardOrThrow's doc comment above.
        const guard: { costWarning?: string } = c.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('nano-banana-pro');
        // The debit (reserve+capture) is skipped under dry-run for the SAME reason
        // the guard and ledger are: a dry run never calls the provider, so there is
        // nothing real to bill. Uses the identical effective-client check as above —
        // not a second way of asking "is this a dry run".
        const genExec = () => generateImageNanoBananaPro(parsed as never, c);
        const result = await withImageLedger(
          jobId,
          IMAGE_MODEL_NANO_BANANA_PRO,
          parsed,
          estimateUsd,
          () => (c.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec)),
          c.dryRun,
        );
        const structured = await maybeStoreImageArtifact(result, storage, jobId);
        return asResult(
          guard.costWarning
            ? { ...(structured as Record<string, unknown>), costWarning: guard.costWarning }
            : structured,
        );
      }),
    );
  }

  {
    const t = getTool('media_generate_imagen');
    regIfAllowed(
      t.name,
      { title: 'Generate Image (Imagen 4 Ultra)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { numberOfImages?: number; dryRun?: boolean };
        const estimateUsd = estimateImageCost({
          model: IMAGE_MODEL_IMAGEN_4_ULTRA,
          numberOfImages: inp.numberOfImages ?? 1,
        }).usd;
        const c = clientFor(inp);
        const guard: { costWarning?: string } = c.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('imagen-4-ultra');
        // Same dry-run gate as media_generate_image above — reuses the effective client.
        const genExec = () => generateImageImagen4Ultra(input as never, c);
        const result = await withImageLedger(
          jobId,
          IMAGE_MODEL_IMAGEN_4_ULTRA,
          inp,
          estimateUsd,
          () => (c.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec)),
          c.dryRun,
        );
        const structured = await maybeStoreImageArtifact(result, storage, jobId);
        return asResult(
          guard.costWarning
            ? { ...(structured as Record<string, unknown>), costWarning: guard.costWarning }
            : structured,
        );
      }),
    );
  }

  {
    const t = getTool('media_edit_image');
    regIfAllowed(
      t.name,
      { title: 'Edit Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<EditImageInputT>(t, input);
        // media_edit_image has no imageSize param (unlike media_generate_image) —
        // estimateImageCost defaults to '4K', matching the conservative default
        // used elsewhere for this model.
        const estimateUsd = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO }).usd;
        const c = clientFor(parsed);
        const guard: { costWarning?: string } = c.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('edit-image');
        // F-P1: media_edit_image generated without ever debiting — wire it through
        // withImageDebit exactly like media_generate_image/media_generate_imagen,
        // reusing the SAME estimate computed above (no second estimate). Skipped
        // under dry-run via the identical effective-client check used everywhere else.
        const genExec = () => editImage(parsed, c);
        const result = await withImageLedger(
          jobId,
          IMAGE_MODEL_NANO_BANANA_PRO,
          parsed,
          estimateUsd,
          () => (c.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec)),
          c.dryRun,
        );
        // job_id, like the two generate tools return. Both of these write an
        // image_jobs row and debit credit under `jobId` and then returned
        // nothing the caller could use to find it: money was recorded against
        // an id the caller never saw. Not a wrong id — no id at all.
        return asResult({
          ...(result as unknown as Record<string, unknown>),
          job_id: jobId,
          ...(guard.costWarning ? { costWarning: guard.costWarning } : {}),
        });
      }),
    );
  }

  {
    const t = getTool('media_compose_scene');
    regIfAllowed(
      t.name,
      { title: 'Compose Scene', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<ComposeSceneInputT>(t, input);
        // F-P1: media_compose_scene generated without any cost guard, ledger row,
        // or debit — free generation in hosted mode. ComposeSceneInput.model is
        // locked to IMAGE_MODEL_NANO_BANANA_PRO (same as media_generate_image),
        // and it carries the same imageSize field — reuse that estimator with the
        // same inputs media_generate_image uses (imageSize, default '4K').
        const estimateUsd = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          // ComposeSceneInput's imageSize field is a z.enum built from a widened
          // string[] cast (see IMAGE_SIZE / ImageSizeEnum in models.ts /
          // image-schemas.ts), so zod inference loses the '1K'|'2K'|'4K' literal
          // union here — same cast media_generate_image's estimator input needs.
          imageSize: parsed.imageSize as '1K' | '2K' | '4K',
        }).usd;
        const c = clientFor(parsed);
        const guard: { costWarning?: string } = c.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('compose-scene');
        const genExec = () => composeScene(parsed, c);
        const result = await withImageLedger(
          jobId,
          IMAGE_MODEL_NANO_BANANA_PRO,
          parsed,
          estimateUsd,
          () => (c.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec)),
          c.dryRun,
        );
        // Same reason as media_edit_image above: a ledger row and a debit under
        // `jobId` that the caller was never told about.
        return asResult({
          ...(result as unknown as Record<string, unknown>),
          job_id: jobId,
          ...(guard.costWarning ? { costWarning: guard.costWarning } : {}),
        });
      }),
    );
  }

  {
    const t = getTool('media_describe_image');
    regIfAllowed(
      t.name,
      { title: 'Describe Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await describeImage(input as never, clientFor(input)))),
    );
  }

  {
    const t = getTool('media_extract_palette');
    regIfAllowed(
      t.name,
      { title: 'Extract Color Palette', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await extractPalette(input as never))),
    );
  }

  // ---- Video tools (8) ----

  {
    const t = getTool('media_generate_video_t2v');
    regIfAllowed(
      t.name,
      { title: 'Generate Video (Text to Video)', description: t.description, inputSchema: t.inputSchema as never },
      // T15/PR3b: reserve-before-submit ledger — see submitVeoWithLedger above.
      // jobId is minted, recordJob()+setJobTenant() run, and credit is
      // reserved BEFORE generateVideoT2V ever reaches the network; the row is
      // bound to the returned operationName so media_poll_video_operation can
      // resolve it back and settle it on completion.
      wrap(t.name, async (input) => {
        const parsed = validateInput<GenerateVideoT2VInputT>(t, input);
        const estimateUsd = estimateVideoCost({
          model: VIDEO_MODEL_VEO_3_1_PRO,
          resolution: parsed.resolution as '720p' | '1080p' | '4k',
          generateAudio: parsed.generateAudio,
        }).usd;
        const c = clientFor(parsed);
        const result = await submitVeoWithLedger(
          't2v',
          'veo-t2v',
          parsed,
          estimateUsd,
          () => generateVideoT2V(parsed, c),
          c.dryRun,
        );
        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_generate_video_i2v');
    regIfAllowed(
      t.name,
      { title: 'Generate Video (Image to Video)', description: t.description, inputSchema: t.inputSchema as never },
      // T15/PR3b: same reserve-before-submit ledger — see media_generate_video_t2v note above.
      wrap(t.name, async (input) => {
        const parsed = validateInput<GenerateVideoI2VInputT>(t, input);
        const estimateUsd = estimateVideoCost({
          model: VIDEO_MODEL_VEO_3_1_PRO,
          resolution: parsed.resolution as '720p' | '1080p' | '4k',
          generateAudio: parsed.generateAudio,
        }).usd;
        const c = clientFor(parsed);
        const result = await submitVeoWithLedger(
          'i2v',
          'veo-i2v',
          parsed,
          estimateUsd,
          () => generateVideoI2V(parsed, c),
          c.dryRun,
        );
        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_generate_video_interpolate');
    regIfAllowed(
      t.name,
      { title: 'Generate Video (Interpolate)', description: t.description, inputSchema: t.inputSchema as never },
      // T15/PR3b: same reserve-before-submit ledger — see media_generate_video_t2v note above.
      wrap(t.name, async (input) => {
        const parsed = validateInput<GenerateVideoInterpolateInputT>(t, input);
        const estimateUsd = estimateVideoCost({
          model: VIDEO_MODEL_VEO_3_1_PRO,
          resolution: parsed.resolution as '720p' | '1080p' | '4k',
          generateAudio: parsed.generateAudio,
        }).usd;
        const c = clientFor(parsed);
        const result = await submitVeoWithLedger(
          'interpolate',
          'veo-interpolate',
          parsed,
          estimateUsd,
          () => generateVideoInterpolate(parsed, c),
          c.dryRun,
        );
        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_generate_video_with_refs');
    regIfAllowed(
      t.name,
      { title: 'Generate Video With References', description: t.description, inputSchema: t.inputSchema as never },
      // T15/PR3b: same reserve-before-submit ledger — see media_generate_video_t2v note above.
      wrap(t.name, async (input) => {
        const parsed = validateInput<GenerateVideoWithRefsInputT>(t, input);
        const estimateUsd = estimateVideoCost({
          model: VIDEO_MODEL_VEO_3_1_PRO,
          resolution: parsed.resolution as '720p' | '1080p' | '4k',
          generateAudio: parsed.generateAudio,
        }).usd;
        const c = clientFor(parsed);
        const result = await submitVeoWithLedger(
          'with-refs',
          'veo-with-refs',
          parsed,
          estimateUsd,
          () => generateVideoWithRefs(parsed, c),
          c.dryRun,
        );
        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_extend_video');
    // Adapter: ExtendVideoInput → ExtendOpts
    // v0.1.0 limitation: treats sourceVideoPath as sourceVideoUri, prompt as both
    // originalPrompt and extensionDirective (no separate directive field in schema).
    regIfAllowed(
      t.name,
      { title: 'Extend Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as {
          sourceVideoPath: string;
          prompt: string;
          hopIndex: number;
          dryRun?: boolean;
        };
        return asResult(
          await extendVideo({
            client,
            sourceVideoUri: inp.sourceVideoPath,
            sourceMimeType: 'video/mp4',
            originalPrompt: inp.prompt,
            extensionDirective: inp.prompt,
            hopIndex: inp.hopIndex ?? 0,
          }),
        );
      }),
    );
  }

  {
    const t = getTool('media_poll_video_operation');
    regIfAllowed(
      t.name,
      { title: 'Poll Video Operation', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { operationName: string; intervalMs?: number; timeoutMs?: number };
        const intervalMs = inp.intervalMs ?? 10000;
        // Round UP so a non-multiple timeout (e.g. timeoutMs=119999 / intervalMs=60000)
        // still gets the caller's full requested wait window. Math.floor would chop
        // off the partial last attempt. Matches the CLI poll/wait derivation.
        const maxAttempts = Math.ceil((inp.timeoutMs ?? 900000) / intervalMs);

        // T15/PR3b: resolve operationName back to the ledger row submitVeoWithLedger
        // wrote (via setJobNativeTaskId). No row = self-host, dry-run, billing off,
        // or a job predating this correlation — poll behaves exactly as before.
        const dbPath = defaultDbPath();
        const jobRow = findJobByNativeTaskId({ dbPath, nativeTaskId: inp.operationName });

        try {
          const result = await pollVideoOperation({
            client,
            operationName: inp.operationName,
            intervalMs,
            maxAttempts,
          });
          // pollVideoOperation only RETURNS when operation.done === true AND
          // operation.error is absent (success) — see polling.ts. Both the
          // still-in-flight (timeout) and done+failed cases throw instead, so
          // they're handled in the catch block below, not here.
          if (jobRow) {
            recordActualCost({ dbPath, jobId: jobRow.jobId, actualUsd: jobRow.estUsd, finalStatus: 'completed' });
            await captureVideoComplete(deps, jobRow.jobId, jobRow.estUsd);
          }
          return asResult(result);
        } catch (err) {
          // ApiError (polling.ts's `operation.error` branch, code 'API') means
          // done === true but the operation itself failed — terminal, release
          // the reservation. PollingError (timeout, code 'POLLING') means NOT
          // done yet — per spec, change nothing and let the caller re-poll.
          if (jobRow && err instanceof ApiError) {
            recordActualCost({ dbPath, jobId: jobRow.jobId, actualUsd: 0, finalStatus: 'failed' });
            await releaseVideoFailed(deps, jobRow.jobId, jobRow.estUsd);
          }
          throw err;
        }
      }),
    );
  }

  {
    const t = getTool('media_download_video');
    // v0.1.0: downloadVideo requires a direct videoUri (not an operationName).
    // If caller passes an operation name instead of a resolved URI, return a
    // structured error note rather than making a broken HTTP request.
    regIfAllowed(
      t.name,
      { title: 'Download Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as {
          operationName: string;
          outputDir?: string;
          filename?: string;
        };
        // downloadVideo uses fetch() under the hood and only supports HTTP(S)
        // URIs in this runtime. gs:// URIs (common in Vertex outputs) would
        // need to be signed first; reject with a clear actionable error
        // instead of failing late inside fetch.
        const isHttpUri =
          inp.operationName.startsWith('https://') || inp.operationName.startsWith('http://');
        const isGsUri = inp.operationName.startsWith('gs://');
        if (isGsUri) {
          return asResult({
            ok: false,
            note: 'media_download_video does not yet support gs:// URIs. Sign the GCS object to an https:// URL first (gsutil signurl or Cloud Storage signed URL API) and pass that here.',
            operationName: inp.operationName,
          });
        }
        if (!isHttpUri) {
          return asResult({
            ok: false,
            note: 'media_download_video requires a resolved https:// video URI. Re-poll the operation with media_poll_video_operation to get the videoUri from the response, then call this tool.',
            operationName: inp.operationName,
          });
        }
        return asResult(
          await downloadVideo({
            client,
            videoUri: inp.operationName,
            apiKey: config.apiKey,
            outputDir: inp.outputDir ?? config.outputDir,
            filename: inp.filename,
          }),
        );
      }),
    );
  }

  {
    // T9-d: local ffmpeg call only — no provider, no cost, so no cost guard
    // and no ledger row (unlike every submit-a-generation tool above).
    const t = getTool('media_extract_last_frame');
    regIfAllowed(
      t.name,
      { title: 'Extract Last Frame', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { videoPath: string; outputPath?: string; format?: 'jpg' | 'png' };
        return asResult(
          await extractLastFrame({
            videoPath: inp.videoPath,
            outputPath: inp.outputPath,
            format: inp.format,
          }),
        );
      }),
    );
  }

  // ---- Pipeline / Utility tools (8) ----

  {
    const t = getTool('media_dry_run_payload');
    regIfAllowed(
      t.name,
      { title: 'Dry Run Payload', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { op: string; params: Record<string, unknown> };
        return asResult({ dryRun: true, payload: inp });
      }),
    );
  }

  {
    const t = getTool('media_estimate_cost');
    regIfAllowed(
      t.name,
      { title: 'Estimate Cost', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { items: Array<{ op: string; params: Record<string, unknown> }> };
        let totalUsd = 0;
        const perItem: Array<{ op: string; usd: number; breakdown: string; refsBreakdown?: unknown }> = [];
        for (const item of inp.items) {
          let usd = 0;
          let breakdown = `Unknown op: ${item.op}`;
          let refsBreakdown: RefsEstimate | undefined;

          const op = item.op.toLowerCase();

          // Refs/moodboard operations — checked before generic image/video branches.
          // Triggered when params.refMode is set (MOODBOARD | SUBJECT_REF | TEXT_ONLY).
          const params_r = item.params as {
            refMode?: string;
            refCount?: number;
            subjectCount?: number;
            outputSize?: string;
            searchMode?: string;
          };
          if (params_r.refMode) {
            const mode = (['MOODBOARD', 'SUBJECT_REF', 'TEXT_ONLY'].includes(params_r.refMode ?? '')
              ? params_r.refMode
              : 'TEXT_ONLY') as 'MOODBOARD' | 'SUBJECT_REF' | 'TEXT_ONLY';
            const est = estimateRefsCost({
              mode,
              refCount: params_r.refCount ?? 0,
              subjectCount: params_r.subjectCount ?? 0,
              outputSize: (['1024', '2048', '4096'].includes(params_r.outputSize ?? '') ? params_r.outputSize : '2048') as '1024' | '2048' | '4096',
              searchMode: (params_r.searchMode === 'semantic' ? 'semantic' : 'tag'),
            });
            usd = est.totalUsd;
            breakdown = `refs/${mode}: lookup=$${est.refsLookupUsd.toFixed(4)} compose=$${est.moodboardComposeUsd.toFixed(4)} total=$${est.totalUsd.toFixed(4)}`;
            refsBreakdown = est;
          // Imagen takes priority over the generic generate_image fallback so
          // ops like `media_generate_image_imagen4_ultra` route to the Imagen
          // estimator instead of being mispriced as Nano Banana Pro.
          } else if (op.includes('imagen')) {
            const params = item.params as { numberOfImages?: number };
            const est = estimateImageCost({
              model: IMAGE_MODEL_IMAGEN_4_ULTRA,
              numberOfImages: params.numberOfImages ?? 1,
            });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('nano-banana') || op.includes('nano_banana') || op.includes('generate_image')) {
            const params = item.params as { imageSize?: string };
            const imageSize = (params.imageSize as '1K' | '2K' | '4K') ?? '4K';
            const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('video') || op.includes('veo') || op.includes('t2v') || op.includes('i2v')) {
            const params = item.params as { resolution?: string; generateAudio?: boolean };
            const est = estimateVideoCost({
              model: VIDEO_MODEL_VEO_3_1_PRO,
              resolution: (params.resolution as '720p' | '1080p' | '4k') ?? '720p',
              generateAudio: params.generateAudio ?? true,
            });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('image')) {
            // fallback: treat as nano-banana-pro
            const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize: '4K' });
            usd = est.usd;
            breakdown = est.breakdown;
          }

          totalUsd += usd;
          const entry: { op: string; usd: number; breakdown: string; refsBreakdown?: unknown } = { op: item.op, usd, breakdown };
          if (refsBreakdown !== undefined) entry.refsBreakdown = refsBreakdown;
          perItem.push(entry);
        }
        return asResult({ totalUsd, perItem });
      }),
    );
  }

  {
    const t = getTool('media_validate_environment');
    regIfAllowed(
      t.name,
      { title: 'Validate Environment', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (_input) => {
        const missing: string[] = [];
        const hasApiKey = Boolean(config.apiKey);
        const hasVertex = config.useVertex && Boolean(config.project);

        if (!hasApiKey && !hasVertex) {
          missing.push('GOOGLE_API_KEY (or GEMINI_API_KEY, or GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT)');
        }

        // Reachability check: confirm each LOCKED model id is reported by the
        // SDK's models.list endpoint. Catches the "valid key but model not
        // enabled / wrong region" false positive that pure credential checks
        // miss. If list itself fails (network/quota/403) record the error
        // rather than silently flipping ok=true.
        const lockedModels = [
          IMAGE_MODEL_NANO_BANANA_PRO,
          IMAGE_MODEL_IMAGEN_4_ULTRA,
          VIDEO_MODEL_VEO_3_1_PRO,
        ];
        const unreachable: string[] = [];
        let modelsListError: string | undefined;
        if (missing.length === 0) {
          try {
            const seen = new Set<string>();
            const pager = await client.ai.models.list();
            const page = pager as unknown as { page?: Array<{ name?: string }> };
            for (const m of page.page ?? []) {
              if (m.name) seen.add(m.name.replace(/^models\//, ''));
            }
            for (const id of lockedModels) {
              if (!seen.has(id)) unreachable.push(id);
            }
          } catch (err) {
            modelsListError = err instanceof Error ? err.message : String(err);
          }
        }

        const ok = missing.length === 0 && unreachable.length === 0 && !modelsListError;
        return asResult({
          ok,
          missing,
          ...(unreachable.length > 0 ? { unreachableModels: unreachable } : {}),
          ...(modelsListError ? { modelsListError } : {}),
        });
      }),
    );
  }

  {
    const t = getTool('media_capability_matrix');
    regIfAllowed(
      t.name,
      { title: 'Capability Matrix', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { model?: string };
        if (inp.model) {
          const entry = (CAPABILITY_MATRIX as Record<string, unknown>)[inp.model];
          if (!entry) {
            return asResult({ error: `Unknown model: ${inp.model}` });
          }
          return asResult({ [inp.model]: entry });
        }
        return asResult(CAPABILITY_MATRIX);
      }),
    );
  }

  {
    const t = getTool('media_list_outputs');
    regIfAllowed(
      t.name,
      { title: 'List Outputs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { project?: string; limit?: number };
        const limit = Math.max(1, Math.min(1000, inp.limit ?? 100));
        const jobsDir = path.join(config.projectDir, 'jobs');
        try {
          const entries = await fs.readdir(jobsDir);
          // Collect EVERY directory matching the OutputManager jobId pattern
          // before truncating. fs.readdir() does not promise chronological
          // ordering, so applying the limit during collection could drop the
          // newest jobs when more than `limit` entries exist on disk. Sort
          // first (jobId starts with ISO-like timestamp → reverse-lex ≈
          // newest-first) and slice afterwards.
          const all: Array<{ jobId: string; jobDir: string }> = [];
          for (const entry of entries) {
            if (!JOB_ID_PATTERN.test(entry)) continue;
            const jobDir = path.join(jobsDir, entry);
            const stat = await fs.stat(jobDir).catch(() => null);
            if (stat?.isDirectory()) {
              all.push({ jobId: entry, jobDir });
            }
          }
          all.sort((a, b) => b.jobId.localeCompare(a.jobId));
          const jobs = all.slice(0, limit);
          return asResult({ jobs, count: jobs.length, total: all.length, jobsDir });
        } catch (err) {
          // Directory missing simply means no jobs run yet — return empty.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return asResult({ jobs: [], count: 0, jobsDir });
          }
          throw err;
        }
      }),
    );
  }

  {
    const t = getTool('media_get_job_metadata');
    regIfAllowed(
      t.name,
      { title: 'Get Job Metadata', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { jobId: string };
        if (!JOB_ID_PATTERN.test(inp.jobId)) {
          throw new ValidationError(
            'Invalid jobId: must match [A-Za-z0-9][A-Za-z0-9_.-]{0,127}',
            { jobId: inp.jobId },
          );
        }
        // safeJoin throws FileSystemError if the resolved path escapes projectDir/jobs.
        const jobDir = safeJoin(config.projectDir, 'jobs', inp.jobId);

        // OutputManager persists artifacts in <jobDir>/v<N>/. Pick the latest
        // version (matches src/cli/commands/audit.ts behavior); fall back to
        // the job root when no version dirs exist (e.g. dry-run failure).
        const dirEntries = await fs.readdir(jobDir).catch(() => [] as string[]);
        const versions = dirEntries
          .filter((e) => /^v\d+$/.test(e))
          .map((e) => ({ name: e, n: parseInt(e.slice(1), 10) }))
          .sort((a, b) => b.n - a.n);
        const targetDir = versions.length > 0 ? path.join(jobDir, versions[0]!.name) : jobDir;

        const result: Record<string, unknown> = {
          jobId: inp.jobId,
          jobDir,
          ...(targetDir !== jobDir
            ? { versionDir: targetDir, version: path.basename(targetDir) }
            : {}),
        };

        // Read metadata.json from the version directory
        const metadataPath = path.join(targetDir, 'metadata.json');
        try {
          const raw = await fs.readFile(metadataPath, 'utf8');
          result['metadata'] = JSON.parse(raw) as unknown;
        } catch {
          result['metadata'] = null;
        }

        // Read trace.jsonl from the version directory
        const tracePath = path.join(targetDir, 'trace.jsonl');
        try {
          const raw = await fs.readFile(tracePath, 'utf8');
          result['trace'] = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => {
              try {
                return JSON.parse(l) as unknown;
              } catch {
                return l;
              }
            });
        } catch {
          result['trace'] = [];
        }

        // Read lineage.jsonl (lineage is per-job, not per-version, so stays at jobDir)
        const lineagePath = path.join(jobDir, 'lineage.jsonl');
        try {
          const raw = await fs.readFile(lineagePath, 'utf8');
          result['lineage'] = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => {
              try {
                return JSON.parse(l) as unknown;
              } catch {
                return l;
              }
            });
        } catch {
          result['lineage'] = [];
        }

        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_run_ocr');
    regIfAllowed(
      t.name,
      { title: 'Run OCR', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { imagePath: string; languages?: string[] };
        const validator = new OcrValidator({ backend: config.ocrBackend });
        const result = await validator.validateText({
          imagePath: inp.imagePath,
          requiredText: '',
          hasTextIntent: true,
          // Forward caller-supplied BCP-47 language hints to Cloud Vision so
          // multilingual assets get accurate detection. Dropping this field
          // silently degrades recognition while appearing to honor the input.
          ...(inp.languages !== undefined ? { languages: inp.languages } : {}),
        });
        return asResult({
          imagePath: inp.imagePath,
          detectedText: result.detectedText,
          backend: result.backend,
          skipped: result.skipped,
        });
      }),
    );
  }

  {
    const t = getTool('media_check_brand_compliance');
    regIfAllowed(
      t.name,
      { title: 'Check Brand Compliance', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { imagePath: string; brandGuidelinesPath: string };
        return asResult(
          await checkBrand({
            imagePath: inp.imagePath,
            guidelinesPath: inp.brandGuidelinesPath,
            // Full brand compliance: include logo identity check when
            // guidelines.logo is set in brand-guidelines.yml. checkBrand
            // no-ops the logo branch when guidelines.logo is absent, so
            // non-logo brands are unaffected.
            enableLogoDetection: true,
          }),
        );
      }),
    );
  }

  // ---- Help (1) ----

  {
    const t = getTool('media_help');
    regIfAllowed(
      t.name,
      { title: 'Help', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { topic?: string };
        const text = buildHelpText(inp.topic);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: { topic: inp.topic ?? null, text },
        };
      }),
    );
  }

  // ---- Refs tools (Phase 1+) ----

  const refsCfg = {
    endpoint: deps.config.minioEndpoint ?? '',
    region: deps.config.minioRegion,
    bucket: deps.config.minioBucket,
    accessKey: deps.config.minioAccessKey,
    secretKey: deps.config.minioSecretKey,
    useSsl: deps.config.minioUseSsl,
  };
  const refsService = createRefsService(refsCfg, deps.client, {
    pgvectorUrl: deps.config.pgvectorUrl,
    voyageApiKey: deps.config.voyageApiKey,
    projectDir: deps.config.projectDir,
  });

  {
    const t = getTool('media_refs_search');
    regIfAllowed(
      t.name,
      { title: 'Search reference assets in media-forge-refs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<RefsSearchInputT>(t, input);
        // Coalesce snake_case alias (from hook / prompt-engineer) with camelCase field.
        // Default for refsDisabled is false, so we must OR both fields (not ??) to avoid
        // clobbering a refs_disabled=true that got parsed alongside a default-false refsDisabled.
        if (parsed.refsDisabled === true || parsed.refs_disabled === true) {
          return asResult({ enabled: true, refs: [], reason: 'refs_disabled=true on this call' });
        }
        if (!deps.config.refsEnabled) {
          return asResult({ enabled: false, refs: [], reason: 'MEDIA_FORGE_REFS_ENABLED=false' });
        }
        const refs = await refsService.searchRefs(parsed);
        return asResult({ enabled: true, refs });
      }),
    );
  }

  {
    const t = getTool('media_refs_compose_moodboard');
    regIfAllowed(
      t.name,
      { title: 'Compose a moodboard keyframe from refs + subject images', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<RefsComposeMoodboardInputT>(t, input);
        const result = await refsService.composeMoodboardFromKeys(parsed);
        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_refs_presign');
    regIfAllowed(
      t.name,
      { title: 'Generate presigned URLs for ref objects', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const parsed = validateInput<RefsPresignInputT>(t, input);
        const items = await refsService.presignKeys(parsed);
        return asResult({ items });
      }),
    );
  }

  {
    const t = getTool('media_refs_index');
    regIfAllowed(
      t.name,
      { title: 'Index refs bucket into pgvector (Phase 2)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const _parsed = validateInput<RefsIndexInputT>(t, input);
        return asResult({
          enabled: false,
          reason: 'Phase 2 not yet implemented. Tool reserved for future indexer.',
        });
      }),
    );
  }

  // ---- Webhook (1 — P13 scaffold for P14+ provider callbacks) ----
  //
  // Status-only tool. The router itself is started in `startStdioServer()` from
  // env vars (MEDIA_FORGE_WEBHOOK_PORT + MEDIA_FORGE_WEBHOOK_SECRET) — kept out
  // of `buildServer()` so tests that instantiate via buildServer() do not need
  // to bind a TCP port. When secret is unset, the router stays off and this tool
  // reports `{ running: false, handlers: [] }`.
  {
    const t = getTool('media_video_webhook_status');
    regIfAllowed(
      t.name,
      { title: 'Webhook Router Status', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async () => asResult(await handleVideoWebhookStatus())),
    );
  }

  // ---- Cost estimation (2 — P13 provider-registry cost tools) ----

  {
    const t = getTool('media_video_cost_estimate');
    regIfAllowed(
      t.name,
      { title: 'Video Cost Estimate', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoCostEstimate(input))),
    );
  }

  {
    const t = getTool('media_video_cost_report');
    regIfAllowed(
      t.name,
      { title: 'Video Cost Report', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoCostReport(input))),
    );
  }

  // ---- Routing (1 — P13 cross-provider routing heuristic; Veo-only today) ----

  {
    const t = getTool('media_video_route');
    regIfAllowed(
      t.name,
      { title: 'Video Provider Routing', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleVideoRoute(input))),
    );
  }

  // ---- Higgsfield Soul ID (1 — P14 character training cache) ----

  {
    const t = getTool('media_higgsfield_soul_id');
    regIfAllowed(
      t.name,
      {
        title: 'Higgsfield Soul ID',
        description: t.description,
        inputSchema: t.inputSchema as never,
      },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldSoulId(input))),
    );
  }

  // T15 part B (2026-07-29): guard + preflight run INSIDE each of the 6
  // Higgsfield submit handlers below (DoP, Cinema Studio, Speak, Marketing
  // Studio, Recast, Generate) via HiggsfieldHandlerExecOpts — same
  // videoGuardOpts object already shared with Kling above.
  //
  // A5 (2026-07-30) UPDATE: the reserve itself no longer runs here, AFTER
  // each handler returns. It runs INSIDE HiggsfieldProvider.generate(), via
  // the `ledgerHooks.beforeSubmit` hook (part of videoGuardOpts above),
  // called right after generate() mints its own jobId but BEFORE the
  // platform submit — closing C8 for Higgsfield the same way Veo already
  // closed it (submitVeoWithLedger, above). `recordJob` is UNCHANGED and
  // still only runs after a successful submit (higgsfield.ts) — a permanent
  // 'pending' row on every failed submit is exactly the defect that ordering
  // exists to avoid; only the credit RESERVE moved earlier. setJobTenant
  // still runs here, after the handler returns: it's an UPDATE keyed on the
  // row's own id (`UPDATE video_jobs SET tenant_id = ? WHERE id = ?` —
  // cost-tracker.ts), so it needs the row `recordJob` writes to already
  // exist, which it does by the time the handler returns.
  //
  // The previous comment here was wrong about the capture point: it claimed
  // recordActualCostUSD (declared on HiggsfieldProvider) was where completion
  // gets reconciled. It doesn't — grep `recordActualCostUSD` under src/: it's
  // declared once on the VideoProvider interface (base.ts) and implemented by
  // all four providers, but has ZERO callers anywhere in the handler/register
  // layer. It is dead interface surface, not a capture path.
  //
  // The REAL capture path is wired below at media_higgsfield_poll, and it is
  // NEW, not a rewire of something that already settled these rows: before
  // this change nothing ever called recordActualCost for a Higgsfield job —
  // the webhook handler is an explicit logging stub (see
  // higgsfield-webhook-handler.ts:34, "no cost is recorded here"), and the
  // old poll handler (this file, pre-T15-part-B) only forwarded pollStatus's
  // result without touching the ledger. So this isn't "the credit side was
  // missing, the DB side already worked" — media_higgsfield_poll below is the
  // first thing that ever settles a Higgsfield video_jobs row to a terminal
  // actual_usd, for either side (DB or credit).
  //
  // The poll input's `jobId` IS the same internal id HiggsfieldProvider.
  // generate() already writes via recordJob — no native-task-id indirection
  // needed (unlike Veo, which had to bind operationName back to its own
  // jobId). When pollStatus's returned state is terminal, the poll handler
  // settles the row directly: capture on 'completed', release on 'failed' |
  // 'nsfw' | 'canceled' (mapPlatformStatus's full failure set — see
  // higgsfield.ts's mapPlatformStatus). 'pending' | 'in_progress' change
  // nothing, same as a Veo poll that isn't done yet.
  //
  // The capture call below passes finalStatus:'completed' without
  // actualCredits, same as Veo's poll settle above (register.ts, ~line 690) —
  // deliberately consistent with part A, not an oversight. Kling's download
  // path (kling.ts) does pass actualCredits via videoActualCredits(actualUsd)
  // because it captures through a different call chain; Higgsfield's own
  // captureVideoComplete() call just below independently re-derives credits
  // from actualUsd (billing.ts), so the omission here is harmless — it only
  // means the DB row's own actual_credits column stays null, which nothing
  // downstream reads.

  // ---- Higgsfield DoP (1 — P14 image-to-video with WAN Camera Control verbs) ----

  {
    const t = getTool('media_higgsfield_dop');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield DoP', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleHiggsfieldDop(input, videoGuardOpts);
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Higgsfield Cinema Studio (1 — P14 1,296 virtual lenses, focal/aperture/sensor/grading) ----

  {
    const t = getTool('media_higgsfield_cinema_studio');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Cinema Studio', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleHiggsfieldCinemaStudio(input, videoGuardOpts);
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Higgsfield Speak (1 — P14 Task 11 lip-sync: portrait + audio → talking head) ----

  {
    const t = getTool('media_higgsfield_speak');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Speak', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleHiggsfieldSpeak(input, videoGuardOpts);
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Higgsfield Marketing Studio (1 — P14 Task 12 UGC templates from product URL) ----

  {
    const t = getTool('media_higgsfield_marketing_studio');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Marketing Studio', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleHiggsfieldMarketingStudio(input, videoGuardOpts);
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Higgsfield Recast (1 — P14 Task 13 character swap in existing video) ----

  {
    const t = getTool('media_higgsfield_recast');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Recast', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleHiggsfieldRecast(input, videoGuardOpts);
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Higgsfield Virality Predictor (1 — P14 Task 14 score asset viral/audience/hook) ----

  {
    const t = getTool('media_higgsfield_virality_predictor');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Virality Predictor', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldViralityPredictor(input))),
    );
  }

  // ---- Higgsfield Generate (Codex P2 round 7 PR#10 — generic Soul/Soul2 submit) ----
  {
    const t = getTool('media_higgsfield_generate');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Generate', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleHiggsfieldGenerate(input, videoGuardOpts);
        // SE2: attribute the job to the caller so the async webhook can record the gallery row.
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Higgsfield Poll + Download (Codex P2 round 5 PR#10 — async lifecycle) ----
  //
  // T15 part B: settles the video_jobs row + credit reservation opened by the
  // 6 submit sites above. input.jobId IS the row's own id (no native-task-id
  // translation needed, unlike Veo) — see the comment above the DoP site.
  // Capture on 'completed'; release on any of the 3 failure-equivalent
  // terminal states ('failed' | 'nsfw' | 'canceled', mapPlatformStatus's full
  // set in higgsfield.ts); 'pending' | 'in_progress' settle nothing, mirroring
  // a Veo poll that returns before the operation is done.
  {
    const t = getTool('media_higgsfield_poll');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Poll', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const result = await handleHiggsfieldPoll(input, { storage });
        const dbPath = defaultDbPath();
        const jobRow = getJobRecord({ dbPath, jobId: result.jobId });
        if (jobRow) {
          if (result.state === 'completed') {
            const actualUsd = jobRow.actualUsd ?? jobRow.estUsd;
            recordActualCost({ dbPath, jobId: jobRow.jobId, actualUsd, finalStatus: 'completed' });
            await captureVideoComplete(deps, jobRow.jobId, actualUsd);
          } else if (result.state === 'failed' || result.state === 'nsfw' || result.state === 'canceled') {
            recordActualCost({ dbPath, jobId: jobRow.jobId, actualUsd: 0, finalStatus: result.state });
            await releaseVideoFailed(deps, jobRow.jobId, jobRow.estUsd);
          }
          // 'pending' | 'in_progress': not done yet — change nothing, let the caller re-poll.
        }
        return asResult(result);
      }),
    );
  }
  {
    const t = getTool('media_higgsfield_download');
    regIfAllowed(
      t.name,
      { title: 'Higgsfield Download', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleHiggsfieldDownload(input))),
    );
  }

  // ---- Kling Motion Brush (1 — P15 Task 6: paint regions of still image with motion vectors) ----

  {
    const t = getTool('media_kling_motion_brush');
    regIfAllowed(
      t.name,
      { title: 'Kling Motion Brush', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleKlingMotionBrush(input, videoGuardOpts);
        // A5 (2026-07-30): the reserve itself now runs INSIDE
        // KlingProvider.generate() via ledgerHooks.beforeSubmit (part of
        // videoGuardOpts), BEFORE the submit reaches Kling — see the comment
        // above the Higgsfield DoP site for the full rationale. Keyed on the
        // SAME jobId media_kling_download later captures with. No-op when
        // billing off. 402 → wrap → tool error.
        // SE2: attribute the job to the caller so the async webhook can record the gallery row.
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Kling Elements CRUD (3 — P15 Tasks 6.5 / 6.6 / 6.7) ----

  {
    const t = getTool('media_kling_element_create');
    regIfAllowed(
      t.name,
      { title: 'Kling Element Create', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElementCreate(input))),
    );
  }

  {
    const t = getTool('media_kling_element_list');
    regIfAllowed(
      t.name,
      { title: 'Kling Element List', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElementList(input))),
    );
  }

  {
    const t = getTool('media_kling_element_delete');
    regIfAllowed(
      t.name,
      { title: 'Kling Element Delete', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingElementDelete(input))),
    );
  }

  // ---- Kling Elements composition (1 — P15 Task 7: compose up to 4 frame-locked identities into one shot) ----

  {
    const t = getTool('media_kling_elements');
    regIfAllowed(
      t.name,
      { title: 'Kling Elements', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleKlingElements(input, videoGuardOpts);
        // SE2: attribute the job to the caller so the async webhook can record the gallery row.
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Kling Lip-Sync (1 — P15 Task 8: text or audio driven lip-sync) ----

  {
    const t = getTool('media_kling_lip_sync');
    regIfAllowed(
      t.name,
      { title: 'Kling Lip-Sync', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleKlingLipSync(input, videoGuardOpts);
        // SE2: attribute the job to the caller so the async webhook can record the gallery row.
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Kling Omni Multi-Shot (1 — P15 Task 9: single-API multi-cut orchestration) ----

  {
    const t = getTool('media_kling_omni_multishot');
    regIfAllowed(
      t.name,
      { title: 'Kling Omni Multi-Shot', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleKlingOmniMultiShot(input, videoGuardOpts);
        // SE2: attribute the job to the caller so the async webhook can record the gallery row.
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Kling Video Extend (1 — P15 Task 10: add ~4.5s continuation per hop, up to 4 hops ~18s) ----

  {
    const t = getTool('media_kling_video_extend');
    regIfAllowed(
      t.name,
      { title: 'Kling Video Extend', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const r = await handleKlingVideoExtend(input, videoGuardOpts);
        // SE2: attribute the job to the caller so the async webhook can record the gallery row.
        if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
        return asResult(r);
      }),
    );
  }

  // ---- Kling lifecycle (2 — Codex P1 round 6 PR#11: manual completion path) ----

  {
    const t = getTool('media_kling_poll');
    regIfAllowed(
      t.name,
      { title: 'Kling Poll', description: t.description, inputSchema: t.inputSchema as never },
      // F-E: on terminal failure, the reservation is NOT explicitly released here — the poll
      // input carries only jobId (no estimate to pass as reservedCredits). credit-core's TTL
      // sweep releases the stuck reservation (no capture ever fires for a failed job → no
      // double-charge). `releaseVideoFailed` is available for callers that DO have the estimate.
      wrap(t.name, async (input) => asResult(await handleKlingPoll(input, { storage }))),
    );
  }

  // The two billing tools. Both provider methods shipped tested and with no
  // caller at all — a shape `fallow audit --production` cannot flag, because
  // they are methods on a class the router already reaches. A green suite over
  // an unreachable settlement path reads exactly like a working ledger.
  // Opt-in providers. Direct-access by design — see the header of
  // handlers/opt-in-video.ts for why neither belongs in the automatic router.
  {
    const t = getTool('media_muapi_models');
    regIfAllowed(
      t.name,
      { title: 'MuAPI Catalogue', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleMuapiModels(input))),
    );
  }

  {
    const t = getTool('media_muapi_generate');
    regIfAllowed(
      t.name,
      { title: 'MuAPI Generate', description: t.description, inputSchema: t.inputSchema as never },
      // videoGuardOpts, exactly as Kling/Higgsfield/Seedance get it. Passing
      // nothing here — the previous state — meant MuAPI was the one paid
      // provider whose spend reached no reserve, no cost guard and no daily cap.
      wrap(t.name, async (input) => asResult(await handleMuapiGenerate(input, videoGuardOpts))),
    );
  }

  {
    const t = getTool('media_muapi_poll');
    regIfAllowed(
      t.name,
      { title: 'MuAPI Poll', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleMuapiPoll(input))),
    );
  }

  {
    const t = getTool('media_muapi_download');
    regIfAllowed(
      t.name,
      { title: 'MuAPI Download', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleMuapiDownload(input))),
    );
  }

  {
    const t = getTool('media_wan2gp_generate');
    regIfAllowed(
      t.name,
      { title: 'Wan2GP Generate (self-hosted)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleWan2gpGenerate(input))),
    );
  }

  {
    const t = getTool('media_kling_billing_reconcile');
    regIfAllowed(
      t.name,
      { title: 'Kling Billing Reconcile', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingBillingReconcile(input))),
    );
  }

  {
    const t = getTool('media_kling_billing_audit');
    regIfAllowed(
      t.name,
      { title: 'Kling Billing Audit', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingBillingAudit(input))),
    );
  }

  {
    const t = getTool('media_kling_resource_packs');
    regIfAllowed(
      t.name,
      { title: 'Kling Resource Packs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await handleKlingResourcePacks(input))),
    );
  }

  {
    const t = getTool('media_kling_download');
    regIfAllowed(
      t.name,
      { title: 'Kling Download', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const result = await handleKlingDownload(input, { storage });
        // F-E: capture the REAL cost on completion. jobId = the kling job id (NOT a raw URL,
        // which has no reservation to settle). Idempotent via cap-{jobId}. No-op when billing
        // off. This is the PRIMARY capture path for video; credit-core's TTL sweep is the
        // safety net for the webhook-router path (stdio entrypoint, no per-request creditClient).
        {
          const r = result as { jobIdOrUrl: string; actualUsd?: number };
          if (typeof r.actualUsd === 'number' && !r.jobIdOrUrl.startsWith('http')) {
            await captureVideoComplete(deps, r.jobIdOrUrl, r.actualUsd);
          }
        }
        // F-I: record the completed generation in the gallery.
        // credits_debited + credit_value_usd are set to 0 as a documented placeholder —
        // they require F-D capture-call integration (credit-core not yet wired into media-forge).
        // SEAM F-D: replace 0/0 with actual credits/creditValue from capture response when
        // http://credit-core:8080 capture is integrated.
        if (deps.galleryStore && typeof (result as Record<string, unknown>).actualUsd === 'number') {
          const parsed = KlingDownloadInput.safeParse(input);
          if (parsed.success && !parsed.data.jobIdOrUrl.startsWith('http')) {
            await deps.galleryStore.insertGeneration({
              generationId: parsed.data.jobIdOrUrl,
              tenantId: deps.tenantId ?? 'default',
              model: 'kling',
              provider: 'kling',
              costUsd: (result as Record<string, unknown>).actualUsd as number,
              creditsDebited: 0,      // SEAM F-D: fill from credit-core capture
              creditValueUsd: 0.01,   // SEAM F-D: fill from credit-core capture
              // SE2 Task 4c (eng review D1): include minio_key so both sync and webhook writers
              // produce equivalent rows — ON CONFLICT(generation_id) DO NOTHING is first-writer-wins,
              // but whichever wins now carries the artifact link. Mirrors the webhook key expression.
              minioKey: `outputs/${parsed.data.jobIdOrUrl}.mp4`,
              status: 'completed',
            }).catch((err: unknown) => {
              process.stderr.write(
                `[gallery] insertGeneration failed for ${parsed.data.jobIdOrUrl}: ${(err as Error).message}\n`,
              );
            });
          }
        }
        return asResult(result);
      }),
    );
  }

  // T15 part B (2026-07-29): guard + preflight run INSIDE each of the 4
  // Seedance submit handlers below via SeedanceHandlerExecOpts (same
  // videoGuardOpts object shared with Kling + Higgsfield above).
  //
  // A5 (2026-07-30) UPDATE: the reserve itself no longer runs here, AFTER
  // each handler returns. It runs INSIDE
  // BytedanceSeedanceProvider.generate(), via `ledgerHooks.beforeSubmit`
  // (part of videoGuardOpts), called right after generate() mints its own
  // jobId but BEFORE fal.ai/ARK ever sees the request — closing C8 for
  // Seedance the same way Veo already closed it (submitVeoWithLedger,
  // above). `recordJob` (via the `recordOnSuccess` closure) is UNCHANGED and
  // still only runs once fal.ai/ARK accepts the submit — only the credit
  // reserve moved earlier. setJobTenant still runs here, after the handler
  // returns: it's an UPDATE keyed on the row's own id, so it needs the row
  // `recordOnSuccess` writes to already exist, which it does by the time the
  // handler returns.
  //
  // The previous comment here made the same wrong claim the Higgsfield one
  // did: recordActualCostUSD is NOT the capture point for any of the 4
  // providers — it's declared once on VideoProvider (base.ts) and
  // implemented 4 times, with zero callers anywhere in src/. Delete that
  // belief entirely; it never described this codebase.
  //
  // What IS true, and needs no new wiring: Seedance's REAL capture path
  // already exists at the provider level. pollStatus (invoked from the
  // webhook AND from a direct re-poll) calls recordActualCost directly
  // inside bytedance-seedance.ts on every terminal transition — success at
  // :439, failed/nsfw/canceled at :452. Neither call site has a per-request
  // creditClient (the webhook is the stdio entrypoint; pollStatus takes no
  // `deps`), so CREDIT settlement — as opposed to the video_jobs row, which
  // Seedance already settles itself — runs through the sweep instead:
  // reserveVideoSubmit (called via videoLedgerHooks.beforeSubmit, above) sets
  // `statusUrl` from MEDIA_FORGE_INTERNAL_URL, the row lands in video_jobs on
  // submit success, src/http/job-status.ts
  // serves that row to credit-core's sweep, and the sweep captures on
  // 'completed' / releases on 'failed' or 'unknown'. There is deliberately no
  // capture/release call anywhere in this file for Seedance — the sweep is
  // the intended settler, not a gap left by this task.
  //
  // KNOWN GAP, reported not fixed (out of scope for T15 part B — changing
  // what the sweep captures is a billing decision): the success path at
  // bytedance-seedance.ts:439 calls recordActualCost WITHOUT actualCredits,
  // so the job-status oracle answers `{ status: 'completed' }` with no
  // amount for the sweep to capture at.

  // ---- Seedance 2.0 (ByteDance) — P16 Task 7 (4 tools: t2v / i2v / multishot / reference-fusion) ----
  // Task 8.5: all 4 tools are conditionally registered based on MEDIA_FORGE_SEEDANCE_ENABLED flag.
  // When the flag is false, none of these tools appear in the MCP tool surface and the router
  // excludes 'bytedance' via getAdaptedProviders(). Default: enabled.

  if (isSeedanceEnabled()) {
    {
      const t = getTool('media_seedance_text_to_video');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Text-to-Video', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => {
          const r = await handleSeedanceTextToVideo(input, videoGuardOpts);
          // SE2: attribute the job to the caller so the async webhook can record the gallery row.
          if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
          return asResult(r);
        }),
      );
    }

    {
      const t = getTool('media_seedance_image_to_video');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Image-to-Video', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => {
          const r = await handleSeedanceImageToVideo(input, videoGuardOpts);
          // SE2: attribute the job to the caller so the async webhook can record the gallery row.
          if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
          return asResult(r);
        }),
      );
    }

    {
      const t = getTool('media_seedance_multishot');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Multi-Shot', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => {
          const r = await handleSeedanceMultishot(input, videoGuardOpts);
          // SE2: attribute the job to the caller so the async webhook can record the gallery row.
          if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
          return asResult(r);
        }),
      );
    }

    {
      const t = getTool('media_seedance_reference_fusion');
      regIfAllowed(
        t.name,
        { title: 'Seedance 2.0 Reference Fusion', description: t.description, inputSchema: t.inputSchema as never },
        wrap(t.name, async (input) => {
          const r = await handleSeedanceReferenceFusion(input, videoGuardOpts);
          // SE2: attribute the job to the caller so the async webhook can record the gallery row.
          if (r.jobId) setJobTenant({ dbPath: defaultDbPath(), jobId: r.jobId, tenantId: deps.tenantId ?? 'default' });
          return asResult(r);
        }),
      );
    }
  }

  // ---- Gallery (F-I) — list_my_generations: tenant from AuthContext, never from client ----
  {
    const t = getTool('list_my_generations');
    regIfAllowed(
      t.name,
      {
        title: 'List My Generations',
        description: t.description,
        inputSchema: t.inputSchema as never,
      },
      wrap(t.name, async (input) => {
        const parsed = ListMyGenerationsInput.safeParse(input);
        if (!parsed.success) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_input', issues: parsed.error.issues }) }],
            isError: true,
          };
        }
        // tenantId comes from AuthContext (F-C seam). Falls back to 'default' for self-host (no DATABASE_URL).
        const tenantId = deps.tenantId ?? 'default';
        const galleryStore = deps.galleryStore;
        if (!galleryStore) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'gallery_not_configured' }) }],
            isError: true,
          };
        }
        const page = await galleryStore.listGenerations({
          tenantId,
          page: parsed.data.page,
          pageSize: parsed.data.page_size,
        });
        return { content: [{ type: 'text', text: JSON.stringify(page) }] };
      }),
    );
  }

  // ---- Narrative planner (T13) ----
  //
  // Deliberately NOT wired to checkCostGuardOrThrow. The guard and the ledger
  // meter per-generation provider spend in USD; these are Anthropic token calls,
  // which the reviewer in src/review/llm-judge.ts has always made outside the
  // guard too. Metering tokens is a real design change, not a line to add here,
  // and both tool descriptions say so rather than leaving it ambiguous.
  //
  // Planning produces no video and consumes no provider credit.
  {
    const t = getTool('media_narrative_plan');
    regIfAllowed(
      t.name,
      { title: 'Plan a Narrative Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const state = await handleNarrativePlan(input, {
          dbPath: defaultDbPath(),
          tenantId: deps.tenantId ?? null,
        });
        return asResult(state as unknown as Record<string, unknown>);
      }),
    );
  }

  {
    const t = getTool('media_narrative_assemble');
    regIfAllowed(
      t.name,
      { title: 'Assemble a Narrative Plan', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const state = await handleNarrativeAssemble(input, {
          dbPath: defaultDbPath(),
          tenantId: deps.tenantId ?? null,
        });
        return asResult(state as unknown as Record<string, unknown>);
      }),
    );
  }

  // ---- Narrative executor: the consumer T10/T13 were built for ----
  //
  // Also outside the cost guard, and for a stronger reason than the planner: none
  // of these three dispatches anything. execute_clip prepares and returns the
  // tool to call; the guard runs inside THAT tool, where it already does. Wiring
  // a second guard here would reserve credit for a generation that may never be
  // submitted, and the reservation would sit until its TTL swept it.
  {
    const t = getTool('media_narrative_execute_clip');
    regIfAllowed(
      t.name,
      { title: 'Prepare the Next Clip', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) =>
        asResult(
          (await handleNarrativeExecuteClip(input, {
            dbPath: defaultDbPath(),
            tenantId: deps.tenantId ?? null,
          })) as unknown as Record<string, unknown>,
        ),
      ),
    );
  }

  {
    const t = getTool('media_narrative_record_run');
    regIfAllowed(
      t.name,
      { title: 'Record a Narrative Run', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) =>
        asResult(
          (await handleNarrativeRecordRun(input, {
            dbPath: defaultDbPath(),
            tenantId: deps.tenantId ?? null,
          })) as unknown as Record<string, unknown>,
        ),
      ),
    );
  }

  {
    const t = getTool('media_narrative_record_take');
    regIfAllowed(
      t.name,
      { title: 'Record a Take Review', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) =>
        asResult(
          (await handleNarrativeRecordTake(input, {
            dbPath: defaultDbPath(),
            tenantId: deps.tenantId ?? null,
          })) as unknown as Record<string, unknown>,
        ),
      ),
    );
  }

  // ---- Opt-in providers (T17 Codex images, T6 Higgsfield Soul-ID) ----
  //
  // Registered unconditionally so the tool is discoverable and can explain
  // itself. Each handler enforces its own flag and credential requirements and
  // fails with an actionable message -- a tool that is simply absent leaves the
  // user with nothing to read.
  {
    const t = getTool('media_image_codex');
    regIfAllowed(
      t.name,
      { title: 'Generate Image (Codex)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        // deps.tenantId being set is what marks a hosted, multi-tenant request;
        // the OAuth path is refused there.
        const result = await handleCodexImage(input, {
          isMultiTenant: deps.tenantId !== undefined,
        });
        return asResult(result as unknown as Record<string, unknown>);
      }),
    );
  }

  {
    const t = getTool('media_higgsfield_soul_id_train');
    regIfAllowed(
      t.name,
      { title: 'Train Soul-ID', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        // The runner is what makes this tool exist. Without it handleSoulIdTrain
        // throws every time, and it was never supplied from anywhere.
        const runner = higgsfieldCliRunnerIfEnabled();
        const result = await handleSoulIdTrain(input, {
          dbPath: defaultDbPath(),
          ...(runner ? { runner } : {}),
        });
        return asResult(result as unknown as Record<string, unknown>);
      }),
    );
  }

  {
    const t = getTool('media_higgsfield_soul_id_list');
    regIfAllowed(
      t.name,
      { title: 'List Soul-IDs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        // Same omission, quieter symptom: without a runner this reported the
        // local cache as if it were the whole answer, with no remote comparison.
        const runner = higgsfieldCliRunnerIfEnabled();
        const result = await handleSoulIdList(input, {
          dbPath: defaultDbPath(),
          ...(runner ? { runner } : {}),
        });
        return asResult(result as unknown as Record<string, unknown>);
      }),
    );
  }
}
