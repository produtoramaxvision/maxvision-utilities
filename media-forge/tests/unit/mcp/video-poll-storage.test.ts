import { describe, it, expect, vi } from 'vitest';
import { artifactKey, presignExistingArtifact } from '../../../src/output/output-storage.js';
import type { OutputStorageClient } from '../../../src/output/storage.js';

describe('artifactKey para video', () => {
  it('gera chave mp4 correta', () => {
    expect(artifactKey('20260602T120000Z-kl3j9d-kling-t2v', 'video/mp4')).toBe(
      'outputs/20260602T120000Z-kl3j9d-kling-t2v.mp4',
    );
  });
  it('gera chave webm correta', () => {
    expect(artifactKey('job-webm-01', 'video/webm')).toBe('outputs/job-webm-01.webm');
  });
});

describe('presignExistingArtifact', () => {
  it('retorna StoredArtifact quando objeto existe no MinIO', async () => {
    const storage: OutputStorageClient = {
      putObject: vi.fn(),
      presignGet: vi.fn().mockResolvedValue('https://s3.example.com/outputs/job1.mp4?sig=x'),
      headObject: vi.fn().mockResolvedValue({ size: 1024, contentType: 'video/mp4' }),
    };
    const result = await presignExistingArtifact({
      storage,
      jobId: 'job1',
      contentType: 'video/mp4',
      ttlSeconds: 3600,
    });
    expect(result).not.toBeNull();
    expect(result!.url).toContain('s3.example.com');
    expect(result!.key).toBe('outputs/job1.mp4');
  });

  it('retorna null quando objeto nao existe (job nao concluido)', async () => {
    const storage: OutputStorageClient = {
      putObject: vi.fn(),
      presignGet: vi.fn(),
      headObject: vi.fn().mockResolvedValue(null),
    };
    const result = await presignExistingArtifact({
      storage,
      jobId: 'job-pending',
      contentType: 'video/mp4',
    });
    expect(result).toBeNull();
  });
});
