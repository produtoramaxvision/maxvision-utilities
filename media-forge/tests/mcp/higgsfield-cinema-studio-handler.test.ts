// media_higgsfield_cinema_studio — now over the CLI transport.
//
// This file used to mock `fetch` and assert five body fields:
// focal_length_mm, aperture_fstop, sensor_size, color_grading, lens_id. It
// passed for years and proved nothing, because the endpoint it was mocking
// (/higgsfield-ai/cinema-studio/3.5) answers 404 model_not_found and none of
// those five field names exists on any Higgsfield endpoint. A mocked fetch will
// happily confirm whatever body you build.
//
// The product is real; it lives on the CLI surface as job type
// `cinematic_studio_video_3_5`. The seam is therefore the CLI RUNNER, not fetch,
// and the assertions are about argv — which is what actually reaches the
// platform. The enums come from `higgsfield model get`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { handleHiggsfieldCinemaStudio } from '../../src/mcp/handlers.js';
import { HiggsfieldCliProvider } from '../../src/video/providers/higgsfield-cli.js';
import {
  _resetHiggsfieldCliProviderForTests,
  _setHiggsfieldCliProviderForTests,
} from '../../src/mcp/handlers/shared.js';

/** argv of every CLI invocation made during a test. */
let calls: string[][] = [];

function fakeRunner(dbPath: string): HiggsfieldCliProvider {
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
        return { stdout: '{"id":"cli-job-1"}', stderr: '', exitCode: 0 };
      }
      return { stdout: '{}', stderr: '', exitCode: 0 };
    },
  });
}

describe('media_higgsfield_cinema_studio handler', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevProjectDir: string | undefined;
  let prevRate: string | undefined;

  beforeEach(() => {
    calls = [];
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-hf-cs-'));
    dbPath = join(tmpDir, 'cost.db');
    prevProjectDir = process.env['MEDIA_FORGE_PROJECT_DIR'];
    prevRate = process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'];
    process.env['MEDIA_FORGE_PROJECT_DIR'] = tmpDir;
    // This handler submits through the CLI transport, so the rate that applies
    // is the SUBSCRIPTION one. It used to be written into the API variable
    // because only one existed — 0.048333 in a variable documented as the
    // Cloud API top-up rate was the bug in miniature.
    process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'] = '0.048333';
    const db = openDb(dbPath);
    runMigrations(db);
    // The seam is the CLI runner, so the whole provider is constructed with it.
    _setHiggsfieldCliProviderForTests(fakeRunner(dbPath));
  });

  afterEach(() => {
    closeDb(dbPath);
    rmSync(tmpDir, { recursive: true, force: true });
    _resetHiggsfieldCliProviderForTests();
    if (prevProjectDir === undefined) delete process.env['MEDIA_FORGE_PROJECT_DIR'];
    else process.env['MEDIA_FORGE_PROJECT_DIR'] = prevProjectDir;
    if (prevRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_CLI_USD_PER_CREDIT'] = prevRate;
  });

  it('submits the real job type with the platform’s own creative presets', async () => {
    const result = await handleHiggsfieldCinemaStudio({
      prompt: 'noir interrogation',
      durationSec: 15,
      resolution: '1080p',
      cameraStyle: 'intimate_observer',
      colorGrading: 'classic_bw',
      lightScheme: 'contre_jour',
      genre: 'noir',
      generateAudio: true,
    });

    expect(result.provider).toBe('higgsfield-cli');

    const create = calls.find((c) => c[0] === 'generate' && c[1] === 'create');
    expect(create, 'no `generate create` was issued').toBeDefined();
    expect(create![2], 'argv[2] must be the CLI job type').toBe('cinematic_studio_video_3_5');
    expect(create).toEqual(expect.arrayContaining(['--camera_style', 'intimate_observer']));
    expect(create).toEqual(expect.arrayContaining(['--color_grading', 'classic_bw']));
    expect(create).toEqual(expect.arrayContaining(['--light_scheme', 'contre_jour']));
    expect(create).toEqual(expect.arrayContaining(['--genre', 'noir']));
    expect(create).toEqual(expect.arrayContaining(['--resolution', '1080p']));
    expect(create).toEqual(expect.arrayContaining(['--duration', '15']));
  });

  it('prices from `generate cost` before submitting, never from a local table', async () => {
    await handleHiggsfieldCinemaStudio({
      prompt: 'x',
      durationSec: 15,
      resolution: '720p',
    });
    const costIdx = calls.findIndex((c) => c[0] === 'generate' && c[1] === 'cost');
    const createIdx = calls.findIndex((c) => c[0] === 'generate' && c[1] === 'create');
    expect(costIdx, 'no cost estimate was requested').toBeGreaterThanOrEqual(0);
    expect(costIdx, 'the price must be known BEFORE the submit').toBeLessThan(createIdx);
  });

  it('rejects a colour grade the platform does not offer', async () => {
    // 'noir' is a GENRE here, not a colour grade — the old free-form string field
    // accepted anything and the platform silently ignored it.
    await expect(
      handleHiggsfieldCinemaStudio({
        prompt: 'x',
        durationSec: 15,
        resolution: '720p',
        colorGrading: 'kodak-portra-emulation',
      }),
    ).rejects.toThrow(/colorGrading/);
  });

  it('rejects a duration above the conservative cap', async () => {
    await expect(
      handleHiggsfieldCinemaStudio({ prompt: 'x', durationSec: 30, resolution: '720p' }),
    ).rejects.toThrow();
  });
});
