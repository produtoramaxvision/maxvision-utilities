import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { formatZodError, prettyZodError, treeZodError, flatZodError } from '../../../src/core/zod-formatter.js';

describe('formatZodError', () => {
  it('formats invalid_type with expected/received', () => {
    const schema = z.object({ name: z.string() });
    const r = schema.safeParse({ name: 123 });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.field).toBe('name');
    expect(errors[0]?.code).toBe('invalid_type');
    expect(errors[0]?.expected).toBe('string');
    // Zod v3.25 reports received as the TYPE NAME on auto-generated issues; v4 reports the raw value via input.
    expect(errors[0]?.received).toBeDefined();
  });

  it('formats invalid_value/invalid_enum_value with expected enum list', () => {
    const schema = z.object({ size: z.enum(['1K', '2K', '4K']) });
    const r = schema.safeParse({ size: '8K' });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.field).toBe('size');
    expect(errors[0]?.received).toBe('8K');
    expect(errors[0]?.expected).toContain('"1K"');
    expect(errors[0]?.expected).toContain('"4K"');
  });

  it('formats too_big with upper bound', () => {
    const schema = z.object({ arr: z.array(z.string()).max(3) });
    const r = schema.safeParse({ arr: ['a', 'b', 'c', 'd'] });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.expected).toBe('<= 3');
  });

  it('formats too_small with lower bound', () => {
    const schema = z.object({ prompt: z.string().min(5) });
    const r = schema.safeParse({ prompt: 'hi' });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.expected).toBe('>= 5');
  });

  it('formats unrecognized_keys with expected="no extra keys"', () => {
    const schema = z.object({ x: z.string() }).strict();
    const r = schema.safeParse({ x: 'ok', extra: 'ghost' });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    const unk = errors.find((e) => e.code === 'unrecognized_keys');
    expect(unk).toBeDefined();
    expect(unk?.expected).toBe('no extra keys');
  });

  it('formats custom error (superRefine) with field path', () => {
    const schema = z
      .object({ a: z.string(), b: z.string() })
      .superRefine((v, ctx) => {
        if (v.a === v.b) {
          ctx.addIssue({
            code: 'custom',
            path: ['b'],
            message: 'a and b must differ',
            input: v.b,
          });
        }
      });
    const r = schema.safeParse({ a: 'same', b: 'same' });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.field).toBe('b');
    expect(errors[0]?.code).toBe('custom');
    expect(errors[0]?.received).toBe('same');
  });

  it('handles nested path correctly', () => {
    const schema = z.object({ outer: z.object({ inner: z.string() }) });
    const r = schema.safeParse({ outer: { inner: 42 } });
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.field).toBe('outer.inner');
  });

  it('returns "(root)" for top-level errors', () => {
    const schema = z.string();
    const r = schema.safeParse(123);
    expect(r.success).toBe(false);
    const errors = formatZodError(r.error!);
    expect(errors[0]?.field).toBe('(root)');
  });
});

describe('prettyZodError', () => {
  it('returns non-empty string', () => {
    const schema = z.object({ name: z.string() });
    const r = schema.safeParse({ name: 42 });
    expect(r.success).toBe(false);
    const out = prettyZodError(r.error!);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('treeZodError', () => {
  it('returns a value (object tree or formatted array fallback)', () => {
    const schema = z.object({ name: z.string() });
    const r = schema.safeParse({ name: 42 });
    expect(r.success).toBe(false);
    const tree = treeZodError(r.error!);
    expect(tree).toBeDefined();
  });
});

describe('flatZodError', () => {
  it('returns formErrors + fieldErrors shape', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const r = schema.safeParse({ name: 42, age: 'old' });
    expect(r.success).toBe(false);
    const flat = flatZodError(r.error!);
    expect(flat).toHaveProperty('formErrors');
    expect(flat).toHaveProperty('fieldErrors');
  });
});
