import { describe, it, expect } from 'vitest';
import { MEDIA_FORGE_VERSION } from '../../src/index.js';

describe('smoke', () => {
  it('exports MEDIA_FORGE_VERSION constant', () => {
    expect(MEDIA_FORGE_VERSION).toBe('0.1.0');
  });

  it('MEDIA_FORGE_VERSION is a string literal', () => {
    expect(typeof MEDIA_FORGE_VERSION).toBe('string');
  });
});
