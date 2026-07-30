import { describe, it, expect } from 'vitest';
import {
  GenerationRun,
  RESULT_STATUSES,
  assertNoCostFields,
  isBillableRun,
  validateGenerationRunConsistency,
  parseGenerationRun,
  type GenerationRunT,
} from '../../src/narrative/generation-run.js';

function makeGenerationRun(overrides: Partial<GenerationRunT> = {}): GenerationRunT {
  return {
    run_id: 'run-1',
    project_id: 'proj-1',
    clip_id: 'clip-1',
    surface: 'kling',
    prompt_version: 'v1',
    input_mode: 'text_to_video',
    reference_tags: [],
    prompt: 'a cinematic shot',
    result_status: 'submitted',
    is_synthetic_fixture: false,
    ...overrides,
  };
}

describe('GenerationRun', () => {
  it('parses a valid run', () => {
    expect(() => GenerationRun.parse(makeGenerationRun())).not.toThrow();
  });

  it('rejects an unknown extra key (.strict())', () => {
    const withExtra = { ...makeGenerationRun(), unexpected_field: 'x' };
    expect(() => GenerationRun.parse(withExtra)).toThrow();
  });

  it('rejects an empty run_id', () => {
    expect(() => GenerationRun.parse(makeGenerationRun({ run_id: '' }))).toThrow();
  });

  it('accepts every declared result_status and rejects a bogus one', () => {
    for (const result_status of RESULT_STATUSES) {
      // is_synthetic_fixture must agree with result_status for the fixture to be
      // schema-valid AND consistent; the schema itself does not enforce that, so
      // this loop only exercises the raw enum acceptance.
      expect(() =>
        GenerationRun.parse(makeGenerationRun({ result_status })),
      ).not.toThrow();
    }
    expect(() =>
      GenerationRun.parse(makeGenerationRun({ result_status: 'made_up_status' as never })),
    ).toThrow();
  });
});

describe('the no-money invariant', () => {
  it('assertNoCostFields does not throw against the current shape', () => {
    expect(() => assertNoCostFields()).not.toThrow();
  });

  // The central T10 constraint: money is owned exclusively by trace.jsonl +
  // the credit ledger, joined on run_id. If a future edit adds a field like
  // `costUsd` or `actual_credits` to GenerationRun, this must fail loudly
  // rather than rely on someone remembering to call assertNoCostFields().
  it('GenerationRun.shape carries no field name matching cost/price/credit/usd', () => {
    const declared = Object.keys(GenerationRun.shape);
    const suspect = declared.filter((key) => /cost|price|credit|usd/i.test(key));
    expect(suspect).toEqual([]);
  });
});

describe('isBillableRun', () => {
  it('is never billable when is_synthetic_fixture is true, regardless of status', () => {
    expect(
      isBillableRun(makeGenerationRun({ is_synthetic_fixture: true, result_status: 'generated' })),
    ).toBe(false);
    expect(
      isBillableRun(
        makeGenerationRun({ is_synthetic_fixture: true, result_status: 'not_run_fixture' }),
      ),
    ).toBe(false);
  });

  it('is not billable when result_status is not_run_fixture, even if not synthetic', () => {
    expect(
      isBillableRun(
        makeGenerationRun({ is_synthetic_fixture: false, result_status: 'not_run_fixture' }),
      ),
    ).toBe(false);
  });

  it('is billable only once dispatched and not synthetic', () => {
    expect(
      isBillableRun(
        makeGenerationRun({ is_synthetic_fixture: false, result_status: 'submitted' }),
      ),
    ).toBe(true);
    expect(
      isBillableRun(
        makeGenerationRun({ is_synthetic_fixture: false, result_status: 'accepted' }),
      ),
    ).toBe(true);
  });
});

describe('validateGenerationRunConsistency', () => {
  it('flags a synthetic fixture reporting a dispatched status', () => {
    const problems = validateGenerationRunConsistency(
      makeGenerationRun({ is_synthetic_fixture: true, result_status: 'generated' }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/synthetic fixture must never report a dispatched status/);
  });

  it('flags a non-synthetic run reporting not_run_fixture', () => {
    const problems = validateGenerationRunConsistency(
      makeGenerationRun({ is_synthetic_fixture: false, result_status: 'not_run_fixture' }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/requires is_synthetic_fixture to be true/);
  });

  it('reports no problems for a consistent synthetic fixture', () => {
    expect(
      validateGenerationRunConsistency(
        makeGenerationRun({ is_synthetic_fixture: true, result_status: 'not_run_fixture' }),
      ),
    ).toEqual([]);
  });

  it('reports no problems for a consistent dispatched run', () => {
    expect(
      validateGenerationRunConsistency(
        makeGenerationRun({ is_synthetic_fixture: false, result_status: 'submitted' }),
      ),
    ).toEqual([]);
  });
});

describe('parseGenerationRun', () => {
  it('returns the parsed run when consistent', () => {
    const run = makeGenerationRun();
    expect(parseGenerationRun(run)).toEqual(run);
  });

  it('throws when the fixture/billing rules are violated', () => {
    const run = makeGenerationRun({ is_synthetic_fixture: true, result_status: 'generated' });
    expect(() => parseGenerationRun(run)).toThrow();
  });
});
