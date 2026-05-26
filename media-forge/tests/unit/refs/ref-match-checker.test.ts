import { describe, it, expect, vi } from 'vitest';
import { computeRefMatchScore } from '../../../src/refs/ref-match-checker.js';

const embedMock = vi.fn();
vi.mock('../../../src/refs/voyage-embed.js', () => ({
  embedImages: (...a: unknown[]) => embedMock(...a),
}));

function unitVec(seed: number): Float32Array {
  const v = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) v[i] = (i + seed) % 7;
  // normalise
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  for (let i = 0; i < 1024; i++) v[i] /= n;
  return v;
}

describe('computeRefMatchScore', () => {
  it('returns ~1.0 when frame and moodboard are identical', async () => {
    const v = unitVec(0);
    embedMock.mockResolvedValueOnce([{ vector: v }, { vector: v }]);
    const score = await computeRefMatchScore(Buffer.from('a'), Buffer.from('a'), 'KEY');
    expect(score).toBeCloseTo(1.0, 3);
  });

  it('returns < 0.99 for orthogonal-ish vectors', async () => {
    embedMock.mockResolvedValueOnce([{ vector: unitVec(0) }, { vector: unitVec(500) }]);
    const score = await computeRefMatchScore(Buffer.from('a'), Buffer.from('b'), 'KEY');
    expect(score).toBeLessThan(0.99);
  });
});
