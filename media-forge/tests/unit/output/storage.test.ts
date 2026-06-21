import { describe, it, expect } from 'vitest';
import { createOutputStorageClient } from '../../../src/output/storage.js';

describe('createOutputStorageClient', () => {
  it('retorna cliente com putObject e presignGet', () => {
    const client = createOutputStorageClient({
      endpoint: 'https://s3.meuagente.api.br',
      region: 'us-east-1',
      accessKey: 'ak',
      secretKey: 'sk',
      bucket: 'media-forge-outputs',
      useSsl: true,
    });
    expect(typeof client.putObject).toBe('function');
    expect(typeof client.presignGet).toBe('function');
  });

  it('lança quando credentials ausentes', () => {
    const client = createOutputStorageClient({
      endpoint: 'https://s3.meuagente.api.br',
      region: 'us-east-1',
      bucket: 'media-forge-outputs',
      useSsl: true,
    });
    return expect(
      client.putObject('key', Buffer.from(''), 'video/mp4'),
    ).rejects.toThrow('MinIO credentials missing');
  });
});
