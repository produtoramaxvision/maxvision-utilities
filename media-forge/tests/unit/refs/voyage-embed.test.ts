import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { embedImages, VoyageCircuitOpenError, _resetCircuitForTests } from '../../../src/refs/voyage-embed.js';

describe('embedImages (Voyage Multimodal-3)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    _resetCircuitForTests();
  });

  it('batches multiple JPEGs into one HTTP call', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ embedding: Array(1024).fill(0.1) }, { embedding: Array(1024).fill(0.2) }],
        usage: { total_tokens: 2000 },
      }),
    });
    const results = await embedImages([Buffer.from('img1'), Buffer.from('img2')], 'KEY');
    expect(results).toHaveLength(2);
    expect(results[0].vector.length).toBe(1024);
    expect(results[0].vector[0]).toBeCloseTo(0.1);
  });

  it('throws on non-200 non-transient response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });
    await expect(embedImages([Buffer.from('x')], 'KEY')).rejects.toThrow(/400|bad request/);
  });

  it('retries on 429, succeeds on 2nd attempt', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: Array(1024).fill(0.5) }] }),
      });
    const results = await embedImages([Buffer.from('x')], 'KEY');
    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws VoyageCircuitOpenError after CIRCUIT_BREAK_THRESHOLD consecutive failures', async () => {
    // 5 consecutive 400 errors trip the circuit
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    for (let i = 0; i < 5; i++) {
      await expect(embedImages([Buffer.from('x')], 'KEY')).rejects.toThrow(/400|bad/);
    }
    // 6th call: circuit is open
    await expect(embedImages([Buffer.from('x')], 'KEY')).rejects.toThrow(VoyageCircuitOpenError);
  });
});
