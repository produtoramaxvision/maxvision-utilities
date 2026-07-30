// tests/video/providers/higgsfield-soul-cli.test.ts
// T6 — Soul-ID training/listing/reconciliation (src/video/providers/higgsfield-soul-cli.ts).
//
// Every test injects a fake CliRunner (see higgsfield-cli.test.ts for the same
// convention). Nothing here spawns the real `higgsfield` binary.
import { describe, it, expect, vi } from 'vitest';
import {
  assertSoulImageCount,
  buildSoulTrainArgs,
  trainSoulId,
  listRemoteSoulIds,
  reconcileSoulIds,
  SOUL_MIN_IMAGES,
  SOUL_MAX_IMAGES,
  type SoulIdTrainInput,
} from '../../../src/video/providers/higgsfield-soul-cli.js';
import { ValidationError } from '../../../src/core/errors.js';
import type { CliResult, CliRunner } from '../../../src/video/providers/higgsfield-cli.js';

function ok(stdout: string): CliResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function fail(exitCode: number, stderr = 'boom'): CliResult {
  return { stdout: '', stderr, exitCode };
}

function paths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/tmp/img-${i}.png`);
}

describe('assertSoulImageCount', () => {
  it('rejects 4 images (below SOUL_MIN_IMAGES)', () => {
    expect(() => assertSoulImageCount(paths(4))).toThrow(ValidationError);
  });

  it('accepts 5 images (SOUL_MIN_IMAGES)', () => {
    expect(() => assertSoulImageCount(paths(5))).not.toThrow();
  });

  it('accepts 20 images (SOUL_MAX_IMAGES)', () => {
    expect(() => assertSoulImageCount(paths(20))).not.toThrow();
  });

  it('rejects 21 images (above SOUL_MAX_IMAGES)', () => {
    expect(() => assertSoulImageCount(paths(21))).toThrow(ValidationError);
  });

  it('the error message mentions both bounds', () => {
    expect(SOUL_MIN_IMAGES).toBe(5);
    expect(SOUL_MAX_IMAGES).toBe(20);
    try {
      assertSoulImageCount(paths(2));
      throw new Error('expected assertSoulImageCount to throw');
    } catch (err) {
      expect((err as Error).message).toContain(String(SOUL_MIN_IMAGES));
      expect((err as Error).message).toContain(String(SOUL_MAX_IMAGES));
    }
  });
});

describe('buildSoulTrainArgs', () => {
  function input(overrides: Partial<SoulIdTrainInput> = {}): SoulIdTrainInput {
    return {
      name: 'Jane Doe',
      imagePaths: paths(5),
      variant: 'soul-2',
      ...overrides,
    };
  }

  it('includes --name and the name value', () => {
    const args = buildSoulTrainArgs(input({ name: 'Jane Doe' }));
    const idx = args.indexOf('--name');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('Jane Doe');
  });

  it('renders the soul-2 variant as --soul-2', () => {
    const args = buildSoulTrainArgs(input({ variant: 'soul-2' }));
    expect(args).toContain('--soul-2');
    expect(args).not.toContain('--soul-cinematic');
  });

  it('renders the soul-cinematic variant as --soul-cinematic', () => {
    const args = buildSoulTrainArgs(input({ variant: 'soul-cinematic' }));
    expect(args).toContain('--soul-cinematic');
    expect(args).not.toContain('--soul-2');
  });

  it('emits one --image flag per path', () => {
    const imgs = ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png', '/tmp/d.png', '/tmp/e.png'];
    const args = buildSoulTrainArgs(input({ imagePaths: imgs }));
    const positions = args.reduce<number[]>((acc, a, i) => {
      if (a === '--image') acc.push(i);
      return acc;
    }, []);
    expect(positions).toHaveLength(imgs.length);
    expect(positions.map((i) => args[i + 1])).toEqual(imgs);
  });

  it('includes --json', () => {
    const args = buildSoulTrainArgs(input());
    expect(args).toContain('--json');
  });

  it('throws (via assertSoulImageCount) when the image count is out of bounds', () => {
    expect(() => buildSoulTrainArgs(input({ imagePaths: paths(3) }))).toThrow(ValidationError);
  });

  // Same injection concern as buildCliArgs in higgsfield-cli.ts: a character
  // name is user-controlled text and must land as ONE argv element no matter
  // what it contains, never interpolated into a shell string.
  const dangerousNames = [
    '; rm -rf ~',
    'a `whoami` b',
    '$(whoami)',
    'name && curl evil.com',
    'quote " inside',
  ];

  it.each(dangerousNames)('a name containing %j stays exactly one verbatim array element', (name) => {
    const args = buildSoulTrainArgs(input({ name }));
    const matches = args.filter((a) => a === name);
    expect(matches).toHaveLength(1);
    const idx = args.indexOf('--name');
    expect(args[idx + 1]).toBe(name);
  });
});

describe('trainSoulId', () => {
  it('parses id from the "id" field', async () => {
    const runner: CliRunner = vi.fn(async () => ok('{"id": "soul-abc", "status": "training"}'));
    const result = await trainSoulId(runner, { name: 'Jane', imagePaths: paths(5), variant: 'soul-2' });
    expect(result.id).toBe('soul-abc');
    expect(result.name).toBe('Jane');
  });

  it('parses id from the "soul_id" field when "id" is absent', async () => {
    const runner: CliRunner = vi.fn(async () => ok('{"soul_id": "soul-xyz"}'));
    const result = await trainSoulId(runner, { name: 'Jane', imagePaths: paths(5), variant: 'soul-2' });
    expect(result.id).toBe('soul-xyz');
  });

  it('throws when neither "id" nor "soul_id" is present', async () => {
    const runner: CliRunner = vi.fn(async () => ok('{"status": "training"}'));
    await expect(
      trainSoulId(runner, { name: 'Jane', imagePaths: paths(5), variant: 'soul-2' }),
    ).rejects.toThrow(/returned no id/);
  });

  it('throws on non-zero exit', async () => {
    const runner: CliRunner = vi.fn(async () => fail(1, 'upload rejected'));
    await expect(
      trainSoulId(runner, { name: 'Jane', imagePaths: paths(5), variant: 'soul-2' }),
    ).rejects.toThrow(/soul-id create failed/);
  });
});

describe('listRemoteSoulIds', () => {
  it('handles a bare JSON array', async () => {
    const runner: CliRunner = vi.fn(async () =>
      ok(JSON.stringify([{ id: 's1', name: 'A', status: 'ready' }])),
    );
    const rows = await listRemoteSoulIds(runner);
    expect(rows).toEqual([{ id: 's1', name: 'A', status: 'ready' }]);
  });

  it('handles {items: [...]}', async () => {
    const runner: CliRunner = vi.fn(async () =>
      ok(JSON.stringify({ items: [{ id: 's2', name: 'B', status: 'training' }] })),
    );
    const rows = await listRemoteSoulIds(runner);
    expect(rows).toEqual([{ id: 's2', name: 'B', status: 'training' }]);
  });

  it('reports unparseable output as an ApiError carrying the raw stdout', async () => {
    // A bare JSON.parse here throws a context-free SyntaxError and discards the
    // stdout that explains the failure — in practice an auth prompt or an error
    // banner printed as plain text, which is exactly what the operator needs to
    // see. Every other parse path in these two modules wraps the failure; this
    // one did not, and the inconsistency is what this test pins.
    const runner: CliRunner = vi.fn(async () => ok('Please run `higgsfield auth login`'));
    await expect(listRemoteSoulIds(runner)).rejects.toThrow(/could not parse the Soul-ID listing/i);
    await expect(listRemoteSoulIds(runner)).rejects.toThrow(/higgsfield auth login/);
  });
});

describe('reconcileSoulIds', () => {
  it('partitions inBoth/localOnly/remoteOnly correctly', () => {
    const local = [
      { id: 'a', characterName: 'Alice' },
      { id: 'b', characterName: 'Bob' },
    ];
    const remote = [
      { id: 'b', name: 'Bob', status: 'ready' },
      { id: 'c', name: 'Carol', status: 'ready' },
    ];
    const result = reconcileSoulIds({ local, remote });
    expect(result.inBoth).toEqual(['b']);
    expect(result.localOnly).toEqual(['a']);
    expect(result.remoteOnly).toEqual(['c']);
  });

  it('handles empty on both sides', () => {
    const result = reconcileSoulIds({ local: [], remote: [] });
    expect(result.inBoth).toEqual([]);
    expect(result.localOnly).toEqual([]);
    expect(result.remoteOnly).toEqual([]);
  });

  it('does NOT mutate its inputs — deleting local rows on bad evidence would discard paid training', () => {
    const local = [
      { id: 'a', characterName: 'Alice' },
      { id: 'b', characterName: 'Bob' },
    ];
    const remote = [{ id: 'b', name: 'Bob', status: 'ready' }];
    const localSnapshot = JSON.parse(JSON.stringify(local));
    const remoteSnapshot = JSON.parse(JSON.stringify(remote));

    reconcileSoulIds({ local, remote });

    expect(local).toEqual(localSnapshot);
    expect(remote).toEqual(remoteSnapshot);
  });
});
