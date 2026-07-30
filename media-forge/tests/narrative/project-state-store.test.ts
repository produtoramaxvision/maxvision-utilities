import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadProjectState,
  saveProjectState,
  listProjectStates,
} from '../../src/narrative/project-state-store.js';
import type { ProjectStateT } from '../../src/narrative/project-state.js';

function makeState(overrides: Partial<ProjectStateT> = {}): ProjectStateT {
  return {
    schema_version: '1.0',
    state_revision: 1,
    project_id: 'proj-a',
    project_mode: 'sequence_project',
    surface: {},
    clip_budget_sec: null,
    prompt_budget: null,
    story: {
      logline: '',
      story_promise: '',
      objective: '',
      initial_condition: '',
      final_outcome: '',
      target_duration_sec: null,
      tone: '',
      medium: '',
    },
    world_bible: {},
    reference_registry: [],
    scenes: [],
    beats: [],
    clips: [],
    take_history: [],
    current_clip_id: '',
    canon_revision: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('project-state-store', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mf-project-state-'));
    dbPath = join(tmpDir, 'narrative.db');
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — ignore, OS will clean up temp dir
    }
  });

  it('round-trips a saved state', () => {
    const state = makeState({ project_id: 'proj-roundtrip' });
    saveProjectState({ dbPath, state });
    const loaded = loadProjectState({ dbPath, projectId: 'proj-roundtrip' });
    expect(loaded).toEqual(state);
  });

  it('returns null for a project that was never saved', () => {
    expect(loadProjectState({ dbPath, projectId: 'never-saved' })).toBeNull();
  });

  it('accepts saving revision N+1 over stored revision N', () => {
    saveProjectState({ dbPath, state: makeState({ project_id: 'proj-bump', state_revision: 1 }) });
    expect(() =>
      saveProjectState({ dbPath, state: makeState({ project_id: 'proj-bump', state_revision: 2 }) }),
    ).not.toThrow();
  });

  it('refuses to save revision N over stored revision N (monotonic guard)', () => {
    saveProjectState({ dbPath, state: makeState({ project_id: 'proj-stale', state_revision: 1 }) });
    expect(() =>
      saveProjectState({ dbPath, state: makeState({ project_id: 'proj-stale', state_revision: 1 }) }),
    ).toThrow();
  });

  it('isolates tenants: a state saved under tenant "a" is invisible to tenant "b" and visible to tenant "a"', () => {
    saveProjectState({
      dbPath,
      state: makeState({ project_id: 'proj-tenant' }),
      tenantId: 'a',
    });
    expect(loadProjectState({ dbPath, projectId: 'proj-tenant', tenantId: 'b' })).toBeNull();
    expect(loadProjectState({ dbPath, projectId: 'proj-tenant', tenantId: 'a' })).not.toBeNull();
  });

  it('lists project states ordered by updated_at DESC', () => {
    saveProjectState({
      dbPath,
      state: makeState({ project_id: 'proj-old' }),
      nowIso: '2026-01-01T00:00:00.000Z',
    });
    saveProjectState({
      dbPath,
      state: makeState({ project_id: 'proj-new' }),
      nowIso: '2026-01-02T00:00:00.000Z',
    });
    const list = listProjectStates({ dbPath });
    expect(list.map((r) => r.projectId)).toEqual(['proj-new', 'proj-old']);
  });
});
