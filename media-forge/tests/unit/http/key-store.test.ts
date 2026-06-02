import { describe, it, expect } from 'vitest';
import { hashKey } from '../../../src/http/key-store.js';

describe('hashKey', () => {
  const pepper = 'test-pepper-1234';

  it('produz hex 64 chars', () => {
    expect(hashKey('my-raw-key', pepper)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('determinístico — mesma key+pepper → mesmo hash', () => {
    expect(hashKey('key-aaa', pepper)).toBe(hashKey('key-aaa', pepper));
  });

  it('sensível à key — keys diferentes → hashes diferentes', () => {
    expect(hashKey('key-aaa', pepper)).not.toBe(hashKey('key-bbb', pepper));
  });

  it('sensível ao pepper — peppers diferentes → hashes diferentes', () => {
    expect(hashKey('key-aaa', 'pepper-A')).not.toBe(hashKey('key-aaa', 'pepper-B'));
  });
});
