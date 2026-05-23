import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeTempDir, type TempDirHandle } from '../../helpers/fs-tempdir.js';
import { recordLineage, readLineage } from '../../../src/trace/lineage.js';
import { ValidationError } from '../../../src/core/errors.js';

function makeJobDir(tmp: TempDirHandle): string {
  const d = path.join(tmp.path, 'jobs', 'lineage-job-001');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe('Lineage', () => {
  let tmp: TempDirHandle;
  let jobDir: string;

  beforeEach(() => {
    tmp = makeTempDir('lineage-test-');
    jobDir = makeJobDir(tmp);
  });

  afterEach(() => {
    tmp.cleanup();
  });

  // ── 11. Happy: record + read returns the entry ────────────────────────────────
  it('recordLineage then readLineage returns the recorded entry', async () => {
    await recordLineage({
      jobDir,
      attempt: 1,
      rootCause: 'Text was too small to read',
      fixTargetAgent: 'image-generator',
      fixDirective: 'Increase font size to 48px minimum',
      verdict: 'fail',
    });

    const entries = await readLineage({ jobDir });
    expect(entries.length).toBe(1);
    const e = entries[0]!;
    expect(e.attempt).toBe(1);
    expect(e.rootCause).toBe('Text was too small to read');
    expect(e.fixTargetAgent).toBe('image-generator');
    expect(e.fixDirective).toBe('Increase font size to 48px minimum');
    expect(e.verdict).toBe('fail');
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── 12. Order: 3 attempts recorded out of order → read returns [1,2,3] ────────
  it('readLineage returns entries sorted by attempt ascending regardless of insertion order', async () => {
    await recordLineage({
      jobDir,
      attempt: 3,
      rootCause: 'Third attempt issue',
      fixTargetAgent: 'agent-c',
      fixDirective: 'Fix C',
      verdict: 'partial',
    });
    await recordLineage({
      jobDir,
      attempt: 1,
      rootCause: 'First attempt issue',
      fixTargetAgent: 'agent-a',
      fixDirective: 'Fix A',
      verdict: 'fail',
    });
    await recordLineage({
      jobDir,
      attempt: 2,
      rootCause: 'Second attempt issue',
      fixTargetAgent: 'agent-b',
      fixDirective: 'Fix B',
      verdict: 'pass',
    });

    const entries = await readLineage({ jobDir });
    expect(entries.length).toBe(3);
    expect(entries[0]!.attempt).toBe(1);
    expect(entries[1]!.attempt).toBe(2);
    expect(entries[2]!.attempt).toBe(3);
  });

  // ── 13. Reject attempt: 0 ────────────────────────────────────────────────────
  it('rejects attempt: 0 with ValidationError', async () => {
    await expect(
      recordLineage({
        jobDir,
        attempt: 0,
        rootCause: 'some cause',
        fixTargetAgent: 'agent',
        fixDirective: 'some fix',
        verdict: 'fail',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects negative attempt with ValidationError', async () => {
    await expect(
      recordLineage({
        jobDir,
        attempt: -1,
        rootCause: 'some cause',
        fixTargetAgent: 'agent',
        fixDirective: 'some fix',
        verdict: 'fail',
      }),
    ).rejects.toThrow(ValidationError);
  });

  // ── 14. Reject empty rootCause ────────────────────────────────────────────────
  it('rejects empty rootCause with ValidationError', async () => {
    await expect(
      recordLineage({
        jobDir,
        attempt: 1,
        rootCause: '',
        fixTargetAgent: 'agent',
        fixDirective: 'some fix',
        verdict: 'fail',
      }),
    ).rejects.toThrow(ValidationError);
  });

  // ── 15. Concurrent: 10 parallel recordLineage → readLineage returns 10 sorted ──
  it('concurrent recordLineage(x10) → readLineage returns 10 entries sorted 1..10', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordLineage({
          jobDir,
          attempt: i + 1,
          rootCause: `Cause ${i + 1}`,
          fixTargetAgent: `agent-${i + 1}`,
          fixDirective: `Fix directive ${i + 1}`,
          verdict: i % 2 === 0 ? 'fail' : 'pass',
        }),
      ),
    );

    const entries = await readLineage({ jobDir });
    expect(entries.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(entries[i]!.attempt).toBe(i + 1);
    }
  });

  // ── 16. Reject extra unknown field (.strict()) ────────────────────────────────
  it('rejects extra unknown fields due to .strict() schema', async () => {
    // Bypass TS types to inject an extra field at runtime, testing .strict() rejection
    // The only way to surface strict() rejection is to test the Zod schema directly
    const { LineageEntry } = await import('../../../src/trace/lineage.js');
    expect(() =>
      LineageEntry.parse({
        attempt: 1,
        ts: new Date().toISOString(),
        rootCause: 'some cause',
        fixTargetAgent: 'agent',
        fixDirective: 'some fix',
        verdict: 'fail',
        extraField: 'should-be-rejected',
      }),
    ).toThrow();
  });

  // Additional: readLineage on missing file returns []
  it('readLineage on missing lineage.jsonl returns empty array', async () => {
    const emptyDir = path.join(tmp.path, 'empty-job');
    fs.mkdirSync(emptyDir, { recursive: true });
    const entries = await readLineage({ jobDir: emptyDir });
    expect(entries).toEqual([]);
  });

  // Additional: custom ts is preserved
  it('custom ts is preserved in the written entry', async () => {
    const customTs = '2026-01-15T10:00:00.000Z';
    await recordLineage({
      jobDir,
      attempt: 1,
      rootCause: 'Test cause',
      fixTargetAgent: 'agent',
      fixDirective: 'Fix it',
      verdict: 'pass',
      ts: customTs,
    });
    const [entry] = await readLineage({ jobDir });
    expect(entry?.ts).toBe(customTs);
  });
});
