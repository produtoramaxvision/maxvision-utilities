import { describe, it, expect } from 'vitest';
import {
  OBSERVATION_CONFIDENCES,
  SOURCE_STATUSES,
  TAKE_VERDICTS,
} from '../../src/narrative/enums.js';
import {
  TakeReview,
  validateTakeReviewConsistency,
  parseTakeReview,
  type TakeReviewT,
} from '../../src/review/take-review.js';

function makeTakeReview(overrides: Partial<TakeReviewT> = {}): TakeReviewT {
  return {
    project_id: 'proj-1',
    clip_id: 'clip-1',
    take_id: 'take-1',
    source_status: 'generated',
    verdict: 'accept',
    observed_start_state: {},
    observed_end_state: {},
    completed_beats: ['beat-a'],
    incomplete_beats: [],
    unexpected_completed_beats: [],
    continuity_breaks: [],
    accepted_deviations: [],
    observation_confidence: 'high',
    uncertainties: [],
    requires_user_confirmation: false,
    ...overrides,
  };
}

describe('TakeReview', () => {
  it('parses a valid review', () => {
    expect(() => TakeReview.parse(makeTakeReview())).not.toThrow();
  });

  it('rejects an unknown extra key (.strict())', () => {
    const withExtra = { ...makeTakeReview(), unexpected_field: 'x' };
    expect(() => TakeReview.parse(withExtra)).toThrow();
  });

  it('accepts every declared source_status and rejects a bogus one', () => {
    for (const source_status of SOURCE_STATUSES) {
      expect(() => TakeReview.parse(makeTakeReview({ source_status }))).not.toThrow();
    }
    expect(() =>
      TakeReview.parse(makeTakeReview({ source_status: 'made_up_status' as never })),
    ).toThrow();
    // planned/ready are valid ClipStatus values but not valid SourceStatus values —
    // a take cannot be reviewed before it has been generated.
    expect(() => TakeReview.parse(makeTakeReview({ source_status: 'planned' as never }))).toThrow();
    expect(() => TakeReview.parse(makeTakeReview({ source_status: 'ready' as never }))).toThrow();
  });

  it('accepts every declared verdict and rejects a bogus one', () => {
    for (const verdict of TAKE_VERDICTS) {
      // accept_with_deviation requires accepted_deviations to be non-empty to
      // stay consistent; the raw schema itself has no such rule, so exercise it
      // at the schema layer with a matching accepted_deviations.
      expect(() =>
        TakeReview.parse(makeTakeReview({ verdict, accepted_deviations: ['dev-1'] })),
      ).not.toThrow();
    }
    expect(() => TakeReview.parse(makeTakeReview({ verdict: 'made_up_verdict' as never }))).toThrow();
  });

  it('accepts every declared observation_confidence and rejects a bogus one', () => {
    for (const observation_confidence of OBSERVATION_CONFIDENCES) {
      expect(() =>
        TakeReview.parse(
          makeTakeReview({ observation_confidence, requires_user_confirmation: true }),
        ),
      ).not.toThrow();
    }
    expect(() =>
      TakeReview.parse(makeTakeReview({ observation_confidence: 'made_up_confidence' as never })),
    ).toThrow();
  });
});

describe('validateTakeReviewConsistency', () => {
  it('rejects verdict "accept" when incomplete_beats is non-empty', () => {
    const problems = validateTakeReviewConsistency(
      makeTakeReview({ verdict: 'accept', incomplete_beats: ['beat-b'] }),
    );
    expect(problems.some((p) => p.includes('incomplete beat'))).toBe(true);
  });

  it('rejects verdict "accept" when continuity_breaks is non-empty', () => {
    const problems = validateTakeReviewConsistency(
      makeTakeReview({ verdict: 'accept', continuity_breaks: [{ what: 'lighting shifted' }] }),
    );
    expect(problems.some((p) => p.includes('continuity break'))).toBe(true);
  });

  it('rejects "accept_with_deviation" with empty accepted_deviations', () => {
    const problems = validateTakeReviewConsistency(
      makeTakeReview({ verdict: 'accept_with_deviation', accepted_deviations: [] }),
    );
    expect(problems.some((p) => p.includes('accept_with_deviation'))).toBe(true);
  });

  it('rejects low observation_confidence without requires_user_confirmation', () => {
    const problems = validateTakeReviewConsistency(
      makeTakeReview({ observation_confidence: 'low', requires_user_confirmation: false }),
    );
    expect(problems.some((p) => p.includes('requires_user_confirmation'))).toBe(true);
  });

  it('rejects a beat appearing in both completed_beats and incomplete_beats', () => {
    const problems = validateTakeReviewConsistency(
      makeTakeReview({ completed_beats: ['beat-a'], incomplete_beats: ['beat-a'] }),
    );
    expect(problems.some((p) => p.includes('both completed and incomplete'))).toBe(true);
  });

  it('rejects a beat appearing in both completed_beats and unexpected_completed_beats', () => {
    const problems = validateTakeReviewConsistency(
      makeTakeReview({ completed_beats: ['beat-a'], unexpected_completed_beats: ['beat-a'] }),
    );
    expect(problems.some((p) => p.includes('both an expected and an unexpected completion'))).toBe(
      true,
    );
  });

  it('reports no problems for a fully consistent review', () => {
    expect(
      validateTakeReviewConsistency(
        makeTakeReview({ verdict: 'accept', completed_beats: ['beat-a'], incomplete_beats: [] }),
      ),
    ).toEqual([]);
  });
});

describe('parseTakeReview', () => {
  it('returns the parsed review when consistent', () => {
    const review = makeTakeReview();
    expect(parseTakeReview(review)).toEqual(review);
  });

  it('throws when a consistency rule is violated', () => {
    const review = makeTakeReview({ verdict: 'accept', incomplete_beats: ['beat-b'] });
    expect(() => parseTakeReview(review)).toThrow();
  });
});
