// media_higgsfield_marketing_studio — now over the CLI transport.
//
// Same correction as the Cinema Studio test next door: this mocked `fetch` and
// asserted `template` and `product_url` in the request body. Neither is a
// parameter of this product, and /higgsfield-ai/marketing-studio/standard
// answers 404 — a mocked fetch confirms any body you hand it.
//
// Marketing Studio is Higgsfield's UGC ad suite and resolves on the CLI as job
// type `marketing_studio_video`. It takes a mode (default 'ugc'), 9:16 by
// default, and IDS resolved from the account: avatars, hooks, settings,
// products. The seam is the CLI runner and the assertions are about argv.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldMarketingStudio } from '../../src/mcp/handlers.js';
import { HiggsfieldCliProvider } from '../../src/video/providers/higgsfield-cli.js';
import {
  _resetHiggsfieldCliProviderForTests,
  _setHiggsfieldCliProviderForTests,
} from '../../src/mcp/handlers/shared.js';

let calls: string[][] = [];

function fakeProvider(dbPath: string): HiggsfieldCliProvider {
  return new HiggsfieldCliProvider({
    dbPath,
    runner: async (args) => {
      calls.push([...args]);
      const [group, verb] = args;
      if (group === 'auth') return { stdout: '{"token":"t"}', stderr: '', exitCode: 0 };
      if (group === 'generate' && verb === 'cost') {
        return { stdout: '{"credits": 75}', stderr: '', exitCode: 0 };
      }
      if (group === 'generate' && verb === 'create') {
        return { stdout: '{"id":"cli-job-ms"}', stderr: '', exitCode: 0 };
      }
      return { stdout: '{}', stderr: '', exitCode: 0 };
    },
  });
}

describe('media_higgsfield_marketing_studio handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;
  let prevRate: string | undefined;

  beforeEach(() => {
    calls = [];
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-ms-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    prevRate = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.048333';
    const db = openDb(dbPath);
    runMigrations(db);
    _setHiggsfieldCliProviderForTests(fakeProvider(dbPath));
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    _resetHiggsfieldCliProviderForTests();
    if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
    if (prevRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevRate;
  });

  it('submits the real job type with account-resolved ids', async () => {
    const result = await handleHiggsfieldMarketingStudio({
      prompt: 'sneaker unboxing, handheld',
      avatarIds: ['672be390-36ab-4d79-bb95-ff562a57c79c'],
      hookId: '3d45fb46-254f-4c83-9685-8e3d28945a67',
      settingId: 'b8368076-35eb-4045-b33b-74b2646d9863',
      durationSec: 15,
      resolution: '720p',
    });

    expect(result.provider).toBe('higgsfield-cli');

    const create = calls.find((c) => c[0] === 'generate' && c[1] === 'create');
    expect(create![2]).toBe('marketing_studio_video');
    expect(create).toEqual(
      expect.arrayContaining(['--avatar_ids', '["672be390-36ab-4d79-bb95-ff562a57c79c"]']),
    );
    expect(create).toEqual(
      expect.arrayContaining(['--hook_id', '3d45fb46-254f-4c83-9685-8e3d28945a67']),
    );
    expect(create).toEqual(expect.arrayContaining(['--mode', 'ugc']));
    // 9:16 is the platform's default for this job type, not a value we invented.
    expect(create).toEqual(expect.arrayContaining(['--aspect-ratio', '9:16']));
  });

  // Two array shapes exist and they are OPPOSITE. Measured against the binary:
  //
  //   --avatar_ids '["a1","a2"]'                 ok
  //   --avatar_ids a1 --avatar_ids a2            Invalid types: avatar_ids
  //                                              should be array, got string
  //   --image-references a1 --image-references a2   ok
  //   --image-references '["a1"]'                Media "[...]" is neither a UUID
  //                                              nor an existing file path
  //
  // The first version of this test asserted repetition for avatar_ids and
  // passed, because a fake runner accepts any argv. `fetchCostCredits` against
  // the real CLI is what caught it — same argv builder, so a malformed flag
  // surfaces as a rejection rather than a wrong number.
  it('sends a typed array param as JSON, in one flag', async () => {
    await handleHiggsfieldMarketingStudio({
      prompt: 'two avatars',
      avatarIds: ['a1', 'a2'],
      durationSec: 15,
      resolution: '720p',
    });
    const create = calls.find((c) => c[0] === 'generate' && c[1] === 'create')!;
    expect(create.filter((a) => a === '--avatar_ids'), 'one flag, not one per id').toHaveLength(1);
    expect(create[create.indexOf('--avatar_ids') + 1]).toBe('["a1","a2"]');
  });

  it('still repeats media flags, which take a UUID or a path each', async () => {
    await handleHiggsfieldMarketingStudio({
      prompt: 'two refs',
      imageReferencePaths: ['./a.png', './b.png'],
      durationSec: 15,
      resolution: '720p',
    });
    const create = calls.find((c) => c[0] === 'generate' && c[1] === 'create')!;
    expect(create.filter((a) => a === '--image-references')).toHaveLength(2);
    expect(create.join(' '), 'a JSON array here reads as a filename').not.toContain('["./a.png"');
  });

  // Both rules below are the platform's own, read from `model get`.rules as CEL.
  // Enforcing them locally means the CLI is not spent to learn them.
  it('refuses ad_reference_id combined with hook_id', async () => {
    await expect(
      handleHiggsfieldMarketingStudio({
        prompt: 'x',
        adReferenceId: 'ad-1',
        hookId: 'hook-1',
        durationSec: 15,
        resolution: '720p',
      }),
    ).rejects.toThrow(/ad_reference_id cannot be combined/);
  });

  it('refuses product_ids and web_product_ids together', async () => {
    await expect(
      handleHiggsfieldMarketingStudio({
        prompt: 'x',
        productIds: ['p1'],
        webProductIds: ['w1'],
        durationSec: 15,
        resolution: '720p',
      }),
    ).rejects.toThrow(/cannot both be set/);
  });
});
