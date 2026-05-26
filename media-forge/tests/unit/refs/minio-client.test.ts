import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are available when vi.mock factories run (hoisted to top).
const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

// Mock @aws-sdk/client-s3 before importing module under test
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  ListObjectsV2Command: vi.fn().mockImplementation((input) => ({ input })),
  HeadObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}));

import { createMinioClient } from '../../../src/refs/minio-client.js';

const cfg = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  accessKey: 'KEY',
  secretKey: 'SECRET',
  bucket: 'media-forge-refs',
  useSsl: true,
};

describe('minio-client', () => {
  beforeEach(() => {
    sendMock.mockReset();
    getSignedUrlMock.mockReset();
  });

  it('listObjects returns object keys + sizes for a category prefix', async () => {
    sendMock.mockResolvedValueOnce({
      Contents: [
        { Key: 'dolly-zoom/aaa.gif', Size: 1000, ETag: '"e1"' },
        { Key: 'dolly-zoom/bbb.webp', Size: 2000, ETag: '"e2"' },
      ],
      IsTruncated: false,
    });
    const client = createMinioClient(cfg);
    const result = await client.listObjects('dolly-zoom/', 100);
    expect(result.objects).toHaveLength(2);
    expect(result.objects[0].key).toBe('dolly-zoom/aaa.gif');
    expect(result.objects[0].size).toBe(1000);
    expect(result.truncated).toBe(false);
  });

  it('listObjects throws on missing access credentials', async () => {
    const client = createMinioClient({ ...cfg, accessKey: undefined, secretKey: undefined });
    await expect(client.listObjects('dolly-zoom/')).rejects.toThrow(/credentials/i);
  });

  it('presignObject returns signed URL with requested TTL', async () => {
    getSignedUrlMock.mockResolvedValueOnce('https://s3.example.com/signed?ttl=3000');
    const client = createMinioClient(cfg);
    const url = await client.presignObject('dolly-zoom/aaa.gif', 3000);
    expect(url).toBe('https://s3.example.com/signed?ttl=3000');
    expect(getSignedUrlMock).toHaveBeenCalled();
  });

  it('downloadObject pipes the SDK response body to a Buffer', async () => {
    const chunk = Buffer.from('GIF87a-fake-payload');
    sendMock.mockResolvedValueOnce({
      Body: {
        async *[Symbol.asyncIterator]() {
          yield chunk;
        },
      } as never,
    });
    const client = createMinioClient(cfg);
    const buf = await client.downloadObject('dolly-zoom/aaa.gif');
    expect(buf.equals(chunk)).toBe(true);
  });
});
