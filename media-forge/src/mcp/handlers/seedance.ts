import {
  getBytedanceSeedanceProvider,
  type BytedanceSeedanceEnv,
} from '../../video/providers/bytedance-seedance.js';
import {
  SeedanceTextToVideoInput,
  type SeedanceTextToVideoInputT,
  SeedanceImageToVideoInput,
  type SeedanceImageToVideoInputT,
  SeedanceMultishotInput,
  type SeedanceMultishotInputT,
  SeedanceReferenceFusionInput,
  type SeedanceReferenceFusionInputT,
} from '../schemas.js';
import type { BytedanceSeedanceExtras } from '../../video/providers/base.js';
import { defaultDbPath } from './shared.js';

// ---------------------------------------------------------------------------
// Seedance 2.0 (ByteDance) handlers — P16 Task 7 (4 tools per A0.5)
// All four reuse the lazy singleton getBytedanceSeedanceProvider() — provider
// is stateful (in-memory routeByJobId + falConfigured flag) so per-call
// construction would lose webhook routing context. The singleton is bound at
// first-use to defaultDbPath()/process.env; tests override via the
// __resetBytedanceSeedanceSingleton() hook before each test runs.
// ---------------------------------------------------------------------------

interface SeedanceHandlerResult {
  jobId: string;
  provider: string;
  model: string;
  mode: string;
  estimatedCostUSD: number;
  providerNativeId?: string;
}

function seedanceProvider(): ReturnType<typeof getBytedanceSeedanceProvider> {
  return getBytedanceSeedanceProvider({
    dbPath: defaultDbPath(),
    env: process.env as unknown as BytedanceSeedanceEnv,
  });
}

function seedanceModelIdFor(tier: 'fast' | 'standard'): 'seedance-2.0-fast' | 'seedance-2.0-standard' {
  return tier === 'fast' ? 'seedance-2.0-fast' : 'seedance-2.0-standard';
}

/**
 * Resolve a duration suitable for cost estimation + the provider request. When
 * the caller leaves `durationSec` unset (default `'auto'` on fal.ai), we fall
 * back to 5s for cost preview — fal.ai's auto-mode typically lands in the 4-6s
 * range and the actual cost is recorded via pollStatus from the per-second
 * registry rate once the job completes.
 *
 * FIX (Codex P2 round 13, PR#12): also return whether the caller opted in to
 * fal.ai auto-mode so `buildFalInput` can omit `duration` from the payload.
 * The previous behavior coerced `undefined → 5` and then always sent
 * `duration: "5"` to fal, fixing the clip length even when the user wanted
 * auto-mode.
 */
function seedanceDurationOrDefault(
  durationSec: number | undefined,
): { value: number; isAuto: boolean } {
  return typeof durationSec === 'number'
    ? { value: durationSec, isAuto: false }
    : { value: 5, isAuto: true };
}

/**
 * The base `VideoGenerationRequest.resolution` union (`'720p'|'1080p'|'2k'|'4k'`)
 * predates Seedance — it does NOT yet include `'480p'`. Seedance providers
 * already accept the string at runtime (bytedance-seedance.ts internally casts
 * to `'480p'|'720p'|'1080p'`). Widening the base contract is deferred to a
 * separate base.ts refactor; for now we cast at the handler boundary. The
 * provider's `pickEndpoint` + `buildFalInput` already validate the runtime
 * value against per-mode capability.
 */
function castSeedanceResolution(r: '480p' | '720p' | '1080p'): '720p' | '1080p' | '2k' | '4k' {
  return r as unknown as '720p' | '1080p' | '2k' | '4k';
}

// ---- 1. handleSeedanceTextToVideo ----

export async function handleSeedanceTextToVideo(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceTextToVideoInputT = SeedanceTextToVideoInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  const duration = seedanceDurationOrDefault(input.durationSec);
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2, PR#12): propagate caller's generateAudio + endUserId.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    ...(duration.isAuto ? { durationAutoMode: true } : {}),
  };
  const req = {
    modelId,
    mode: 't2v' as const,
    prompt: input.prompt,
    durationSec: duration.value,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

// ---- 2. handleSeedanceImageToVideo (absorbs targeted_edit via endImageUrl) ----

export async function handleSeedanceImageToVideo(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceImageToVideoInputT = SeedanceImageToVideoInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  const duration = seedanceDurationOrDefault(input.durationSec);
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2, PR#12): propagate caller's generateAudio + endUserId.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    ...(duration.isAuto ? { durationAutoMode: true } : {}),
  };
  const req = {
    modelId,
    mode: 'i2v' as const,
    prompt: input.prompt,
    durationSec: duration.value,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    firstFrameImagePath: input.imageUrl,
    ...(input.endImageUrl !== undefined ? { lastFrameImagePath: input.endImageUrl } : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

// ---- 3. handleSeedanceMultishot ----

export async function handleSeedanceMultishot(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceMultishotInputT = SeedanceMultishotInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  // FIX (Codex P2 round 5, PR#12): use max(endSec) - min(startSec) for the
  // total elapsed duration instead of summing spans. Catches non-contiguous
  // shots + first shot starting > 0. Without this, cost estimation undershoots
  // and provider receives absolute timestamps inconsistent with reported
  // duration.
  const firstStart = Math.min(...input.shots.map((s) => s.startSec));
  if (firstStart !== 0) {
    throw new Error(
      `Seedance multishot: first shot must start at 0 (got ${firstStart}s). Shots must be contiguous and start from zero.`,
    );
  }
  const sortedShots = [...input.shots].sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < sortedShots.length; i++) {
    if (sortedShots[i]!.startSec !== sortedShots[i - 1]!.endSec) {
      throw new Error(
        `Seedance multishot: shots must be contiguous. Shot ${i} starts at ${sortedShots[i]!.startSec}s but previous shot ends at ${sortedShots[i - 1]!.endSec}s.`,
      );
    }
  }
  const durationSec = Math.max(...input.shots.map((s) => s.endSec));
  // FIX (Codex P2 round 6, PR#12): preserve chronological order in the
  // serialized prompt. Without this, `[5-10, 0-5]` passed contiguity (after
  // sorting) but the timestamp prompt emitted "Shot 1 starts at 5s, Shot 2
  // starts at 0s" — misdirecting Seedance instead of normalizing input.
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    multiShotTimestamps: sortedShots.map((s) => ({
      start: s.startSec,
      end: s.endSec,
      prompt: s.shotPrompt,
    })),
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2 round 2, PR#12): propagate audio + user options for multishot too.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
  };
  const req = {
    modelId,
    mode: 'multi-shot' as const,
    prompt: input.prompt,
    durationSec,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}

// ---- 4. handleSeedanceReferenceFusion ----

export async function handleSeedanceReferenceFusion(
  rawInput: unknown,
): Promise<SeedanceHandlerResult> {
  const input: SeedanceReferenceFusionInputT = SeedanceReferenceFusionInput.parse(rawInput);
  const provider = seedanceProvider();
  const modelId = seedanceModelIdFor(input.modelTier);
  const duration = seedanceDurationOrDefault(input.durationSec);
  const extras: BytedanceSeedanceExtras = {
    providerKind: 'bytedance',
    functionMode: 'omni_reference',
    ...(input.imageUrls.length > 0 ? { referenceImageUrls: input.imageUrls } : {}),
    ...(input.videoUrls.length > 0 ? { referenceVideoUrls: input.videoUrls } : {}),
    ...(input.audioUrls.length > 0 ? { referenceAudioUrls: input.audioUrls } : {}),
    ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
    // FIX (Codex P2 round 2, PR#12): propagate audio + user options for reference_fusion too.
    ...(typeof input.generateAudio === 'boolean' ? { generateAudio: input.generateAudio } : {}),
    ...(input.endUserId ? { endUserId: input.endUserId } : {}),
    ...(duration.isAuto ? { durationAutoMode: true } : {}),
  };
  const req = {
    modelId,
    mode: 'with-refs' as const,
    prompt: input.prompt,
    durationSec: duration.value,
    resolution: castSeedanceResolution(input.resolution),
    ...(input.aspectRatio !== 'auto'
      ? { aspectRatio: input.aspectRatio as '16:9' | '9:16' | '1:1' | '21:9' | '4:3' | '3:4' }
      : {}),
    extras,
  };
  const handle = await provider.generate(req);
  const result: SeedanceHandlerResult = {
    jobId: handle.jobId,
    provider: handle.provider,
    model: handle.model,
    mode: handle.mode,
    estimatedCostUSD: provider.estimateCostUSD(req),
  };
  if (handle.providerNativeId !== undefined) {
    result.providerNativeId = handle.providerNativeId;
  }
  return result;
}
