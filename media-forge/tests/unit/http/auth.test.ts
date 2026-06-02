// Migrado de F-A: testa a logica plana via FlatKeyStore (que e o que F-A usava).
// resolveAuth async e testado em auth-fc.test.ts (Task 5).
import { describe, it, expect } from 'vitest';
import { FlatKeyStore } from '../../../src/http/key-store.js';

describe('FlatKeyStore (lógica plana de F-A)', () => {
  const store = new FlatKeyStore('key-aaa,key-bbb');

  it('aceita key válida → tier pro + tenantId self', async () => {
    const r = await store.resolve('key-aaa');
    expect(r).not.toBeNull();
    expect(r!.tier).toBe('pro');
    expect(r!.tenantId).toBe('self');
  });

  it('rejeita key desconhecida', async () => {
    expect(await store.resolve('nope')).toBeNull();
  });

  it('rejeita string vazia', async () => {
    expect(await store.resolve('')).toBeNull();
  });
});
