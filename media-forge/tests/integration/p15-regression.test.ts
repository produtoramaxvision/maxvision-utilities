/**
 * P15 regression suite — Kling 3.0 integration end-to-end (no live API calls).
 *
 * Uses MCP_TOOLS (schema registry) instead of buildServer() introspection to
 * avoid the Google credential requirement at server construction time.
 * Cost estimates are validated via handleVideoRoute (which returns estimatedCostUSD
 * for all providers including Kling) because handleVideoCostEstimate still has a
 * P13-era guard that only accepts google/Veo models.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleVideoRoute,
  handleKlingMotionBrush,
  handleKlingElements,
  handleKlingLipSync,
  handleKlingOmniMultiShot,
  handleKlingVideoExtend,
} from '../../src/mcp/handlers.js';
import { MCP_TOOLS } from '../../src/mcp/schemas.js';
import { closeDb } from '../../src/core/db.js';

describe('P15 regression — Kling integration end-to-end', () => {
  let tmpDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-p15-reg-'));
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
  });

  afterEach(() => {
    // Close SQLite handle before deleting tmpDir — prevents EPERM on Windows.
    closeDb(join(tmpDir, 'cost.db'));
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('all 8 new Kling MCP tools are registered in MCP_TOOLS schema', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'media_kling_motion_brush',
        'media_kling_element_create',
        'media_kling_element_list',
        'media_kling_element_delete',
        'media_kling_elements',
        'media_kling_lip_sync',
        'media_kling_omni_multishot',
        'media_kling_video_extend',
      ]),
    );
  });

  it('P13 + P14 tools still registered in MCP_TOOLS (no regression)', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'media_video_route',
        'media_video_cost_estimate',
        'media_video_cost_report',
        'media_video_webhook_status',
        'media_higgsfield_soul_id',
        'media_higgsfield_dop',
        'media_higgsfield_cinema_studio',
        'media_higgsfield_speak',
        'media_higgsfield_marketing_studio',
        'media_higgsfield_recast',
        'media_higgsfield_virality_predictor',
      ]),
    );
  });

  it('all 5 core Kling handlers are exported from handlers.ts', () => {
    expect(typeof handleKlingMotionBrush).toBe('function');
    expect(typeof handleKlingElements).toBe('function');
    expect(typeof handleKlingLipSync).toBe('function');
    expect(typeof handleKlingOmniMultiShot).toBe('function');
    expect(typeof handleKlingVideoExtend).toBe('function');
  });

  it('media_video_route picks kling-v3-standard for cost-sensitive t2v (Kling wins on cost vs Veo)', async () => {
    // P15 Option A: google-default tiebreaker removed. Kling V3 Standard at $0.126/s
    // is significantly cheaper than Veo at $0.50/s, so Kling wins plain t2v cost sort.
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 4,
      resolution: '720p',
    });
    expect(r.provider).toBe('kling');
    expect(r.modelId).toBe('kling-v3-standard');
    expect(r.estimatedCostUSD).toBeGreaterThan(0);
  });

  it('media_video_route picks the correct Kling tier for each capability', async () => {
    // lip-sync → kling-v3-pro (explicit tier override)
    const lipSync = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'x',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(lipSync.provider).toBe('kling');
    expect(lipSync.modelId).toBe('kling-v3-pro');
    expect(lipSync.estimatedCostUSD).toBeGreaterThan(0);

    // 4k → kling-v3-master (explicit tier override)
    const master = await handleVideoRoute({
      mode: 't2v',
      prompt: 'x',
      durationSec: 5,
      resolution: '4k',
    });
    expect(master.provider).toBe('kling');
    expect(master.modelId).toBe('kling-v3-master');
    expect(master.estimatedCostUSD).toBeGreaterThan(0);

    // multi-shot → kling-v3-omni (explicit tier override)
    const omni = await handleVideoRoute({
      mode: 'multi-shot',
      prompt: 'x',
      durationSec: 5,
      resolution: '1080p',
    });
    expect(omni.provider).toBe('kling');
    expect(omni.modelId).toBe('kling-v3-omni');
    expect(omni.estimatedCostUSD).toBeGreaterThan(0);
  });
});
