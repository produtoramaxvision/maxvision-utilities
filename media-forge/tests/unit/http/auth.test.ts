import { describe, it, expect } from 'vitest';
import { resolveAuth } from '../../../src/http/auth.js';

describe('resolveAuth', () => {
  const env = { MEDIA_FORGE_API_KEYS: 'key-aaa,key-bbb' } as NodeJS.ProcessEnv;

  it('aceita Bearer com chave válida', () => {
    const r = resolveAuth('Bearer key-aaa', env);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.apiKey).toBe('key-aaa');
  });

  it('rejeita header ausente', () => {
    expect(resolveAuth(undefined, env).ok).toBe(false);
  });

  it('rejeita chave desconhecida', () => {
    expect(resolveAuth('Bearer nope', env).ok).toBe(false);
  });

  it('rejeita esquema não-Bearer', () => {
    expect(resolveAuth('Basic key-aaa', env).ok).toBe(false);
  });
});
