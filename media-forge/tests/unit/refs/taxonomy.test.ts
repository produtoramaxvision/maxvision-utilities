import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  isCategory,
  normalizeCategory,
  resolveAliases,
  getFilmlingoHint,
} from '../../../src/refs/taxonomy.js';

describe('taxonomy', () => {
  it('CATEGORIES contains all 136 known prefixes', () => {
    expect(CATEGORIES.length).toBe(136);
    expect(CATEGORIES).toContain('dolly-zoom');
    expect(CATEGORIES).toContain('bullet-time');
    expect(CATEGORIES).toContain('slow-motion');
    expect(CATEGORIES).toContain('whip-pan');
  });

  it('isCategory returns true for known prefixes, false otherwise', () => {
    expect(isCategory('dolly-zoom')).toBe(true);
    expect(isCategory('not-a-real-effect')).toBe(false);
  });

  it('normalizeCategory canonicalises spaces, underscores, and case', () => {
    expect(normalizeCategory('Dolly Zoom')).toBe('dolly-zoom');
    expect(normalizeCategory('bullet_time')).toBe('bullet-time');
    expect(normalizeCategory('  Slow-Motion  ')).toBe('slow-motion');
  });

  it('resolveAliases maps common synonyms to canonical category', () => {
    expect(resolveAliases('vertigo-effect')).toBe('dolly-zoom');
    expect(resolveAliases('matrix-shot')).toBe('bullet-time');
    expect(resolveAliases('dolly-zoom')).toBe('dolly-zoom');
    expect(resolveAliases('unknown-thing')).toBe(null);
  });

  it('getFilmlingoHint returns structured hint for known category', () => {
    const hint = getFilmlingoHint('dolly-zoom');
    expect(hint).not.toBeNull();
    expect(hint!.canonicalTerms).toContain('dolly zoom');
    expect(hint!.lens).toBeDefined();
    expect(hint!.referenceFilms.length).toBeGreaterThan(0);
  });

  it('getFilmlingoHint returns null for unknown category', () => {
    expect(getFilmlingoHint('not-a-category')).toBeNull();
  });
});
