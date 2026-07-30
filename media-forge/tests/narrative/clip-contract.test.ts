import { describe, it, expect } from 'vitest';
import { CLIP_STATUSES, SHOT_STRUCTURES } from '../../src/narrative/enums.js';
import {
  ClipContract,
  findBeatCollisions,
  parseClipContract,
  type ClipContractT,
} from '../../src/narrative/clip-contract.js';

// Every field varies independently across tests, so a factory keeps each test
// down to the one line that actually matters.
function makeClipContract(overrides: Partial<ClipContractT> = {}): ClipContractT {
  return {
    project_id: 'proj-1',
    clip_id: 'clip-1',
    parent_clip_id: null,
    scene_id: 'scene-1',
    sequence_index: 1,
    narrative_job: 'establish the location',
    felt_intent: 'quiet unease',
    target_duration_sec: null,
    generation_mode: 'text_to_video',
    shot_structure: 'compact_single_take',
    already_happened: [],
    this_clip_only: [],
    reserved_for_later: [],
    planned_start_state: {},
    planned_end_state: {},
    continuity_locks: [],
    allowed_changes: [],
    status: 'planned',
    ...overrides,
  };
}

describe('ClipContract', () => {
  it('parses a valid contract', () => {
    expect(() => ClipContract.parse(makeClipContract())).not.toThrow();
  });

  it('rejects an unknown extra key (.strict())', () => {
    const withExtra = { ...makeClipContract(), unexpected_field: 'x' };
    expect(() => ClipContract.parse(withExtra)).toThrow();
  });

  it('accepts every declared status and rejects a bogus one', () => {
    for (const status of CLIP_STATUSES) {
      expect(() => ClipContract.parse(makeClipContract({ status }))).not.toThrow();
    }
    expect(() =>
      ClipContract.parse(makeClipContract({ status: 'made_up_status' as never })),
    ).toThrow();
  });

  it('accepts every declared shot_structure and rejects a bogus one', () => {
    for (const shot_structure of SHOT_STRUCTURES) {
      expect(() => ClipContract.parse(makeClipContract({ shot_structure }))).not.toThrow();
    }
    expect(() =>
      ClipContract.parse(makeClipContract({ shot_structure: 'made_up_structure' as never })),
    ).toThrow();
  });

  it('parent_clip_id accepts null but rejects being entirely absent', () => {
    expect(() => ClipContract.parse(makeClipContract({ parent_clip_id: null }))).not.toThrow();
    const { parent_clip_id: _drop, ...withoutField } = makeClipContract();
    expect(() => ClipContract.parse(withoutField)).toThrow();
  });

  it('target_duration_sec accepts null but rejects being entirely absent', () => {
    expect(() =>
      ClipContract.parse(makeClipContract({ target_duration_sec: null })),
    ).not.toThrow();
    const { target_duration_sec: _drop, ...withoutField } = makeClipContract();
    expect(() => ClipContract.parse(withoutField)).toThrow();
  });

  it('felt_intent rejects an empty string (never a valid intent)', () => {
    expect(() => ClipContract.parse(makeClipContract({ felt_intent: '' }))).toThrow();
  });

  it('sequence_index rejects zero and negative values', () => {
    expect(() => ClipContract.parse(makeClipContract({ sequence_index: 0 }))).toThrow();
    expect(() => ClipContract.parse(makeClipContract({ sequence_index: -1 }))).toThrow();
  });
});

describe('findBeatCollisions', () => {
  it('reports a beat that appears in two of the three lists', () => {
    const contract = makeClipContract({
      already_happened: ['beat-a'],
      this_clip_only: ['beat-a', 'beat-b'],
      reserved_for_later: [],
    });
    const collisions = findBeatCollisions(contract);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toContain('beat-a');
  });

  it('reports zero collisions when the three lists are disjoint', () => {
    const contract = makeClipContract({
      already_happened: ['beat-a'],
      this_clip_only: ['beat-b'],
      reserved_for_later: ['beat-c'],
    });
    expect(findBeatCollisions(contract)).toEqual([]);
  });
});

describe('parseClipContract', () => {
  it('returns the parsed contract when beat lists are disjoint', () => {
    const contract = makeClipContract({
      already_happened: ['beat-a'],
      this_clip_only: ['beat-b'],
    });
    expect(parseClipContract(contract)).toEqual(contract);
  });

  it('throws when a beat appears in two lists', () => {
    const contract = makeClipContract({
      already_happened: ['beat-a'],
      this_clip_only: ['beat-a'],
    });
    expect(() => parseClipContract(contract)).toThrow(/disjoint/);
  });
});
