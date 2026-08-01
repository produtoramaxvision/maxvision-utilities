import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleVideoRoute } from '../../src/mcp/handlers.js';

describe('handleVideoRoute — P14 Higgsfield preference', () => {
  let tmpDir: string;
  let prev: string | undefined;

  let prevSeedance: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-route-p14-'));
    prev = process.env['MEDIA_FORGE_PROJECT_DIR'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    // Isolate P14 routing tests from Seedance — P16 absorbed `targeted-edit`
    // into Seedance image_to_video (A0.5), so without this gate the cheaper
    // Seedance model wins. These tests assert pre-Seedance Higgsfield routing.
    prevSeedance = process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = 'false';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prev;
    delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    if (prevSeedance === undefined) delete process.env['MEDIA_FORGE_SEEDANCE_ENABLED'];
    else process.env['MEDIA_FORGE_SEEDANCE_ENABLED'] = prevSeedance;
  });

  it('routes lip-sync to higgsfield (only provider that supports it)', async () => {
    const r = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'newsreader',
      durationSec: 15,
      resolution: '720p',
    });
    expect(r.provider).toBe('higgsfield');
  });

  // WAS: 'routes targeted-edit to higgsfield Recast'.
  //
  // It does not, and never did. `/higgsfield-ai/recast/standard` answers
  // `404 model_not_found` with and without the tier segment, and Recast is absent
  // from the CLI surface too (dubbing/voice_change are a different product). The
  // registry now carries that as `unavailable` and the router excludes it, so the
  // only honest outcome for targeted-edit with Seedance switched off is a refusal.
  //
  // Returning a route here was worse than refusing: the caller passed the cost
  // guard, reserved credit and got a 404 at submit.
  it('refuses targeted-edit when Seedance is off — Recast is a dead endpoint', async () => {
    await expect(
      handleVideoRoute({
        mode: 'targeted-edit',
        prompt: 'swap protagonist',
        durationSec: 10,
        resolution: '720p',
      }),
    ).rejects.toThrow(/no provider supports mode='targeted-edit'/);
  });

  it('keeps Veo for plain t2v with preferProvider=google (P15 Option A: pure cost sort; Kling V3 Standard at $0.126/s wins without override)', async () => {
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 8,
      resolution: '720p',
      preferProvider: 'google',
    });
    expect(r.provider).toBe('google');
  });

  // WAS: 'respects preferProvider override' — asserting higgsfield wins t2v.
  //
  // The only t2v specs the Higgsfield Cloud API ever had were the Soul family,
  // which is text2image, plus cinema-studio-3.5 and marketing-studio, which both
  // 404. Strip those and the surface has NO working t2v at all: what remains is
  // dop and dop-turbo (i2v, with-refs) and speak (lip-sync).
  //
  // So the override is still respected — it is respected by saying the provider
  // cannot do this, instead of handing back an image endpoint or a dead one.
  it('preferProvider=higgsfield refuses t2v — the Cloud API has no working t2v model', async () => {
    await expect(
      handleVideoRoute({
        mode: 't2v',
        prompt: 'a coastal cliff at sunset',
        durationSec: 8,
        resolution: '720p',
        preferProvider: 'higgsfield',
      }),
    ).rejects.toThrow(/preferProvider higgsfield has no model supporting mode t2v/);
  });

  it('preferProvider=higgsfield still routes i2v, which it genuinely serves', async () => {
    const r = await handleVideoRoute({
      mode: 'i2v',
      prompt: 'the subject turns toward camera',
      durationSec: 5,
      resolution: '720p',
      preferProvider: 'higgsfield',
    });
    expect(r.provider).toBe('higgsfield');
    expect(['higgsfield-dop', 'higgsfield-dop-turbo']).toContain(r.modelId);
  });
});
