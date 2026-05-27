import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleVideoRoute } from '../../src/mcp/handlers.js';

describe('handleVideoRoute — P14 Higgsfield preference', () => {
  let tmpDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-route-p14-'));
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  it('routes lip-sync to kling in P15 (explicit-tier override; Higgsfield still reachable via preferProvider)', async () => {
    // P14: Higgsfield was sole lip-sync provider. P15: kling-v3-pro joins with explicit-tier
    // override via pickExplicitTier — kling wins before cost sort.
    // Higgsfield lip-sync remains reachable via preferProvider: 'higgsfield'.
    const r = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'newsreader',
      durationSec: 15,
      resolution: '1080p',
    });
    expect(r.provider).toBe('kling');
  });

  it('routes targeted-edit to higgsfield Recast', async () => {
    const r = await handleVideoRoute({
      mode: 'targeted-edit',
      prompt: 'swap protagonist',
      durationSec: 10,
      resolution: '720p',
    });
    expect(r.provider).toBe('higgsfield');
    expect(r.modelId).toBe('higgsfield-recast');
  });

  it('routes to Veo when preferProvider forces google (P15 Option A: pure cost sort, no google default)', async () => {
    // P15 Option A removed the google-default tiebreaker. Without preferProvider, Higgsfield
    // Soul Standard ($0.975 for 8s at $0.039/credit) beats Veo ($4.00) on cost. Use
    // preferProvider: 'google' to verify Veo is still callable — regression preserved.
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 8,
      resolution: '720p',
      preferProvider: 'google',
    });
    expect(r.provider).toBe('google');
  });

  it('respects preferProvider override', async () => {
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a coastal cliff at sunset',
      durationSec: 8,
      resolution: '720p',
      preferProvider: 'higgsfield',
    });
    expect(r.provider).toBe('higgsfield');
  });
});
