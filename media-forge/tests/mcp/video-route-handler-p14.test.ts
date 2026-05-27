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

  it('routes lip-sync to higgsfield (only provider that supports it)', async () => {
    const r = await handleVideoRoute({
      mode: 'lip-sync',
      prompt: 'newsreader',
      durationSec: 15,
      resolution: '720p',
    });
    expect(r.provider).toBe('higgsfield');
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

  it('keeps Veo for plain t2v when no Higgsfield-specific signals present', async () => {
    const r = await handleVideoRoute({
      mode: 't2v',
      prompt: 'a quiet lake at sunrise',
      durationSec: 8,
      resolution: '720p',
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
