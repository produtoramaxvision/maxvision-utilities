import { describe, it, expect, vi } from 'vitest';

const sendMock = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: sendMock })),
  InvokeModelCommand: vi.fn((x) => x),
}));

import { embedVideos } from '../../../src/refs/marengo-embed.js';

describe('marengo-embed', () => {
  it('embeds video buffer and returns 512-dim vector', async () => {
    sendMock.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({ data: [{ embedding: Array(512).fill(0.05) }] }),
      ),
    });
    const out = await embedVideos([Buffer.from('fake-clip')], { region: 'us-east-1' });
    expect(out).toHaveLength(1);
    expect(out[0].vector.length).toBe(512);
    expect(out[0].vector[0]).toBeCloseTo(0.05);
  });
});
