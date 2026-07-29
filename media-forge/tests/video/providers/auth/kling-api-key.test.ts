import { describe, it, expect, beforeEach } from 'vitest';
import {
  getKlingAuthHeader,
  __resetKlingJwtCache,
  KlingAuthConfigError,
  type KlingEnvSubset,
} from '../../../../src/video/providers/auth/kling-jwt.js';

describe('getKlingAuthHeader — dual-mode auth (API 2.0 static key vs legacy AccessKey/SecretKey)', () => {
  beforeEach(() => {
    __resetKlingJwtCache();
  });

  it('KLING_API_KEY alone → exact "Bearer <key>" string', () => {
    const env: KlingEnvSubset = { KLING_API_KEY: 'my-static-api-key' };
    const header = getKlingAuthHeader(env);
    expect(header.Authorization).toBe('Bearer my-static-api-key');
  });

  it('KLING_API_KEY set AND AccessKey/SecretKey also set → API key wins, not a JWT', () => {
    const env: KlingEnvSubset = {
      KLING_API_KEY: 'static-key-wins',
      KLING_ACCESS_KEY: 'ak_should_be_ignored',
      KLING_SECRET_KEY: 'sk_should_be_ignored',
    };
    const header = getKlingAuthHeader(env);
    expect(header.Authorization).toBe('Bearer static-key-wins');
    const token = header.Authorization.replace(/^Bearer /, '');
    // A JWT is 3 dot-separated segments; the raw API key must have no dots.
    expect(token).not.toContain('.');
  });

  it('API key path does not populate the cache: second call with a changed key returns the new key', () => {
    const first = getKlingAuthHeader({ KLING_API_KEY: 'key-one' } as KlingEnvSubset);
    expect(first.Authorization).toBe('Bearer key-one');

    const second = getKlingAuthHeader({ KLING_API_KEY: 'key-two' } as KlingEnvSubset);
    // If the API-key path wrote to tokenCache, a cache lookup keyed on something
    // stable (or a stale entry) could return "key-one" again. It must not.
    expect(second.Authorization).toBe('Bearer key-two');
  });

  it('whitespace-only KLING_API_KEY falls through to the JWT path', () => {
    const env: KlingEnvSubset = {
      KLING_API_KEY: '   ',
      KLING_ACCESS_KEY: 'ak_fallthrough',
      KLING_SECRET_KEY: 'sk_fallthrough',
    };
    const header = getKlingAuthHeader(env);
    const token = header.Authorization.replace(/^Bearer /, '');
    expect(token.split('.')).toHaveLength(3); // JWT shape: header.payload.signature
  });

  it('AccessKey/SecretKey only → unchanged JWT behavior, still cached', () => {
    const env: KlingEnvSubset = {
      KLING_ACCESS_KEY: 'ak_legacy_cache',
      KLING_SECRET_KEY: 'sk_legacy_cache',
    };
    const first = getKlingAuthHeader(env).Authorization;
    expect(first.split(' ')[1]?.split('.')).toHaveLength(3);

    const second = getKlingAuthHeader(env).Authorization;
    expect(second).toBe(first); // cache hit — same JWT re-used
  });

  it('no env at all → KlingAuthConfigError naming all three variables', () => {
    try {
      getKlingAuthHeader({} as KlingEnvSubset);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(KlingAuthConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain('KLING_API_KEY');
      expect(msg).toContain('KLING_ACCESS_KEY');
      expect(msg).toContain('KLING_SECRET_KEY');
    }
  });

  it('error message contains none of the key VALUES passed in', () => {
    try {
      getKlingAuthHeader({
        KLING_ACCESS_KEY: 'ak_secret_value_123',
        KLING_SECRET_KEY: '',
      } as KlingEnvSubset);
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain('ak_secret_value_123');
    }
  });
});
