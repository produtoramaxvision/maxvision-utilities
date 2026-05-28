/**
 * P16 regression suite — Seedance 2.0 integration, ALL unit-level (no live API calls).
 *
 * Covers:
 *   1. Model registry: Fast + Standard registered; Pro absent.
 *   2. Model spec shape: provider=bytedance, pricing.unit=per-second, audioNative=true.
 *   3. PROVIDERS includes bytedance; ADAPTED_PROVIDERS (feature flag default-on) includes bytedance.
 *   4. 4 Seedance MCP tools are registered when MEDIA_FORGE_SEEDANCE_ENABLED is unset.
 *   5. video-router: cost-bottom-tier "targeted-edit" routes to seedance-2.0-fast (cheapest
 *      per-second provider for that mode with no Higgsfield USD-per-credit env set).
 *   6. video-router: preferProvider='kling' on t2v → kling wins (tiebreaker honored).
 *   7. Schema: rejects 1080p with Fast tier.
 *   8. Schema: rejects multishot with sum(durations) > 15s.
 *   9. Schema: rejects reference_fusion with zero refs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { VIDEO_MODELS, PROVIDERS } from '../../src/core/models.js';
import { isSeedanceEnabled } from '../../src/core/feature-flags.js';
import { MCP_TOOLS } from '../../src/mcp/schemas.js';
import {
  SeedanceTextToVideoInput,
  SeedanceMultishotInput,
  SeedanceReferenceFusionInput,
} from '../../src/mcp/schemas.js';
import { handleVideoRoute } from '../../src/mcp/handlers.js';
import { closeDb } from '../../src/core/db.js';

describe('P16 regression — Seedance 2.0 wired into registry, router, and schema', () => {
  let tmpDir: string;
  let prev: string | undefined;
  let prevSeedanceFlag: string | undefined;
  let prevHiggsfieldRate: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-p16-reg-'));
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    prevSeedanceFlag = process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    prevHiggsfieldRate = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    // Ensure Seedance is enabled (default, but explicit for clarity)
    delete process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    // Do NOT set MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT so Higgsfield costs Infinity → can't win cost sort
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  afterEach(() => {
    closeDb(join(tmpDir, 'cost.db'));
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    if (prevSeedanceFlag === undefined) delete process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    else process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = prevSeedanceFlag;
    if (prevHiggsfieldRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevHiggsfieldRate;
  });

  // ---------------------------------------------------------------------------
  // 1. Model registry: Fast + Standard registered; Pro ABSENT
  // ---------------------------------------------------------------------------
  it('registers seedance-2.0-fast and seedance-2.0-standard; seedance-2.0-pro is absent', () => {
    expect(VIDEO_MODELS['seedance-2.0-fast']).toBeDefined();
    expect(VIDEO_MODELS['seedance-2.0-standard']).toBeDefined();
    expect(VIDEO_MODELS['seedance-2.0-pro']).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 2. Model spec shape: provider=bytedance, pricing.unit=per-second, audioNative=true
  // ---------------------------------------------------------------------------
  it('both Seedance models declare provider=bytedance, pricing.unit=per-second, audioNative=true', () => {
    for (const modelId of ['seedance-2.0-fast', 'seedance-2.0-standard'] as const) {
      const spec = VIDEO_MODELS[modelId];
      expect(spec).toBeDefined();
      expect(spec!.provider).toBe('bytedance');
      expect(spec!.pricing.unit).toBe('per-second');
      expect(spec!.audioNative).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. PROVIDERS includes bytedance; ADAPTED_PROVIDERS (default-on flag) includes bytedance
  // ---------------------------------------------------------------------------
  it('PROVIDERS includes bytedance and isSeedanceEnabled() is true when env is unset', () => {
    expect(PROVIDERS).toContain('bytedance');
    // isSeedanceEnabled() reflects whether bytedance is in the adapted routing set
    expect(isSeedanceEnabled()).toBe(true);
  });

  it('isSeedanceEnabled() returns false when MEDIA_FORGE_SEEDANCE_ENABLED=false', () => {
    process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = 'false';
    expect(isSeedanceEnabled()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 4. 4 Seedance MCP tools registered when MEDIA_FORGE_SEEDANCE_ENABLED is unset
  // ---------------------------------------------------------------------------
  it('all 4 Seedance MCP tools are present in MCP_TOOLS when flag is unset', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'media_seedance_text_to_video',
        'media_seedance_image_to_video',
        'media_seedance_multishot',
        'media_seedance_reference_fusion',
      ]),
    );
  });

  // ---------------------------------------------------------------------------
  // 5. video-router: targeted-edit with no preferProvider → seedance-2.0-fast wins
  //    (Kling has no targeted-edit mode; Higgsfield-recast has credits-per-video but
  //     MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT is unset → Infinity cost → Seedance wins)
  // ---------------------------------------------------------------------------
  it('video-router: targeted-edit routes to seedance-2.0-fast (cheapest per-second provider)', async () => {
    const r = await handleVideoRoute({
      mode: 'targeted-edit',
      prompt: 'replace background with a sunset sky',
      durationSec: 5,
      resolution: '720p',
    });
    expect(r.provider).toBe('bytedance');
    expect(r.modelId).toBe('seedance-2.0-fast');
    expect(r.estimatedCostUSD).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 6. video-router: preferProvider='kling' on t2v → kling wins (tiebreaker honored)
  // ---------------------------------------------------------------------------
  it('video-router: preferProvider=kling on t2v → kling wins even though seedance is cheaper on per-second for short clips', async () => {
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'product showcase in a clean studio',
      durationSec: 5,
      resolution: '720p',
      preferProvider: 'kling',
    });
    expect(r.provider).toBe('kling');
  });

  // ---------------------------------------------------------------------------
  // 7. Schema: rejects 1080p with Fast tier
  // ---------------------------------------------------------------------------
  it('SeedanceTextToVideoInput rejects 1080p with modelTier=fast', () => {
    const result = SeedanceTextToVideoInput.safeParse({
      prompt: 'a glowing forest',
      modelTier: 'fast',
      resolution: '1080p',
    });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 8. Schema: rejects multishot with sum(durations) > 15s
  // ---------------------------------------------------------------------------
  it('SeedanceMultishotInput rejects shots whose total duration exceeds 15s', () => {
    const result = SeedanceMultishotInput.safeParse({
      prompt: 'urban montage',
      modelTier: 'standard',
      resolution: '720p',
      shots: [
        { startSec: 0, endSec: 8, shotPrompt: 'wide establishing shot' },
        { startSec: 8, endSec: 16, shotPrompt: 'close-up product reveal' }, // sum = 16s > 15s
      ],
    });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 9. Schema: rejects reference_fusion with zero refs
  // ---------------------------------------------------------------------------
  it('SeedanceReferenceFusionInput rejects payload with zero image/video/audio refs', () => {
    const result = SeedanceReferenceFusionInput.safeParse({
      prompt: 'fuse references into a scene',
      modelTier: 'standard',
      resolution: '720p',
      imageUrls: [],
      videoUrls: [],
      audioUrls: [],
    });
    expect(result.success).toBe(false);
  });
});
