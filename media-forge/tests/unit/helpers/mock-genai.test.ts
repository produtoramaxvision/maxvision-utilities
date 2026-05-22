import { describe, it, expect } from 'vitest';
import { createMockGenAI } from '../../helpers/mock-genai.js';

describe('createMockGenAI', () => {
  it('returns image part when queued', async () => {
    const mock = createMockGenAI();
    mock.queueImageResponse({ base64: 'AAAA', mimeType: 'image/png' });
    const r = (await mock.client.models.generateContent({})) as {
      candidates: Array<{
        content: { parts: Array<{ inlineData: { data: string; mimeType: string } }> };
      }>;
    };
    expect(r.candidates[0]?.content.parts[0]?.inlineData.data).toBe('AAAA');
  });

  it('returns safety block when queued', async () => {
    const mock = createMockGenAI();
    mock.queueSafetyBlock();
    const r = (await mock.client.models.generateContent({})) as {
      promptFeedback?: { blockReason: string };
    };
    expect(r.promptFeedback?.blockReason).toBe('SAFETY');
  });

  it('records calls for assertion', async () => {
    const mock = createMockGenAI();
    mock.queueImageResponse({ base64: 'AAAA', mimeType: 'image/png' });
    await mock.client.models.generateContent({ model: 'x', prompt: 'hi' });
    expect(mock.recordedCalls).toHaveLength(1);
    expect(mock.recordedCalls[0]?.method).toBe('generateContent');
  });

  it('Imagen 4 multi-image response', async () => {
    const mock = createMockGenAI();
    mock.queueImagenResponse([
      { base64: 'A1', mimeType: 'image/png' },
      { base64: 'A2', mimeType: 'image/png' },
    ]);
    const r = (await mock.client.models.generateImages({})) as {
      generatedImages: Array<{ image: { imageBytes: string } }>;
    };
    expect(r.generatedImages).toHaveLength(2);
    expect(r.generatedImages[1]?.image.imageBytes).toBe('A2');
  });
});
