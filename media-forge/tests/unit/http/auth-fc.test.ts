import { describe, it, expect } from 'vitest';
import { resolveAuth } from '../../../src/http/auth.js';
import type { IKeyStore, KeyRecord } from '../../../src/http/key-store.js';

const makeStore = (map: Record<string, KeyRecord>): IKeyStore => ({
  async resolve(k: string) {
    return map[k] ?? null;
  },
});

const store = makeStore({
  'key-creator': { tenantId: 'tenant-1', tier: 'creator', scopes: [] },
  'key-free': { tenantId: 'tenant-2', tier: 'free', scopes: [] },
  'key-pro': { tenantId: 'tenant-3', tier: 'pro', scopes: ['image', 'video'] },
});

describe('resolveAuth async', () => {
  it('aceita Bearer válido → AuthContext com tenantId+tier+scopes', async () => {
    const r = await resolveAuth('Bearer key-creator', store);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.tenantId).toBe('tenant-1');
      expect(r.ctx.tier).toBe('creator');
      expect(r.ctx.apiKey).toBe('key-creator');
    }
  });

  it('rejeita header ausente', async () => {
    const r = await resolveAuth(undefined, store);
    expect(r.ok).toBe(false);
  });

  it('rejeita key desconhecida', async () => {
    const r = await resolveAuth('Bearer nope', store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('unknown');
  });

  it('rejeita esquema não-Bearer', async () => {
    const r = await resolveAuth('Basic key-creator', store);
    expect(r.ok).toBe(false);
  });

  it('free tier: tenantId e scopes presentes', async () => {
    const r = await resolveAuth('Bearer key-free', store);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ctx.tier).toBe('free');
      expect(Array.isArray(r.ctx.scopes)).toBe(true);
    }
  });

  it('pro tier: scopes retornados do store', async () => {
    const r = await resolveAuth('Bearer key-pro', store);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ctx.scopes).toEqual(['image', 'video']);
  });
});
