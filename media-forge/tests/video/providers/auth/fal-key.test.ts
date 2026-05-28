import { describe, it, expect } from 'vitest';
import { getFalApiKey, FalAuthConfigError } from '../../../../src/video/providers/auth/fal-key.js';

describe('getFalApiKey', () => {
  it('returns trimmed FAL_KEY when env var is set', () => {
    expect(getFalApiKey({ FAL_KEY: 'fal_pub_abc123' })).toBe('fal_pub_abc123');
  });

  it('trims surrounding whitespace', () => {
    expect(getFalApiKey({ FAL_KEY: '  fal_pub_xyz  ' })).toBe('fal_pub_xyz');
  });

  it('throws FalAuthConfigError when FAL_KEY is missing', () => {
    expect(() => getFalApiKey({})).toThrow(FalAuthConfigError);
  });

  it('throws FalAuthConfigError when FAL_KEY is empty string', () => {
    expect(() => getFalApiKey({ FAL_KEY: '' })).toThrow(FalAuthConfigError);
  });

  it('throws FalAuthConfigError when FAL_KEY is only whitespace', () => {
    expect(() => getFalApiKey({ FAL_KEY: '   ' })).toThrow(FalAuthConfigError);
  });

  it('error message references FAL_KEY env var name + fal.ai dashboard URL', () => {
    try {
      getFalApiKey({});
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('FAL_KEY');
      expect(msg).toContain('fal.ai');
    }
  });

  it('never echoes the secret value in error messages (security invariant)', () => {
    const err = (() => {
      try {
        getFalApiKey({ FAL_KEY: '' });
      } catch (e) {
        return e as Error;
      }
      throw new Error('unreached');
    })();
    expect(err.message).not.toContain('fal_pub_');
  });
});
