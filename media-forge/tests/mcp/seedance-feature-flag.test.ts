/**
 * tests/mcp/seedance-feature-flag.test.ts
 *
 * Task 8.5 — MEDIA_FORGE_SEEDANCE_ENABLED feature flag.
 *
 * Covers:
 *   1. isSeedanceEnabled() helper — parsing logic (default / false / true / edge cases)
 *   2. Runtime tool registration via buildServer() — 49 when enabled, 45 when disabled
 *   3. getAdaptedProviders() — 'bytedance' present/absent from routing set
 *
 * Each test restores process.env to its original state via finally blocks so
 * test isolation is complete even if an assertion throws.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isSeedanceEnabled } from '../../src/core/feature-flags.js';
import { buildServer } from '../../src/mcp/server.js';
import { handleVideoRoute } from '../../src/mcp/handlers.js';
import type { MediaForgeConfig } from '../../src/core/config.js';
import type { MediaForgeClient } from '../../src/core/client.js';

// ---------------------------------------------------------------------------
// Fakes — mirrors server-registration.test.ts
// ---------------------------------------------------------------------------

function makeFakeConfig(): MediaForgeConfig {
  return Object.freeze({
    apiKey: 'test-api-key',
    useVertex: false,
    project: undefined,
    location: 'us-central1',
    outputDir: './outputs',
    projectDir: './.media-forge',
    logLevel: 'error' as const,
    logFormat: 'json' as const,
    dryRun: false,
    pollIntervalMs: 10000,
    pollMaxAttempts: 90,
    runLiveTests: false,
    runEvals: false,
    dailyCapUsd: 25,
    confirmThresholdUsd: 0.5,
    blockThresholdUsd: 2.0,
    retryBudgetMultiplier: 3,
    showRetryBudget: true,
    ocrBackend: 'cloud-vision' as const,
    ocrGoogleVisionKey: undefined,
    reviewThreshold: 7.5,
    maxFixAttempts: 3,
    skipOcrWhenNoTextIntent: true,
    region: undefined,
  });
}

function makeFakeClient(): MediaForgeClient {
  return Object.freeze({
    mode: 'gemini' as const,
    dryRun: false,
    ai: {} as never,
  });
}

function listRegisteredToolNames(server: McpServer): string[] {
  const internal = server as unknown as { _registeredTools?: Record<string, unknown> };
  const tools = internal._registeredTools;
  if (!tools || typeof tools !== 'object') {
    throw new Error('McpServer._registeredTools is missing or not an object — SDK shape changed');
  }
  return Object.keys(tools);
}

// Snapshot + restore helper
function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

// ---------------------------------------------------------------------------
// Fixtures — ensure Higgsfield boot validation doesn't block tests
// ---------------------------------------------------------------------------

describe('MEDIA_FORGE_SEEDANCE_ENABLED feature flag', () => {
  let prevHiggsfield: string | undefined;

  beforeAll(() => {
    prevHiggsfield = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
  });

  afterAll(() => {
    if (prevHiggsfield === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevHiggsfield;
  });

  // -------------------------------------------------------------------------
  // Part 1: isSeedanceEnabled() parsing
  // -------------------------------------------------------------------------

  describe('isSeedanceEnabled() helper', () => {
    it('returns true when env var is unset (default-on)', () => {
      expect(isSeedanceEnabled({})).toBe(true);
    });

    it('returns true when env var is empty string', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: '' })).toBe(true);
    });

    it('returns true when env var is whitespace only', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: '   ' })).toBe(true);
    });

    it('returns true when env var is explicit "true"', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'true' })).toBe(true);
    });

    it('returns true when env var is "TRUE" (case-insensitive)', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'TRUE' })).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: '1' })).toBe(true);
    });

    it('returns false when env var is "false"', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'false' })).toBe(false);
    });

    it('returns false when env var is "FALSE" (case-insensitive)', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'FALSE' })).toBe(false);
    });

    it('returns false when env var is "0"', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: '0' })).toBe(false);
    });

    it('returns false when env var is "no"', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'no' })).toBe(false);
    });

    it('returns false when env var is "NO" (case-insensitive)', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'NO' })).toBe(false);
    });

    it('returns false when env var is "off"', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'off' })).toBe(false);
    });

    it('returns false when env var is "OFF" (case-insensitive)', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: 'OFF' })).toBe(false);
    });

    it('returns false when env var is " false " (with surrounding whitespace)', () => {
      expect(isSeedanceEnabled({ MEDIA_FORGE_SEEDANCE_ENABLED: ' false ' })).toBe(false);
    });

    it('reads process.env by default (live env check)', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', undefined, () => {
        // Unset → default-on
        expect(isSeedanceEnabled()).toBe(true);
      });

      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', 'false', () => {
        expect(isSeedanceEnabled()).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Part 2: Runtime tool registration via buildServer()
  // -------------------------------------------------------------------------

  describe('buildServer() — tool count', () => {
    it('registers 49 tools when flag is unset (default enabled)', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', undefined, () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).toHaveLength(54);
      });
    });

    it('registers 49 tools when flag is explicitly "true"', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', 'true', () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).toHaveLength(54);
      });
    });

    it('registers all 4 Seedance tools when flag is enabled', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', undefined, () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).toContain('media_seedance_text_to_video');
        expect(names).toContain('media_seedance_image_to_video');
        expect(names).toContain('media_seedance_multishot');
        expect(names).toContain('media_seedance_reference_fusion');
      });
    });

    it('registers 45 tools when MEDIA_FORGE_SEEDANCE_ENABLED=false', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', 'false', () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).toHaveLength(50);
      });
    });

    it('omits all 4 Seedance tools when MEDIA_FORGE_SEEDANCE_ENABLED=false', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', 'false', () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).not.toContain('media_seedance_text_to_video');
        expect(names).not.toContain('media_seedance_image_to_video');
        expect(names).not.toContain('media_seedance_multishot');
        expect(names).not.toContain('media_seedance_reference_fusion');
      });
    });

    it('registers 45 tools when MEDIA_FORGE_SEEDANCE_ENABLED=0 (alternative false value)', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', '0', () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).toHaveLength(50);
      });
    });

    it('registers 49 tools when MEDIA_FORGE_SEEDANCE_ENABLED is empty string (treated as enabled)', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', '', () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        expect(names).toHaveLength(54);
      });
    });

    it('non-Seedance tools remain registered when flag=false (no regression)', () => {
      withEnv('MEDIA_FORGE_SEEDANCE_ENABLED', 'false', () => {
        const server = buildServer({ config: makeFakeConfig(), client: makeFakeClient() });
        const names = listRegisteredToolNames(server);
        // Sample of non-Seedance tools that must always be present
        expect(names).toContain('media_generate_image');
        expect(names).toContain('media_video_route');
        expect(names).toContain('media_video_cost_estimate');
        expect(names).toContain('media_video_cost_report');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Part 3: Router / ADAPTED_PROVIDERS routing behavior
  // When flag=false, bytedance must NOT appear as selected provider.
  // When flag=true (default), bytedance IS reachable by the router.
  // Uses proper async beforeEach/afterEach (withEnv is sync-only, unsuitable here).
  // -------------------------------------------------------------------------

  describe('handleVideoRoute() — bytedance routing gated by flag', () => {
    let tmpDir: string;
    let prevProjectDir: string | undefined;
    let prevSeedanceFlag: string | undefined;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'mf-seedance-flag-route-'));
      prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
      prevSeedanceFlag = process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
      process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
      process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
      // Ensure flag is unset at test start (each test sets it explicitly below)
      delete process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
      if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
      else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
      if (prevSeedanceFlag === undefined) delete process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
      else process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = prevSeedanceFlag;
      delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    });

    it('routes targeted-edit to bytedance when flag is enabled (default)', async () => {
      // targeted-edit: seedance-2.0-fast ($0.2419/s × 10s = $2.42) beats
      // higgsfield-recast (80 credits × $0.039 = $3.12) on cost sort.
      // Flag is unset (default-on) from beforeEach.
      const r = await handleVideoRoute({
        mode: 'targeted-edit',
        prompt: 'swap protagonist costume',
        durationSec: 10,
        resolution: '720p',
      });
      expect(r.provider).toBe('bytedance');
    });

    it('excludes bytedance when MEDIA_FORGE_SEEDANCE_ENABLED=false — targeted-edit falls back to higgsfield', async () => {
      // With flag=false, bytedance is removed from getAdaptedProviders().
      // targeted-edit falls back to higgsfield-recast as the next-cheapest provider.
      process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = 'false';
      const r = await handleVideoRoute({
        mode: 'targeted-edit',
        prompt: 'swap protagonist costume',
        durationSec: 10,
        resolution: '720p',
      });
      expect(r.provider).not.toBe('bytedance');
    });

    it('excludes bytedance from targeted-edit routing when MEDIA_FORGE_SEEDANCE_ENABLED=false', async () => {
      // Same as "falls back to higgsfield" test — explicit alias for spec clarity.
      // targeted-edit: bytedance excluded → higgsfield-recast is next cheapest.
      process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = 'false';
      const r = await handleVideoRoute({
        mode: 'targeted-edit',
        prompt: 'replace background',
        durationSec: 10,
        resolution: '720p',
      });
      expect(r.provider).not.toBe('bytedance');
      // Higgsfield-recast is the fallback when Seedance is excluded
      expect(r.provider).toBe('higgsfield');
    });

    it('multi-shot mode routes away from bytedance when MEDIA_FORGE_SEEDANCE_ENABLED=false', async () => {
      // multi-shot: Seedance is the primary provider. With flag=false, router
      // may route to another provider or throw — neither should be bytedance.
      process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = 'false';
      let result: Awaited<ReturnType<typeof handleVideoRoute>> | undefined;
      let error: Error | undefined;
      try {
        result = await handleVideoRoute({
          mode: 'multi-shot',
          prompt: 'three-shot cinematic sequence',
          durationSec: 12,
          resolution: '720p',
        });
      } catch (e) {
        error = e as Error;
      }
      if (result !== undefined) {
        expect(result.provider).not.toBe('bytedance');
      } else {
        // Acceptable: no other provider supports multi-shot
        expect(error?.message).toMatch(/no provider supports mode/i);
      }
    });
  });
});
