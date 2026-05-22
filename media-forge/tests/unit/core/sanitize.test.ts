import { describe, it, expect } from 'vitest';
import { redactSecrets, sanitizePayload } from '../../../src/core/sanitize.js';

describe('redactSecrets', () => {
  it('redacts long string showing last 4 chars', () => {
    expect(redactSecrets('AIzaSyABCDEFGHIJKLMN1234')).toBe('****1234');
  });

  it('redacts short string as ****', () => {
    expect(redactSecrets('abc')).toBe('****');
    expect(redactSecrets('abcd')).toBe('****');
  });

  it('redacts empty string as ****', () => {
    expect(redactSecrets('')).toBe('****');
  });
});

describe('sanitizePayload', () => {
  it('redacts api_key, apiKey, gemini_api_key fields', () => {
    const out = sanitizePayload({
      api_key: 'AIzaSyABCDEFGHIJKLMN1234',
      apiKey: 'secret-value',
      gemini_api_key: 'xxxxxxxxx',
    });
    expect(out).toEqual({
      api_key: '****1234',
      apiKey: '****alue',
      gemini_api_key: '****xxxx',
    });
  });

  it('redacts nested Authorization, bearer, password fields', () => {
    const out = sanitizePayload({
      nested: {
        Authorization: 'Bearer xyz123abc456',
        password: 'hunter2',
        bearer: 'long-token-value',
      },
    });
    expect(out).toEqual({
      nested: {
        Authorization: '****c456',
        password: '****ter2',
        bearer: '****alue',
      },
    });
  });

  it('redacts secret + access_token + private_key + client_secret + gcs_credentials', () => {
    const out = sanitizePayload({
      secret: 'topsecret',
      access_token: 'token123',
      private_key: 'pk_abcdefgh',
      client_secret: 'cs_12345678',
      gcs_credentials: '{"key":"value-here"}',
    });
    expect(out).toEqual({
      secret: '****cret',
      access_token: '****n123',
      private_key: '****efgh',
      client_secret: '****5678',
      gcs_credentials: '****re"}',
    });
  });

  it('leaves non-secret fields unchanged', () => {
    expect(
      sanitizePayload({
        aspect_ratio: '1:1',
        image_size: '4K',
        prompt: 'hello',
        nested: { count: 5, foo: 'bar' },
      }),
    ).toEqual({
      aspect_ratio: '1:1',
      image_size: '4K',
      prompt: 'hello',
      nested: { count: 5, foo: 'bar' },
    });
  });

  it('handles arrays recursively', () => {
    const out = sanitizePayload({
      requests: [
        { api_key: 'AIzaSyABCDEFGHIJKLMN' },
        { prompt: 'hi' },
        { Authorization: 'Bearer secrettokenxyz' },
      ],
    });
    expect(out).toEqual({
      requests: [
        { api_key: '****KLMN' },
        { prompt: 'hi' },
        { Authorization: '****nxyz' },
      ],
    });
  });

  it('handles null and undefined safely', () => {
    expect(sanitizePayload(null)).toBeNull();
    expect(sanitizePayload(undefined)).toBeUndefined();
    expect(sanitizePayload({ api_key: null })).toEqual({ api_key: null });
    expect(sanitizePayload({ api_key: undefined })).toEqual({ api_key: undefined });
  });

  it('handles primitives passed at root', () => {
    expect(sanitizePayload(42)).toBe(42);
    expect(sanitizePayload('plain string')).toBe('plain string');
    expect(sanitizePayload(true)).toBe(true);
  });

  it('case-insensitive secret key matching', () => {
    const out = sanitizePayload({
      API_KEY: 'AIzaSyABCDEFGH',
      ApiKey: 'value-xyz',
      AUTHORIZATION: 'Bearer abc',
    });
    expect(out).toEqual({
      API_KEY: '****EFGH',
      ApiKey: '****-xyz',
      AUTHORIZATION: '**** abc',
    });
  });
});
