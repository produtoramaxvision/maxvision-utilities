import { describe, it, expect } from 'vitest';
import { runBoundedLoop, assertWithinCap } from '../../../src/narrative/agents/bounds.js';

describe('runBoundedLoop', () => {
  it('returns the collected values once a step signals isLast', async () => {
    const seen: number[] = [];
    const result = await runBoundedLoop({
      label: 'test-loop',
      step: async (iteration) => {
        seen.push(iteration);
        return { value: iteration, isLast: iteration === 2 };
      },
    });
    expect(result).toEqual([0, 1, 2]);
    expect(seen).toEqual([0, 1, 2]);
  });

  it(
    'throws after maxIterations when isLast is never signalled, without hanging, ' +
      'and the message says raising the bound is not the fix',
    async () => {
      // This is the plan's central defensive requirement: the loop's only exit
      // condition is a flag the model returns. A model that never sets it is an
      // ordinary model failure, not an edge case, so the loop must terminate on
      // its own rather than spin forever waiting for a flag that never comes.
      let calls = 0;
      await expect(
        runBoundedLoop({
          label: 'runaway-loop',
          maxIterations: 5,
          step: async () => {
            calls += 1;
            return { value: 0, isLast: false };
          },
        }),
      ).rejects.toThrow(/raising it is not the fix/);
      // Exactly the bound, not more and not fewer — proves the loop actually
      // stopped itself rather than being cut off by the test's own timeout.
      expect(calls).toBe(5);
    },
  );
});

describe('assertWithinCap', () => {
  it('passes when the collection is exactly at the cap', () => {
    const items = [1, 2, 3];
    expect(() => assertWithinCap({ items, cap: 3, what: 'test items' })).not.toThrow();
  });

  it('throws naming the cap when the collection exceeds it, without truncating', () => {
    const items = [1, 2, 3, 4, 5];
    let caught: unknown;
    try {
      assertWithinCap({ items, cap: 3, what: 'test items' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('got 5, cap is 3');
    // A truncating implementation would silently hand the caller a shortened
    // array with no error explaining the missing tail. This function must
    // instead leave the caller's original array untouched and throw.
    expect(items).toHaveLength(5);
  });
});
