import { describe, it, expect } from 'vitest';
import { safeJoin, slug, jobId } from '../../../src/utils/paths.js';
import { FileSystemError } from '../../../src/core/errors.js';

describe('safeJoin', () => {
  it('joins safely inside base', () => {
    const result = safeJoin('/tmp/base', 'sub', 'file.txt');
    expect(result).toMatch(/[\\/]base[\\/]sub[\\/]file\.txt$/);
  });

  it('rejects path traversal via ..', () => {
    expect(() => safeJoin('/tmp/base', '..', 'evil.txt')).toThrow(FileSystemError);
  });

  it('rejects path traversal via deep ..', () => {
    expect(() => safeJoin('/tmp/base', 'sub', '..', '..', 'evil.txt')).toThrow(FileSystemError);
  });
});

describe('slug', () => {
  it('converts to lowercase kebab', () => {
    expect(slug('Hello World')).toBe('hello-world');
  });

  it('strips diacritics', () => {
    expect(slug('Olá Mundo Açaí')).toBe('ola-mundo-acai');
  });

  it('truncates to maxLen', () => {
    expect(slug('a'.repeat(100), 10)).toBe('aaaaaaaaaa');
  });

  it('handles empty/whitespace input', () => {
    expect(slug('')).toBe('untitled');
    expect(slug('   ')).toBe('untitled');
  });

  it('collapses repeated separators', () => {
    expect(slug('hello   world!!!@@@foo')).toBe('hello-world-foo');
  });
});

describe('jobId', () => {
  it('generates unique IDs in tight loop', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(jobId());
    }
    expect(ids.size).toBe(100);
  });

  it('includes prefix when provided', () => {
    const id = jobId('product shot');
    expect(id).toMatch(/-product-shot$/);
  });

  it('matches expected format YYYYMMDDTHHmmssZ-<rand>', () => {
    const id = jobId();
    expect(id).toMatch(/^\d{8}T\d{6}Z-[a-z0-9]{6}$/);
  });
});
