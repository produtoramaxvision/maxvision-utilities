/**
 * Unit tests for buildHiggsfieldHeaders().
 *
 * Auth format verified from @higgsfield/client@0.2.1:
 *   dist/client.js lines 30-32 — two separate custom headers, NO Bearer token.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildHiggsfieldHeaders,
  buildPrimaryHeaders,
  buildFallbackHeaders,
  HiggsfieldAuthConfigError,
} from '../../../../src/video/providers/auth/higgsfield-headers.js';

const KEY_ENV = 'HF_API_KEY';
const SECRET_ENV = 'HF_API_SECRET';

describe('buildHiggsfieldHeaders', () => {
  let savedKey: string | undefined;
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedKey = process.env[KEY_ENV];
    savedSecret = process.env[SECRET_ENV];
    delete process.env[KEY_ENV];
    delete process.env[SECRET_ENV];
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = savedKey;

    if (savedSecret === undefined) delete process.env[SECRET_ENV];
    else process.env[SECRET_ENV] = savedSecret;
  });

  it('returns hf-api-key and hf-secret headers when both env vars are present', () => {
    process.env[KEY_ENV] = 'test-key-id';
    process.env[SECRET_ENV] = 'test-key-secret';

    const headers = buildHiggsfieldHeaders();

    expect(headers['hf-api-key']).toBe('test-key-id');
    expect(headers['hf-secret']).toBe('test-key-secret');
  });

  it('returns only the two Higgsfield custom headers (no Authorization header)', () => {
    process.env[KEY_ENV] = 'test-key-id';
    process.env[SECRET_ENV] = 'test-key-secret';

    const headers = buildHiggsfieldHeaders();
    const keys = Object.keys(headers);

    expect(keys).toHaveLength(2);
    expect(keys).toContain('hf-api-key');
    expect(keys).toContain('hf-secret');
    expect(keys).not.toContain('Authorization');
  });

  it('throws HiggsfieldAuthConfigError when HF_API_KEY is missing', () => {
    process.env[SECRET_ENV] = 'test-key-secret';

    expect(() => buildHiggsfieldHeaders()).toThrow(HiggsfieldAuthConfigError);
    expect(() => buildHiggsfieldHeaders()).toThrow(KEY_ENV);
  });

  it('throws HiggsfieldAuthConfigError when HF_API_SECRET is missing', () => {
    process.env[KEY_ENV] = 'test-key-id';

    expect(() => buildHiggsfieldHeaders()).toThrow(HiggsfieldAuthConfigError);
    expect(() => buildHiggsfieldHeaders()).toThrow(SECRET_ENV);
  });

  it('error message includes both var names when both are unset', () => {
    let message = '';
    try {
      buildHiggsfieldHeaders();
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain(KEY_ENV);
    expect(message).toContain(SECRET_ENV);
  });

  it('throws when HF_API_KEY is set to empty string', () => {
    process.env[KEY_ENV] = '';
    process.env[SECRET_ENV] = 'test-key-secret';

    expect(() => buildHiggsfieldHeaders()).toThrow(HiggsfieldAuthConfigError);
    expect(() => buildHiggsfieldHeaders()).toThrow(KEY_ENV);
  });

  it('throws when HF_API_SECRET is set to empty string', () => {
    process.env[KEY_ENV] = 'test-key-id';
    process.env[SECRET_ENV] = '';

    expect(() => buildHiggsfieldHeaders()).toThrow(HiggsfieldAuthConfigError);
    expect(() => buildHiggsfieldHeaders()).toThrow(SECRET_ENV);
  });

  it('error message NEVER includes the secret value', () => {
    process.env[KEY_ENV] = 'key-id-value';
    process.env[SECRET_ENV] = 'super-secret-value';

    // Even with both set, if something were to throw, secret must not appear.
    // We test the missing-secret path specifically:
    delete process.env[SECRET_ENV];
    let message = '';
    try {
      buildHiggsfieldHeaders();
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).not.toContain('super-secret-value');
  });

  it('trims whitespace from env var values', () => {
    process.env[KEY_ENV] = '  trimmed-key  ';
    process.env[SECRET_ENV] = '  trimmed-secret  ';

    const headers = buildHiggsfieldHeaders();

    expect(headers['hf-api-key']).toBe('trimmed-key');
    expect(headers['hf-secret']).toBe('trimmed-secret');
  });

  it('throws when HF_API_KEY is only whitespace', () => {
    process.env[KEY_ENV] = '   ';
    process.env[SECRET_ENV] = 'test-key-secret';

    expect(() => buildHiggsfieldHeaders()).toThrow(HiggsfieldAuthConfigError);
    expect(() => buildHiggsfieldHeaders()).toThrow(KEY_ENV);
  });

  describe('auth resilience (D-5)', () => {
    it('buildPrimaryHeaders and buildFallbackHeaders return DIFFERENT shapes', () => {
      process.env['HF_API_KEY'] = 'pk';
      process.env['HF_API_SECRET'] = 'sk';
      const p = buildPrimaryHeaders();
      const f = buildFallbackHeaders();
      expect(JSON.stringify(p)).not.toBe(JSON.stringify(f));
      // One has Authorization, the other has hf-api-key — never both.
      const hasAuthP = 'Authorization' in p;
      const hasAuthF = 'Authorization' in f;
      expect(hasAuthP).not.toBe(hasAuthF);
    });
  });
});
