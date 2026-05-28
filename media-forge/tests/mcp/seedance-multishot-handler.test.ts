/**
 * P16 Task 7 — media_seedance_multishot handler tests.
 *
 * Adapted to A0.1 (no Pro tier — Fast/Standard only) + A0.5 (4-tool surface).
 * Multi-shot is a T2V wrapper that structures shots[] into prompt-level
 * timestamp markers; endpoint dispatch = text-to-video.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const generate = vi.fn();
const estimateCostUSD = vi.fn();
const mockInstance = {
  generate,
  estimateCostUSD,
  pollStatus: vi.fn(),
  download: vi.fn(),
  recordActualCostUSD: vi.fn(),
  models: [],
  name: 'bytedance' as const,
};

vi.mock('../../src/video/providers/bytedance-seedance.js', () => ({
  BytedanceSeedanceProvider: vi.fn(() => mockInstance),
  getBytedanceSeedanceProvider: vi.fn(() => mockInstance),
  __resetBytedanceSeedanceSingleton: vi.fn(),
}));

import { handleSeedanceMultishot } from '../../src/mcp/handlers.js';

describe('media_seedance_multishot handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generate.mockResolvedValue({
      jobId: 'seedance-ms-1',
      provider: 'bytedance',
      model: 'seedance-2.0-standard',
      mode: 'multi-shot',
      createdAt: '2026-05-27T00:00:00.000Z',
      providerNativeId: 'fal-req-ms',
    });
    estimateCostUSD.mockReturnValue(3.024);
  });

  it('passes shots[] through to provider as extras.multiShotTimestamps with mapped keys', async () => {
    const result = await handleSeedanceMultishot({
      prompt: 'urban montage',
      modelTier: 'standard',
      resolution: '1080p',
      shots: [
        { startSec: 0, endSec: 5, shotPrompt: 'wide skyline' },
        { startSec: 5, endSec: 10, shotPrompt: 'close window' },
      ],
    });
    expect(result.jobId).toBe('seedance-ms-1');
    expect(result.mode).toBe('multi-shot');
    expect(result.estimatedCostUSD).toBeCloseTo(3.024, 4);
    const req = generate.mock.calls[0]![0];
    expect(req.mode).toBe('multi-shot');
    expect(req.modelId).toBe('seedance-2.0-standard');
    // duration = sum of shot spans = (5-0) + (10-5) = 10
    expect(req.durationSec).toBe(10);
    expect(req.extras.providerKind).toBe('bytedance');
    expect(req.extras.multiShotTimestamps).toEqual([
      { start: 0, end: 5, prompt: 'wide skyline' },
      { start: 5, end: 10, prompt: 'close window' },
    ]);
  });

  it('rejects when shots array is empty', async () => {
    await expect(
      handleSeedanceMultishot({
        prompt: 'x',
        resolution: '1080p',
        shots: [],
      }),
    ).rejects.toThrow();
  });

  it('rejects when a shot endSec <= startSec', async () => {
    await expect(
      handleSeedanceMultishot({
        prompt: 'x',
        resolution: '1080p',
        shots: [{ startSec: 5, endSec: 5, shotPrompt: 'bad' }],
      }),
    ).rejects.toThrow(/endSec must be greater than startSec/i);
  });

  it('rejects when sum(durations) > 15s (A0 hard cap)', async () => {
    await expect(
      handleSeedanceMultishot({
        prompt: 'too long',
        resolution: '720p',
        shots: [
          { startSec: 0, endSec: 8, shotPrompt: 'a' },
          { startSec: 8, endSec: 16, shotPrompt: 'b' },
        ],
      }),
    ).rejects.toThrow(/multi-shot total duration must <= 15s/i);
  });

  it('rejects when shots count > 4 (typical multi-shot cap)', async () => {
    await expect(
      handleSeedanceMultishot({
        prompt: 'too many',
        resolution: '720p',
        shots: [
          { startSec: 0, endSec: 1, shotPrompt: 'a' },
          { startSec: 1, endSec: 2, shotPrompt: 'b' },
          { startSec: 2, endSec: 3, shotPrompt: 'c' },
          { startSec: 3, endSec: 4, shotPrompt: 'd' },
          { startSec: 4, endSec: 5, shotPrompt: 'e' },
        ],
      }),
    ).rejects.toThrow(/max 4 shots/i);
  });

  it('rejects 1080p with modelTier=fast (A0.1 Fast caps at 720p)', async () => {
    await expect(
      handleSeedanceMultishot({
        prompt: 'x',
        modelTier: 'fast',
        resolution: '1080p',
        shots: [{ startSec: 0, endSec: 5, shotPrompt: 'a' }],
      }),
    ).rejects.toThrow(/1080p resolution requires modelTier=.*standard/);
  });

  it('uses fast model id when modelTier=fast', async () => {
    await handleSeedanceMultishot({
      prompt: 'x',
      modelTier: 'fast',
      resolution: '720p',
      shots: [{ startSec: 0, endSec: 5, shotPrompt: 'a' }],
    });
    const req = generate.mock.calls[0]![0];
    expect(req.modelId).toBe('seedance-2.0-fast');
  });

  it('serializes multiShotTimestamps in chronological order even when caller supplies them out of order (Codex P2 round 6)', async () => {
    // Regression: validation sorts before contiguity check, but the timestamp
    // serializer was using `input.shots` instead of `sortedShots`. Result was
    // a prompt advertising "Shot 1 starts at 5s, Shot 2 starts at 0s" which
    // misdirects Seedance instead of normalizing chronologically.
    await handleSeedanceMultishot({
      prompt: 'urban montage',
      modelTier: 'standard',
      resolution: '1080p',
      shots: [
        { startSec: 5, endSec: 10, shotPrompt: 'close window' }, // <-- 2nd chronologically
        { startSec: 0, endSec: 5, shotPrompt: 'wide skyline' }, // <-- 1st chronologically
      ],
    });
    const req = generate.mock.calls[0]![0];
    expect(req.extras.multiShotTimestamps).toEqual([
      { start: 0, end: 5, prompt: 'wide skyline' },
      { start: 5, end: 10, prompt: 'close window' },
    ]);
  });

  // -------------------------------------------------------------------------
  // Codex P2 round 11 — multishot durationSec must match fal.ai DurationEnum
  // -------------------------------------------------------------------------
  it('rejects when max(endSec) is below the fal enum floor of 4', async () => {
    // Shot timeline {0, 3} → durationSec=3 → fal would silently degrade to "auto"
    await expect(
      handleSeedanceMultishot({
        prompt: 'too short',
        resolution: '720p',
        shots: [{ startSec: 0, endSec: 3, shotPrompt: 'flash' }],
      }),
    ).rejects.toThrow(/DurationEnum|fal\.ai|integer max\(endSec\)/i);
  });

  it('rejects when max(endSec) is non-integer (e.g. 5.5s)', async () => {
    // fal enum only accepts whole integers — fractional totals are not in the enum.
    await expect(
      handleSeedanceMultishot({
        prompt: 'fractional',
        resolution: '720p',
        shots: [{ startSec: 0, endSec: 5.5, shotPrompt: 'fractional' }],
      }),
    ).rejects.toThrow(/DurationEnum|fal\.ai|integer max\(endSec\)/i);
  });

  it('accepts max(endSec)=4 (fal enum floor boundary)', async () => {
    await handleSeedanceMultishot({
      prompt: 'min total',
      resolution: '720p',
      shots: [{ startSec: 0, endSec: 4, shotPrompt: 'a' }],
    });
    expect(generate).toHaveBeenCalledOnce();
  });
});
