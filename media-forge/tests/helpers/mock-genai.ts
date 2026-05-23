/**
 * Shared mock for @google/genai SDK used across image/video service tests.
 *
 * Usage:
 *   import { createMockGenAI } from '../helpers/mock-genai.js';
 *   const mock = createMockGenAI();
 *   mock.queueImageResponse({ base64: 'AAAA', mimeType: 'image/png' });
 *   const result = await yourService(mock.client);
 */

export interface MockImagePart {
  base64: string;
  mimeType: string;
}

export interface MockGenAIClient {
  models: {
    generateContent: (req: unknown) => Promise<unknown>;
    generateImages: (req: unknown) => Promise<unknown>;
    generateVideos: (req: unknown) => Promise<unknown>;
  };
  operations: {
    getVideosOperation: (req: unknown) => Promise<unknown>;
  };
  files: {
    download: (req: unknown) => Promise<void>;
  };
}

export interface MockGenAIInstance {
  client: MockGenAIClient;
  queueImageResponse: (img: MockImagePart) => void;
  queueImagenResponse: (images: MockImagePart[]) => void;
  queueVideoOperation: (operationName: string) => void;
  queueVideoComplete: (operationName: string, videoUri: string) => void;
  queueSafetyBlock: () => void;
  recordedCalls: { method: string; args: unknown }[];
}

export function createMockGenAI(): MockGenAIInstance {
  const imageQueue: MockImagePart[] = [];
  const imagenQueue: MockImagePart[][] = [];
  const videoOps: { name: string; done: boolean; videoUri?: string }[] = [];
  const safetyBlocks: boolean[] = [];
  const recordedCalls: { method: string; args: unknown }[] = [];

  const client: MockGenAIClient = {
    models: {
      generateContent: async (req: unknown) => {
        recordedCalls.push({ method: 'generateContent', args: req });
        if (safetyBlocks.shift()) {
          return {
            promptFeedback: { blockReason: 'SAFETY' },
            candidates: [],
          };
        }
        const next = imageQueue.shift();
        if (!next) throw new Error('Mock: no image response queued');
        return {
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [{ inlineData: { data: next.base64, mimeType: next.mimeType } }],
              },
            },
          ],
        };
      },
      generateImages: async (req: unknown) => {
        recordedCalls.push({ method: 'generateImages', args: req });
        const next = imagenQueue.shift();
        if (!next) throw new Error('Mock: no imagen response queued');
        return {
          generatedImages: next.map((img) => ({
            image: { imageBytes: img.base64, mimeType: img.mimeType },
          })),
        };
      },
      generateVideos: async (req: unknown) => {
        recordedCalls.push({ method: 'generateVideos', args: req });
        const op = videoOps.shift();
        if (!op) throw new Error('Mock: no video operation queued');
        return { name: op.name, done: op.done };
      },
    },
    operations: {
      getVideosOperation: async (req: unknown) => {
        recordedCalls.push({ method: 'getVideosOperation', args: req });
        const op = videoOps.shift();
        if (!op) {
          return {
            done: true,
            response: { generatedVideos: [{ video: { uri: 'mock://complete' } }] },
          };
        }
        return {
          name: op.name,
          done: op.done,
          response:
            op.done && op.videoUri
              ? { generatedVideos: [{ video: { uri: op.videoUri } }] }
              : undefined,
        };
      },
    },
    files: {
      download: async (req: unknown) => {
        recordedCalls.push({ method: 'files.download', args: req });
      },
    },
  };

  return {
    client,
    queueImageResponse: (img) => imageQueue.push(img),
    queueImagenResponse: (images) => imagenQueue.push(images),
    queueVideoOperation: (name) => videoOps.push({ name, done: false }),
    queueVideoComplete: (name, uri) => videoOps.push({ name, done: true, videoUri: uri }),
    queueSafetyBlock: () => safetyBlocks.push(true),
    recordedCalls,
  };
}
