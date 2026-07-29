import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OutputStorageClient } from '../../output/storage.js';
import { safeJoin, jobId as generateJobId } from '../../utils/paths.js';
import { storeArtifact } from '../../output/output-storage.js';
import { ValidationError, CostGuardError, ApiError } from '../../core/errors.js';
import { evaluateCostGuard } from '../../core/cost-guard.js';
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
import type { GenerateVideoResult } from '../../video/video-service.js';
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
import { defaultDbPath, handleVideoWebhookStatus } from './shared.js';
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
} from './kling.js';
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
  prefix: string,
): Promise<unknown> {
  if (!storage || result.dryRun || !result.base64) {
    return result;
  }
  try {
    const id = generateJobId(prefix);
    const bytes = Buffer.from(result.base64, 'base64');
    const artifact = await storeArtifact({
      storage,
      jobId: id,
      bytes,
      contentType: result.mimeType,
    });
    return { ...result, job_id: id, url: artifact.url, expires_at: artifact.expiresAt };
  } catch (err) {
    // Best-effort: upload failure must not drop the generated image. Surface the
    // base64 result (F-A path) so the caller still receives the artifact.
    process.stderr.write(
      `[image-storage] upload failed (${prefix}): ${(err as Error).message}\n`,
    );
    return result;
  }
}

export function registerAllTools(server: McpServer, deps: HandlersDeps): void {
  const { client, config, storage } = deps;
  const reg = looseRegister(server);

  // F-C: tier gating — pula o registro de tools fora do gate do tier.
  // undefined/missing tier = 'pro' (backward compat para stdio + testes existentes).
  const effectiveTier = deps.tier ?? 'pro';
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
  // media-forge cost guards — evaluated BEFORE every image generation call and
  // (via KlingHandlerExecOpts.checkCostGuard / HiggsfieldHandlerExecOpts /
  // SeedanceHandlerExecOpts) before every Kling, Higgsfield, and Seedance
  // video submit, reading today's UTC spend across both video_jobs and image_jobs.
  //
  // Guard is SKIPPED under dry-run (client.dryRun) — a dry run never calls the
  // provider and costs $0, so both the guard check and the ledger write it
  // would otherwise produce (recordImageJob, in the 3 image call sites below)
  // are meaningless. Recording a $0-real-cost job as 'pending' at its
  // estimate would count phantom spend against the cap forever (nothing ever
  // captures a dry-run row) — the exact failure mode this task exists to fix,
  // just inverted. Kling has no dry-run path (provider.generate() always
  // hits the network), so no such gating is needed there.
  // ---------------------------------------------------------------------------
  function checkCostGuardOrThrow(estimateUsd: number): { costWarning?: string } {
    const spentTodayUsd = dailySpendUsd({ dbPath: defaultDbPath(), tenantId: deps.tenantId ?? 'default' });
    const decision = evaluateCostGuard({
      estimateUsd,
      spentTodayUsd,
      blockThresholdUsd: config.blockThresholdUsd,
      dailyCapUsd: config.dailyCapUsd,
      confirmThresholdUsd: config.confirmThresholdUsd,
    });
    if (decision.action === 'block') {
      const overBlock = estimateUsd > config.blockThresholdUsd;
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

  // Shared opts for every Kling / Higgsfield / Seedance submit handler
  // (media-forge cost guards, Step 3 + Step 4; extended to Higgsfield + Seedance
  // in T15 part B, 2026-07-29): checkCostGuard runs the same guard used by the
  // image tools above; preflightCredit narrows the reserve-after-submit credit
  // gap (see preflightVideoCredit's doc comment in billing.ts for the honesty
  // caveat). Both hooks run inside the handler, BEFORE provider.generate()
  // submits. Structurally identical to KlingHandlerExecOpts,
  // HiggsfieldHandlerExecOpts, and SeedanceHandlerExecOpts, so this one object
  // is accepted by all three providers' handler functions.
  const videoGuardOpts = {
    checkCostGuard: checkCostGuardOrThrow,
    preflightCredit: (estimateUsd: number) => preflightVideoCredit(deps, estimateUsd),
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
  ): Promise<T> {
    if (client.dryRun) return exec();
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
  // call. This is the opposite order from Kling's tools (submit, THEN
  // reserve, see the "F-E: reserve AFTER submit" comments below) — do not
  // collapse the two shapes, C8 exists specifically because reserve-after-
  // submit leaves a window where a submit that throws AFTER charging the
  // provider never got a matching reserve to release.
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
  // `client.dryRun` gate used by the image tools above (see
  // checkCostGuardOrThrow's doc comment). A dry run never reaches the
  // provider and costs $0, so there is nothing to guard, record, or reserve.
  // ---------------------------------------------------------------------------
  async function submitVeoWithLedger(
    mode: VideoMode,
    jobIdPrefix: string,
    paramsForHash: unknown,
    estimateUsd: number,
    exec: () => Promise<GenerateVideoResult>,
  ): Promise<GenerateVideoResult & { jobId?: string; costWarning?: string }> {
    if (client.dryRun) return exec();

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
        const parsed = validateInput<{ imageSize?: '1K' | '2K' | '4K' }>(t, input);
        const estimateUsd = estimateImageCost({
          model: IMAGE_MODEL_NANO_BANANA_PRO,
          imageSize: parsed.imageSize ?? '4K',
        }).usd;
        // Guard + ledger are skipped under dry-run — see checkCostGuardOrThrow's doc comment above.
        const guard: { costWarning?: string } = client.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('nano-banana-pro');
        // The debit (reserve+capture) is skipped under dry-run for the SAME reason
        // the guard and ledger are: a dry run never calls the provider, so there is
        // nothing real to bill. Uses the identical `client.dryRun` check as above —
        // not a second way of asking "is this a dry run".
        const genExec = () => generateImageNanoBananaPro(parsed as never, client);
        const result = await withImageLedger(jobId, IMAGE_MODEL_NANO_BANANA_PRO, parsed, estimateUsd, () =>
          client.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec),
        );
        const structured = await maybeStoreImageArtifact(result, storage, 'nano-banana-pro');
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
        const guard: { costWarning?: string } = client.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('imagen-4-ultra');
        // Same dry-run gate as media_generate_image above — reuses client.dryRun.
        const genExec = () => generateImageImagen4Ultra(input as never, client);
        const result = await withImageLedger(jobId, IMAGE_MODEL_IMAGEN_4_ULTRA, inp, estimateUsd, () =>
          client.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec),
        );
        const structured = await maybeStoreImageArtifact(result, storage, 'imagen-4-ultra');
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
        const guard: { costWarning?: string } = client.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('edit-image');
        // F-P1: media_edit_image generated without ever debiting — wire it through
        // withImageDebit exactly like media_generate_image/media_generate_imagen,
        // reusing the SAME estimate computed above (no second estimate). Skipped
        // under dry-run via the identical client.dryRun check used everywhere else.
        const genExec = () => editImage(parsed, client);
        const result = await withImageLedger(jobId, IMAGE_MODEL_NANO_BANANA_PRO, parsed, estimateUsd, () =>
          client.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec),
        );
        return asResult(
          guard.costWarning ? { ...(result as unknown as Record<string, unknown>), costWarning: guard.costWarning } : result,
        );
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
        const guard: { costWarning?: string } = client.dryRun ? {} : checkCostGuardOrThrow(estimateUsd);
        const jobId = generateJobId('compose-scene');
        const genExec = () => composeScene(parsed, client);
        const result = await withImageLedger(jobId, IMAGE_MODEL_NANO_BANANA_PRO, parsed, estimateUsd, () =>
          client.dryRun ? genExec() : withImageDebit(deps, jobId, estimateUsd, genExec),
        );
        return asResult(
          guard.costWarning
            ? { ...(result as unknown as Record<string, unknown>), costWarning: guard.costWarning }
            : result,
        );
      }),
    );
  }

  {
    const t = getTool('media_describe_image');
    regIfAllowed(
      t.name,
      { title: 'Describe Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await describeImage(input as never, client))),
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

  // ---- Video tools (7) ----

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
        const result = await submitVeoWithLedger('t2v', 'veo-t2v', parsed, estimateUsd, () =>
          generateVideoT2V(parsed, client),
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
        const result = await submitVeoWithLedger('i2v', 'veo-i2v', parsed, estimateUsd, () =>
          generateVideoI2V(parsed, client),
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
        const result = await submitVeoWithLedger('interpolate', 'veo-interpolate', parsed, estimateUsd, () =>
          generateVideoInterpolate(parsed, client),
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
        const result = await submitVeoWithLedger('with-refs', 'veo-with-refs', parsed, estimateUsd, () =>
          generateVideoWithRefs(parsed, client),
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

  // T15 part B (2026-07-29): guard + preflight now run INSIDE each of the 6
  // Higgsfield submit handlers below (DoP, Cinema Studio, Speak, Marketing
  // Studio, Recast, Generate) via HiggsfieldHandlerExecOpts — same
  // videoGuardOpts object already shared with Kling above. reserveVideoSubmit
  // + setJobTenant run here, AFTER each handler returns, keyed on the jobId
  // HiggsfieldProvider.generate() only records via recordJob on a successful
  // submit (higgsfield.ts:156) — i.e. the same reserve-AFTER-submit shape
  // Kling already used, not Veo's reserve-before-submit shape (Higgsfield's
  // row, like Kling's, never exists to reserve against until the platform
  // has accepted it).
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        // F-E: reserve AFTER submit, keyed on the returned jobId — the SAME id
        // media_kling_download captures with. No-op when billing off. 402 → wrap → tool error.
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
        await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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

  // T15 part B (2026-07-29): guard + preflight now run INSIDE each of the 4
  // Seedance submit handlers below via SeedanceHandlerExecOpts (same
  // videoGuardOpts object shared with Kling + Higgsfield above), and
  // reserveVideoSubmit + setJobTenant run here, AFTER each handler returns —
  // same reserve-AFTER-submit shape as Kling/Higgsfield, keyed on the jobId
  // BytedanceSeedanceProvider.generate() only records (via its
  // recordOnSuccess closure) once fal.ai/ARK accepts the submit.
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
  // reserveVideoSubmit below sets `statusUrl` from MEDIA_FORGE_INTERNAL_URL,
  // the row lands in video_jobs on submit success, src/http/job-status.ts
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
          await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
          await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
          await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
          await reserveVideoSubmit(deps, r.jobId, r.estimatedCostUSD);
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
}
