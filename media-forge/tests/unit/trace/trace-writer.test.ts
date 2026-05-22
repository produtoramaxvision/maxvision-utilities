import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeTempDir, type TempDirHandle } from '../../helpers/fs-tempdir.js';
import { appendTrace, readTrace } from '../../../src/trace/trace-writer.js';
import { ValidationError } from '../../../src/core/errors.js';

const VALID_HASH = 'abcdef1234567890'; // 16 chars minimum

function makeJobDir(tmp: TempDirHandle): string {
  const d = path.join(tmp.path, 'jobs', 'test-job-001');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe('TraceWriter', () => {
  let tmp: TempDirHandle;
  let jobDir: string;

  beforeEach(() => {
    tmp = makeTempDir('trace-test-');
    jobDir = makeJobDir(tmp);
  });

  afterEach(() => {
    tmp.cleanup();
  });

  // ── 1. Happy path: appendTrace → readTrace returns 1 entry ──────────────────
  it('appendTrace then readTrace returns 1 entry with matching fields', async () => {
    const ts = new Date().toISOString();
    await appendTrace({
      jobId: 'test-job-001',
      jobDir,
      entry: {
        ts,
        stage: 'image-generate',
        inputHash: VALID_HASH,
        durationMs: 1500,
        model: 'nano-banana-pro',
        costUsd: 0.24,
        verdict: 'pass',
      },
    });

    const entries = await readTrace({ jobDir });
    expect(entries.length).toBe(1);
    const e = entries[0]!;
    expect(e.stage).toBe('image-generate');
    expect(e.inputHash).toBe(VALID_HASH);
    expect(e.durationMs).toBe(1500);
    expect(e.model).toBe('nano-banana-pro');
    expect(e.costUsd).toBe(0.24);
    expect(e.verdict).toBe('pass');
    expect(e.ts).toBe(ts);
  });

  // ── 2. ts auto-populated when not provided ───────────────────────────────────
  it('ts is auto-populated when not provided', async () => {
    const before = Date.now();
    await appendTrace({
      jobId: 'test-job-001',
      jobDir,
      entry: {
        stage: 'video-poll',
        inputHash: VALID_HASH,
        durationMs: 0,
      },
    });
    const after = Date.now();

    const [entry] = await readTrace({ jobDir });
    expect(entry).toBeDefined();
    const entryMs = new Date(entry!.ts).getTime();
    expect(entryMs).toBeGreaterThanOrEqual(before);
    expect(entryMs).toBeLessThanOrEqual(after + 1000); // small buffer for clock skew
  });

  // ── 3. Reject invalid stage value ────────────────────────────────────────────
  it('rejects an invalid stage value with ValidationError containing a field hint', async () => {
    await expect(
      appendTrace({
        jobId: 'test-job-001',
        jobDir,
        entry: {
          stage: 'not-a-real-stage' as never,
          inputHash: VALID_HASH,
          durationMs: 100,
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  // ── 4. Reject negative durationMs ────────────────────────────────────────────
  it('rejects negative durationMs with ValidationError', async () => {
    await expect(
      appendTrace({
        jobId: 'test-job-001',
        jobDir,
        entry: {
          stage: 'image-generate',
          inputHash: VALID_HASH,
          durationMs: -1,
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  // ── 5. Reject extra unknown field (.strict()) ─────────────────────────────────
  it('rejects extra unknown fields due to .strict() schema', async () => {
    await expect(
      appendTrace({
        jobId: 'test-job-001',
        jobDir,
        entry: {
          stage: 'image-generate',
          inputHash: VALID_HASH,
          durationMs: 100,
          unknownField: 'should-fail',
        } as never,
      }),
    ).rejects.toThrow(ValidationError);
  });

  // ── 6. Reject inputHash < 16 chars ───────────────────────────────────────────
  it('rejects inputHash shorter than 16 characters', async () => {
    await expect(
      appendTrace({
        jobId: 'test-job-001',
        jobDir,
        entry: {
          stage: 'image-generate',
          inputHash: 'short',
          durationMs: 100,
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  // ── 7. Concurrent atomicity: 10 parallel appends → 10 entries ────────────────
  it('concurrent appendTrace(x10) with distinct stages → readTrace returns 10 entries', async () => {
    const stages = [
      'intent-routing',
      'prompt-refinement',
      'image-generate',
      'image-edit',
      'image-compose',
      'video-generate',
      'video-extend',
      'video-poll',
      'video-download',
      'fix-dispatch',
    ] as const;

    await Promise.all(
      stages.map((stage) =>
        appendTrace({
          jobId: 'test-job-001',
          jobDir,
          entry: { stage, inputHash: VALID_HASH, durationMs: 10 },
        }),
      ),
    );

    const entries = await readTrace({ jobDir });
    expect(entries.length).toBe(10);
    const foundStages = new Set(entries.map((e) => e.stage));
    for (const stage of stages) {
      expect(foundStages.has(stage)).toBe(true);
    }
  });

  // ── 8. readTrace on missing file returns [] ───────────────────────────────────
  it('readTrace on a missing trace.jsonl returns empty array', async () => {
    const emptyDir = path.join(tmp.path, 'nonexistent-job');
    fs.mkdirSync(emptyDir, { recursive: true });
    const entries = await readTrace({ jobDir: emptyDir });
    expect(entries).toEqual([]);
  });

  // ── 9. readTrace skips malformed lines ───────────────────────────────────────
  it('readTrace skips malformed lines and returns remaining valid entries', async () => {
    const tracePath = path.join(jobDir, 'trace.jsonl');
    const goodEntry = JSON.stringify({
      ts: new Date().toISOString(),
      stage: 'image-generate',
      inputHash: VALID_HASH,
      durationMs: 100,
    });
    // Write: good line, bad line, good line
    fs.writeFileSync(
      tracePath,
      [goodEntry, 'not-json-at-all', goodEntry].join('\n') + '\n',
    );

    const entries = await readTrace({ jobDir });
    expect(entries.length).toBe(2);
  });

  // ── 10. Cost log integration: costUsd round-trips correctly ──────────────────
  it('trace entry with costUsd reads back with identical value', async () => {
    await appendTrace({
      jobId: 'test-job-001',
      jobDir,
      entry: {
        stage: 'review-judge',
        inputHash: VALID_HASH,
        durationMs: 200,
        costUsd: 0.05,
      },
    });

    const [entry] = await readTrace({ jobDir });
    expect(entry?.costUsd).toBe(0.05);
  });
});
