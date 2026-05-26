import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logUnresolvedAlias, suggestNewAliases } from '../../../src/refs/aliases-learn.js';

describe('aliases-learn', () => {
  it('logs unresolved phrase with timestamp + brief context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-al-'));
    const logPath = join(dir, 'aliases-learn.jsonl');
    await logUnresolvedAlias({
      logPath,
      phrase: 'cyberpunk grade',
      briefSnippet: 'tense scene with cyberpunk grade',
      candidateMatches: ['color-shift', 'glitch', 'vhs'],
    });
    const content = await readFile(logPath, 'utf8');
    const record = JSON.parse(content.trim());
    expect(record.phrase).toBe('cyberpunk grade');
    expect(record.candidateMatches).toContain('color-shift');
  });

  it('suggestNewAliases returns phrases hit >=N times with top candidate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-al-'));
    const logPath = join(dir, 'aliases-learn.jsonl');
    for (let i = 0; i < 5; i++) {
      await logUnresolvedAlias({
        logPath, phrase: 'cyberpunk grade', briefSnippet: '',
        candidateMatches: ['color-shift', 'glitch'],
      });
    }
    await logUnresolvedAlias({
      logPath, phrase: 'one-off thing', briefSnippet: '', candidateMatches: ['close-up'],
    });
    const suggestions = await suggestNewAliases(logPath, { minHits: 5 });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].phrase).toBe('cyberpunk grade');
    expect(suggestions[0].hits).toBe(5);
    expect(suggestions[0].topCandidate).toBe('color-shift');
  });
});
