import { describe, it, expect, vi } from 'vitest';
import { storeArtifact, artifactKey } from '../../../src/output/output-storage.js';
import type { OutputStorageClient } from '../../../src/output/storage.js';

describe('artifactKey', () => {
  it('gera chave determinística outputs/{job_id}.{ext}', () => {
    expect(artifactKey('20260602T120000Z-abc123-myjob', 'video/mp4')).toBe(
      'outputs/20260602T120000Z-abc123-myjob.mp4',
    );
    expect(artifactKey('somejob', 'image/png')).toBe('outputs/somejob.png');
    expect(artifactKey('somejob', 'image/jpeg')).toBe('outputs/somejob.jpg');
    expect(artifactKey('somejob', 'application/octet-stream')).toBe('outputs/somejob.bin');
  });
});

describe('storeArtifact', () => {
  it('chama putObject + presignGet e retorna StoredArtifact', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const presignGet = vi.fn().mockResolvedValue('https://s3.example.com/outputs/job1.mp4?sig=xxx');
    const headObject = vi.fn();
    const storageClient: OutputStorageClient = { putObject, presignGet, headObject };

    const result = await storeArtifact({
      storage: storageClient,
      jobId: 'job1',
      bytes: Buffer.from('data'),
      contentType: 'video/mp4',
      ttlSeconds: 604800,
    });

    expect(putObject).toHaveBeenCalledWith('outputs/job1.mp4', expect.any(Buffer), 'video/mp4');
    expect(presignGet).toHaveBeenCalledWith('outputs/job1.mp4', 604800);
    expect(result.key).toBe('outputs/job1.mp4');
    expect(result.url).toBe('https://s3.example.com/outputs/job1.mp4?sig=xxx');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
