import { describe, it, expect } from 'vitest';
import { render } from '../../../src/prompts/template-renderer.js';
import { ValidationError } from '../../../src/core/errors.js';

describe('template-renderer', () => {
  // 1. Basic substitution
  it('substitutes a simple variable', () => {
    const result = render({
      template: 'Hello ${name}!',
      vars: { name: 'world' },
    });
    expect(result.rendered).toBe('Hello world!');
    expect(result.usedVars).toContain('name');
    expect(result.missingRequired).toHaveLength(0);
  });

  // 2. Default fallback when var absent
  it('falls back to default when var is not supplied', () => {
    const result = render({
      template: 'Angle: ${angle}.',
      vars: {},
      variableDefs: [{ name: 'angle', required: false, default: 'three-quarter view' }],
    });
    expect(result.rendered).toBe('Angle: three-quarter view.');
  });

  // 3. Missing required throws ValidationError
  it('throws ValidationError when required var is missing', () => {
    expect(() =>
      render({
        template: 'Subject: ${subject}.',
        vars: {},
        variableDefs: [{ name: 'subject', required: true }],
      }),
    ).toThrow(ValidationError);
  });

  // 4. Strict mode: extra var → throws
  it('throws in strict mode when extra var is provided', () => {
    expect(() =>
      render({
        template: 'Hello ${name}.',
        vars: { name: 'world', extra: 'oops' },
        variableDefs: [{ name: 'name', required: false }],
        strict: true,
      }),
    ).toThrow(ValidationError);
  });

  // 5. Non-strict mode: extra var is silently ignored
  it('ignores extra vars in non-strict mode', () => {
    const result = render({
      template: 'Hello ${name}.',
      vars: { name: 'world', extra: 'ignored' },
      variableDefs: [{ name: 'name', required: false }],
      strict: false,
    });
    expect(result.rendered).toBe('Hello world.');
  });

  // 6. Multi-line template preserves newlines
  it('preserves newlines in multi-line template', () => {
    const tpl = 'Line 1: ${a}\nLine 2: ${b}\nLine 3.';
    const result = render({ template: tpl, vars: { a: 'foo', b: 'bar' } });
    expect(result.rendered).toBe('Line 1: foo\nLine 2: bar\nLine 3.');
  });

  // 7. Repeated ${var} — all occurrences replaced
  it('replaces all occurrences of a repeated variable', () => {
    const result = render({
      template: '${x} and ${x} and ${x}',
      vars: { x: 'cat' },
    });
    expect(result.rendered).toBe('cat and cat and cat');
  });

  // 8. ${var} literal preserved when not in variableDefs and not strict
  it('preserves literal ${var} when variable is not declared in variableDefs', () => {
    const result = render({
      template: 'Keep ${unknown} as-is.',
      vars: {},
      variableDefs: [],
      strict: false,
    });
    expect(result.rendered).toBe('Keep ${unknown} as-is.');
  });

  // 9. Non-required var with no value and no default → empty string (not literal)
  it('substitutes empty string for non-required declared var with no value or default', () => {
    const result = render({
      template: 'Before${optional}After',
      vars: {},
      variableDefs: [{ name: 'optional', required: false }],
    });
    expect(result.rendered).toBe('BeforeAfter');
  });

  // 10. Missing required error message includes the var name
  it('ValidationError message contains the missing var name', () => {
    let caught: unknown;
    try {
      render({
        template: '${subject}',
        vars: {},
        variableDefs: [{ name: 'subject', required: true }],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).toContain('subject');
  });

  // 11. Multiple missing required vars all collected
  it('reports all missing required vars in a single throw', () => {
    let caught: unknown;
    try {
      render({
        template: '${a} and ${b}',
        vars: {},
        variableDefs: [
          { name: 'a', required: true },
          { name: 'b', required: true },
        ],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const ctx = (caught as ValidationError).context as { path: string[] };
    expect(ctx.path).toContain('a');
    expect(ctx.path).toContain('b');
  });
});
