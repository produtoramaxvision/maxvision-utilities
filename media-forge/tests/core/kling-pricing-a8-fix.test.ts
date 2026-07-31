// A8 — Kling rates fixed against the official kling.ai/dev/pricing page (read live
// 2026-07-30). The critical case: kling-v3-master was a PLACEHOLDER 0.18/s (4K-only),
// under-estimating the official $0.42/s by 133%. That suppressed the $2.00
// blockThresholdUsd hard block, under-counted the daily cap, and under-reserved
// credits for every 4K Kling call. This file proves the fix through the real
// production paths (KlingProvider.estimateCostUSD + evaluateCostGuard), not by
// re-deriving rate * durationSec by hand.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KlingProvider } from '../../src/video/providers/kling.js';
import { closeDb } from '../../src/core/db.js';
import { evaluateCostGuard } from '../../src/core/cost-guard.js';
import { VIDEO_MODELS, PRICING_OVERRIDES } from '../../src/core/models.js';

describe('A8 — Kling model registry rates fixed against kling.ai/dev/pricing (2026-07-30)', () => {
  let tmpDir: string;
  let dbPath: string;
  let provider: KlingProvider;
  const env = {
    KLING_ACCESS_KEY: 'ak_test',
    KLING_SECRET_KEY: 'sk_test',
  } as const;

  beforeEach(() => {
    // Guard against a polluted override map leaking a stale rate into this suite.
    expect(PRICING_OVERRIDES.has('kling-v3-master')).toBe(false);
    expect(PRICING_OVERRIDES.has('kling-v3-standard')).toBe(false);
    expect(PRICING_OVERRIDES.has('kling-v3-omni')).toBe(false);

    tmpDir = mkdtempSync(join(tmpdir(), 'mf-kling-a8-'));
    dbPath = join(tmpDir, 'cost.db');
    provider = new KlingProvider({ dbPath, env, fetchImpl: vi.fn() });
  });

  afterEach(() => {
    try {
      closeDb(dbPath);
    } catch {
      /* ignore — handle may already be closed */
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* Windows EPERM straggler on tempdir removal; ignore */
    }
    vi.restoreAllMocks();
  });

  describe('kling-v3-master — the money bug (4K, was PLACEHOLDER 0.18, official $0.42/s)', () => {
    it('registry rate is 0.42/s, fixed-public-rate, updated 2026-07-30', () => {
      const spec = VIDEO_MODELS['kling-v3-master'];
      expect(spec.pricing.rate).toBeCloseTo(0.42, 4);
      expect(spec.pricing.source).toBe('fixed-public-rate');
      expect(spec.pricing.updatedAt).toBe('2026-07-30');
    });

    it('KlingProvider.estimateCostUSD (the real production estimate path) reports $4.20 for a 10s 4K clip', () => {
      const usd = provider.estimateCostUSD({
        modelId: 'kling-v3-master',
        mode: 't2v',
        prompt: 'minimal 4K test',
        durationSec: 10,
        resolution: '4k',
      });
      expect(usd).toBeCloseTo(4.2, 4);
    });

    it('a 10s 4K Kling clip now trips the $2.00 blockThresholdUsd via the real evaluateCostGuard (bug suppressed this)', () => {
      const estimateUsd = provider.estimateCostUSD({
        modelId: 'kling-v3-master',
        mode: 't2v',
        prompt: 'minimal 4K test',
        durationSec: 10,
        resolution: '4k',
      });
      expect(estimateUsd).toBeCloseTo(4.2, 4);

      const decision = evaluateCostGuard({
        estimateUsd,
        spentTodayUsd: 0,
        blockThresholdUsd: 2.0, // MEDIA_FORGE_BLOCK_THRESHOLD_USD default
        dailyCapUsd: 25,
        confirmThresholdUsd: 0.5,
      });

      expect(decision.action).toBe('block');
      if (decision.action === 'block') {
        expect(decision.reason).toContain('4.20');
        expect(decision.reason).toContain('MEDIA_FORGE_BLOCK_THRESHOLD_USD');
      }

      // Under the old 0.18 PLACEHOLDER, the same call would have estimated $1.80 —
      // under the $2.00 block threshold — and the hard block would never have fired.
      const oldBuggyEstimate = 0.18 * 10;
      expect(oldBuggyEstimate).toBeCloseTo(1.8, 4);
      expect(
        evaluateCostGuard({
          estimateUsd: oldBuggyEstimate,
          spentTodayUsd: 0,
          blockThresholdUsd: 2.0,
          dailyCapUsd: 25,
          confirmThresholdUsd: 0.5,
        }).action,
      ).not.toBe('block');
    });
  });

  describe('kling-v3-standard — resolution-aware rate ($0.126/s @ 720p, $0.168/s @ 1080p)', () => {
    it('registry base rate is $0.126/s at 720p (resolutionMultipliers 720p = 1.0)', () => {
      const spec = VIDEO_MODELS['kling-v3-standard'];
      const multiplier = spec.pricing.resolutionMultipliers?.['720p'] ?? 1;
      expect(spec.pricing.rate * multiplier).toBeCloseTo(0.126, 4);
    });

    it('registry rate at 1080p (rate * resolutionMultipliers.1080p) is $0.168/s', () => {
      const spec = VIDEO_MODELS['kling-v3-standard'];
      const multiplier = spec.pricing.resolutionMultipliers?.['1080p'];
      expect(multiplier).toBeDefined();
      expect(spec.pricing.rate * (multiplier ?? 1)).toBeCloseTo(0.168, 4);
    });

    it('KlingProvider.estimateCostUSD(720p, 5s) = 0.126 * 5 = 0.63 (unaffected — flat rate at baseline)', () => {
      const usd = provider.estimateCostUSD({
        modelId: 'kling-v3-standard',
        mode: 't2v',
        prompt: 'test',
        durationSec: 5,
        resolution: '720p',
      });
      expect(usd).toBeCloseTo(0.63, 4);
    });
  });

  describe('kling-v3-pro — verified, unchanged rate ($0.168/s @ 1080p)', () => {
    it('registry rate is still $0.168/s, now verified (fixed-public-rate, updated 2026-07-30)', () => {
      const spec = VIDEO_MODELS['kling-v3-pro'];
      expect(spec.pricing.rate).toBeCloseTo(0.168, 4);
      expect(spec.pricing.source).toBe('fixed-public-rate');
      expect(spec.pricing.updatedAt).toBe('2026-07-30');
    });

    it('the pre-existing "2k" resolution entry is left untouched', () => {
      const spec = VIDEO_MODELS['kling-v3-pro'];
      expect(spec.resolutions).toEqual(expect.arrayContaining(['1080p', '2k']));
    });
  });

  describe('kling-v3-omni — resolved to $0.14/s (No Video Input x With Native Audio @ 1080p)', () => {
    it('registry rate is $0.14/s, fixed-public-rate, updated 2026-07-30', () => {
      const spec = VIDEO_MODELS['kling-v3-omni'];
      expect(spec.pricing.rate).toBeCloseTo(0.14, 4);
      expect(spec.pricing.source).toBe('fixed-public-rate');
      expect(spec.pricing.updatedAt).toBe('2026-07-30');
    });

    it('the entry has no video-input capability, consistent with the "No Video Input" row chosen', () => {
      const spec = VIDEO_MODELS['kling-v3-omni'];
      expect(spec.audioNative).toBe(true);
      // i2v = image-to-video (an image ref), not a video reference; no v2v/with-refs mode.
      expect(spec.modes).not.toContain('with-refs');
      expect(spec.limits?.maxVideoRefs).toBeUndefined();
    });
  });

  describe('every touched Kling entry is verified and no longer volatile PLACEHOLDER text', () => {
    const touchedIds = ['kling-v3-standard', 'kling-v3-pro', 'kling-v3-master', 'kling-v3-omni'] as const;

    it('every touched entry has updatedAt 2026-07-30', () => {
      for (const id of touchedIds) {
        expect(VIDEO_MODELS[id].pricing.updatedAt).toBe('2026-07-30');
      }
    });

    it('no Kling entry notes field still carries the word PLACEHOLDER', () => {
      for (const id of touchedIds) {
        const notes = VIDEO_MODELS[id].pricing.notes ?? '';
        expect(notes).not.toMatch(/PLACEHOLDER/);
      }
    });
  });
});
