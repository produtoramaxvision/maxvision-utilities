import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffAgainstSnapshot } from '../../../src/refs/taxonomy.js';

describe('diffAgainstSnapshot', () => {
  it('returns empty diff when snapshot matches taxonomy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-tax-'));
    const { CATEGORIES } = await import('../../../src/refs/taxonomy.js');
    const snap = join(dir, 'snap.json');
    await writeFile(snap, JSON.stringify({ categories: [...CATEGORIES] }));
    const diff = await diffAgainstSnapshot(snap);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('detects added + removed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-tax-'));
    const { CATEGORIES } = await import('../../../src/refs/taxonomy.js');
    const remote = [...CATEGORIES.slice(0, -1), 'brand-new-effect'];
    const snap = join(dir, 'snap.json');
    await writeFile(snap, JSON.stringify({ categories: remote }));
    const diff = await diffAgainstSnapshot(snap);
    expect(diff.added).toEqual(['brand-new-effect']);
    expect(diff.removed).toEqual([CATEGORIES[CATEGORIES.length - 1]]);
  });
});
