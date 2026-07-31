// tests/mcp/optional-providers-handler.test.ts
//
// src/mcp/handlers/optional-providers.ts (T17 Codex image, T6 Soul-ID) shipped
// with zero test coverage — this file closes that gap.
//
// NEVER spawn a real process, never call the real `codex` or `higgsfield`
// binary, never touch the network: every provider/runner below is injected,
// mirroring tests/image/codex-image.test.ts (fake CliRunner style) and
// tests/mcp/higgsfield-soul-id-handler.test.ts (tmpdir + sqlite harness).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, runMigrations, closeDb } from '../../src/core/db.js';
import { createSoulId, listSoulIds } from '../../src/core/soul-id-cache.js';
import {
  handleCodexImage,
  codexImageMode,
  handleSoulIdTrain,
  handleSoulIdList,
  CodexImageInput,
  SoulIdTrainInput,
} from '../../src/mcp/handlers/optional-providers.js';
import {
  CodexImageProvider,
  CODEX_IMAGE_MODEL,
  type CliRunner as CodexCliRunner,
  type CliResult as CodexCliResult,
} from '../../src/image/codex-image.js';
import type {
  CliRunner as HfCliRunner,
  CliResult as HfCliResult,
} from '../../src/video/providers/higgsfield-cli.js';
import { SOUL_MIN_IMAGES, SOUL_MAX_IMAGES } from '../../src/video/providers/higgsfield-soul-cli.js';
import { ValidationError, ApiError } from '../../src/core/errors.js';

// ---------------------------------------------------------------------------
// shared fixtures
// ---------------------------------------------------------------------------

function okCodex(stdout: string): CodexCliResult {
  return { stdout, stderr: '', exitCode: 0 };
}

/** Queues one result per call to the fake Codex runner, in order. Never spawns anything real. */
function queueCodexRunner(steps: CodexCliResult[]): CodexCliRunner {
  let i = 0;
  return vi.fn(async () => {
    const step = steps[i++];
    if (step === undefined) throw new Error(`queueCodexRunner: no step queued for call #${i}`);
    return step;
  });
}

/**
 * Fake Higgsfield CLI runner, routed on the subcommand — `soul-id create` vs
 * `soul-id list` — the same two entry points trainSoulId/listRemoteSoulIds
 * shell out to. Never spawns the real `higgsfield` binary.
 */
function soulRunner(opts: { readonly train?: HfCliResult; readonly list?: HfCliResult }): HfCliRunner {
  return vi.fn(async (args: ReadonlyArray<string>, _timeoutMs: number) => {
    if (args[0] === 'soul-id' && args[1] === 'create') {
      if (!opts.train) throw new Error('soulRunner: no train step configured for this test');
      return opts.train;
    }
    if (args[0] === 'soul-id' && args[1] === 'list') {
      if (!opts.list) throw new Error('soulRunner: no list step configured for this test');
      return opts.list;
    }
    throw new Error(`soulRunner: unexpected args ${JSON.stringify(args)}`);
  });
}

function validCodexInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: 'a lighthouse at dusk',
    outputDir: '/tmp/out',
    ...overrides,
  };
}

// Every env var handleCodexImage/codexImageMode/CodexImageProvider read
// through, saved and restored around each test in this file regardless of
// which describe block touches them.
const CODEX_ENV_KEYS = [
  'MEDIA_FORGE_CODEX_IMAGE_MODE',
  'OPENAI_API_KEY',
  'MEDIA_FORGE_CODEX_IMAGE_ENABLED',
  'MEDIA_FORGE_CODEX_IMAGE_USD_PER_IMAGE',
] as const;

let savedCodexEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedCodexEnv = {};
  for (const k of CODEX_ENV_KEYS) savedCodexEnv[k] = process.env[k];
  // Known-clean slate regardless of the developer's own shell: OPENAI_API_KEY
  // is plausible to have set on a machine used for image work, which would
  // silently flip every "builtin mode" test below onto the cli path.
  for (const k of CODEX_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of CODEX_ENV_KEYS) {
    if (savedCodexEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedCodexEnv[k];
  }
});

// ---------------------------------------------------------------------------
// handleCodexImage
// ---------------------------------------------------------------------------

describe('handleCodexImage', () => {
  it('valid input returns { path, mode, estimateUsd, model }, model is always "gpt-image-2"', async () => {
    const runner = queueCodexRunner([okCodex('Done. Final path: /tmp/out/image.png')]);
    const provider = new CodexImageProvider({ runner, codexHome: '/fake/codex-home' });

    const result = await handleCodexImage(validCodexInput(), { provider });

    expect(result).toEqual({
      path: '/tmp/out/image.png',
      mode: 'builtin',
      estimateUsd: 0,
      model: 'gpt-image-2',
    });
    // Guards against the handler's literal 'gpt-image-2' (optional-providers.ts:70)
    // drifting from the provider's own CODEX_IMAGE_MODEL constant — today they
    // agree, but nothing types them together, so a rename of one silently
    // stops matching the other.
    expect(result.model).toBe(CODEX_IMAGE_MODEL);
  });

  it.each([
    ['empty prompt', { prompt: '', outputDir: '/tmp/out' }],
    ['size outside CODEX_IMAGE_SIZES', { prompt: 'x', outputDir: '/tmp/out', size: '999x999' }],
    ['missing outputDir', { prompt: 'x' }],
  ])('rejects %s at the handler boundary, never reaching the provider', async (_label, badInput) => {
    // Distinct from the CodexImageInput.parse tests below: this proves
    // handleCodexImage itself validates before calling provider.generate,
    // not just that the schema object rejects the shape in isolation. If the
    // parse() call were ever deleted from the handler, these schema-only
    // tests would keep passing while bad input reached a billed provider.
    const runner: CodexCliRunner = vi.fn();
    const provider = new CodexImageProvider({ runner, codexHome: '/fake/codex-home' });
    await expect(handleCodexImage(badInput, { provider })).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  it('isMultiTenant: true + builtin mode THROWS, naming OPENAI_API_KEY / MEDIA_FORGE_CODEX_IMAGE_MODE=cli as the remedy', async () => {
    // The discriminating test: the built-in path authenticates as whoever ran
    // `codex login` on this machine. Under multi-tenant, every tenant's image
    // would run on -- and bill -- one personal ChatGPT account.
    const runner: CodexCliRunner = vi.fn();
    const provider = new CodexImageProvider({ runner, codexHome: '/fake/codex-home' });

    await expect(
      handleCodexImage(validCodexInput(), { provider, isMultiTenant: true }),
    ).rejects.toThrow(ValidationError);
    expect(runner).not.toHaveBeenCalled();

    try {
      await handleCodexImage(validCodexInput(), { provider, isMultiTenant: true });
      throw new Error('expected handleCodexImage to throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/OPENAI_API_KEY/);
      expect((err as Error).message).toMatch(/MEDIA_FORGE_CODEX_IMAGE_MODE=cli/);
    }
  });

  it('isMultiTenant: true + cli mode is allowed', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['MEDIA_FORGE_CODEX_IMAGE_USD_PER_IMAGE'] = '0.04';
    const runner = queueCodexRunner([okCodex('Done. Final path: /tmp/out/image.png')]);
    const provider = new CodexImageProvider({ runner, codexHome: '/fake/codex-home' });

    const result = await handleCodexImage(validCodexInput(), { provider, isMultiTenant: true });
    expect(result.mode).toBe('cli');
    expect(result.model).toBe('gpt-image-2');
  });
});

describe('CodexImageInput validation', () => {
  it('rejects an empty prompt', () => {
    expect(() => CodexImageInput.parse(validCodexInput({ prompt: '' }))).toThrow();
  });

  it('rejects a size outside CODEX_IMAGE_SIZES', () => {
    expect(() => CodexImageInput.parse(validCodexInput({ size: '999x999' }))).toThrow();
  });

  it('requires outputDir', () => {
    const { outputDir: _drop, ...withoutOutputDir } = validCodexInput();
    expect(() => CodexImageInput.parse(withoutOutputDir)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// codexImageMode
// ---------------------------------------------------------------------------

describe('codexImageMode()', () => {
  it('reports { mode: "cli", requiresApiKey: true } when OPENAI_API_KEY is set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    expect(codexImageMode()).toEqual({ mode: 'cli', requiresApiKey: true });
  });

  it('reports { mode: "builtin", requiresApiKey: false } when unset — consistent with resolveCodexImageMode', () => {
    expect(codexImageMode()).toEqual({ mode: 'builtin', requiresApiKey: false });
  });
});

// ---------------------------------------------------------------------------
// handleSoulIdTrain / handleSoulIdList — fresh tmp sqlite db per test
// ---------------------------------------------------------------------------

describe('Soul-ID handlers (handleSoulIdTrain / handleSoulIdList)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-optional-providers-h-'));
    dbPath = join(tmpDir, 'cost.db');
    const db = openDb(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    closeDb(dbPath);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows can throw EPERM here right after closing a sqlite handle.
    }
  });

  function validTrainInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Lyra',
      imagePaths: ['/tmp/1.png', '/tmp/2.png', '/tmp/3.png', '/tmp/4.png', '/tmp/5.png'],
      ...overrides,
    };
  }

  describe('handleSoulIdTrain', () => {
    it('no runner supplied THROWS before anything else, naming MEDIA_FORGE_HF_CLI_ENABLED', async () => {
      // The CLI is required because it bills the logged-in workspace — there
      // is no API-key fallback path for training.
      await expect(handleSoulIdTrain(validTrainInput(), { dbPath })).rejects.toThrow(
        /MEDIA_FORGE_HF_CLI_ENABLED/,
      );
      expect(listSoulIds({ dbPath })).toHaveLength(0);
    });

    it('schema: below SOUL_MIN_IMAGES is rejected', () => {
      const tooFew = Array.from({ length: SOUL_MIN_IMAGES - 1 }, (_, i) => `/tmp/${i}.png`);
      expect(() => SoulIdTrainInput.parse(validTrainInput({ imagePaths: tooFew }))).toThrow();
    });

    it('schema: above SOUL_MAX_IMAGES is rejected', () => {
      const tooMany = Array.from({ length: SOUL_MAX_IMAGES + 1 }, (_, i) => `/tmp/${i}.png`);
      expect(() => SoulIdTrainInput.parse(validTrainInput({ imagePaths: tooMany }))).toThrow();
    });

    it('schema: exactly SOUL_MIN_IMAGES is accepted — the lower boundary', () => {
      const exactlyMin = Array.from({ length: SOUL_MIN_IMAGES }, (_, i) => `/tmp/${i}.png`);
      expect(() =>
        SoulIdTrainInput.parse(validTrainInput({ imagePaths: exactlyMin })),
      ).not.toThrow();
    });

    it('schema: exactly SOUL_MAX_IMAGES is accepted — the upper boundary', () => {
      const exactlyMax = Array.from({ length: SOUL_MAX_IMAGES }, (_, i) => `/tmp/${i}.png`);
      expect(() =>
        SoulIdTrainInput.parse(validTrainInput({ imagePaths: exactlyMax })),
      ).not.toThrow();
    });

    it('happy path: writes the local cache only AFTER the remote call succeeds', async () => {
      const runner = soulRunner({
        train: {
          stdout: JSON.stringify({ id: 'soul_remote_1', status: 'training' }),
          stderr: '',
          exitCode: 0,
        },
      });

      const result = await handleSoulIdTrain(validTrainInput({ name: 'Aurora' }), {
        runner,
        dbPath,
      });
      expect(result.id).toBe('soul_remote_1');

      const cached = listSoulIds({ dbPath });
      expect(cached).toHaveLength(1);
      expect(cached[0]?.id).toBe('soul_remote_1');
      expect(cached[0]?.characterName).toBe('Aurora');
    });

    it('a failing remote call leaves the cache EMPTY — recording first would create a phantom entry no downstream code can tell from a real id', async () => {
      const runner = soulRunner({
        train: { stdout: '', stderr: 'training service unavailable', exitCode: 1 },
      });

      await expect(
        handleSoulIdTrain(validTrainInput({ name: 'Ghost' }), { runner, dbPath }),
      ).rejects.toThrow(ApiError);

      expect(listSoulIds({ dbPath })).toHaveLength(0);
    });
  });

  describe('handleSoulIdList', () => {
    it('no runner: returns the local cache alone, with remote/inBoth/remoteOnly empty and localOnly listing every local id — does NOT throw', async () => {
      createSoulId({
        dbPath,
        id: 'soul_local_1',
        provider: 'higgsfield',
        characterName: 'A',
        assetPaths: ['/tmp/a.png'],
      });
      createSoulId({
        dbPath,
        id: 'soul_local_2',
        provider: 'higgsfield',
        characterName: 'B',
        assetPaths: ['/tmp/b.png'],
      });

      const result = await handleSoulIdList(undefined, { dbPath });

      expect(result.remote).toEqual([]);
      expect(result.inBoth).toEqual([]);
      expect(result.remoteOnly).toEqual([]);
      expect([...result.localOnly].sort()).toEqual(['soul_local_1', 'soul_local_2']);
      expect(result.local).toHaveLength(2);
    });

    it('with a runner: reconciliation partitions inBoth / localOnly / remoteOnly correctly', async () => {
      createSoulId({
        dbPath,
        id: 'soul_both',
        provider: 'higgsfield',
        characterName: 'Both',
        assetPaths: ['/tmp/both.png'],
      });
      createSoulId({
        dbPath,
        id: 'soul_local_only',
        provider: 'higgsfield',
        characterName: 'LocalOnly',
        assetPaths: ['/tmp/lo.png'],
      });

      const runner = soulRunner({
        list: {
          stdout: JSON.stringify([
            { id: 'soul_both', name: 'Both', status: 'ready' },
            { id: 'soul_remote_only', name: 'RemoteOnly', status: 'ready' },
          ]),
          stderr: '',
          exitCode: 0,
        },
      });

      const result = await handleSoulIdList(undefined, { runner, dbPath });

      expect(result.inBoth).toEqual(['soul_both']);
      expect(result.localOnly).toEqual(['soul_local_only']);
      expect(result.remoteOnly).toEqual(['soul_remote_only']);
    });

    it('does not mutate the local cache — a local-only id still exists after the list call', async () => {
      createSoulId({
        dbPath,
        id: 'soul_survivor',
        provider: 'higgsfield',
        characterName: 'Survivor',
        assetPaths: ['/tmp/s.png'],
      });

      const runner = soulRunner({
        list: { stdout: JSON.stringify([]), stderr: '', exitCode: 0 },
      });

      const result = await handleSoulIdList(undefined, { runner, dbPath });
      expect(result.localOnly).toEqual(['soul_survivor']);

      // The important assertion: deleting on remote-absence would discard a
      // record of training the user paid for. Confirm nothing was deleted.
      const stillThere = listSoulIds({ dbPath });
      expect(stillThere.map((r) => r.id)).toContain('soul_survivor');
    });
  });
});
