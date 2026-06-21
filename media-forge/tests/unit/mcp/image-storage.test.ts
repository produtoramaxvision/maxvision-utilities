import { describe, it, expect, vi } from 'vitest';

// Este teste verifica o comportamento do wrapper storeArtifact dentro dos
// handlers de imagem via mock do storage. A implementação final é integração;
// este teste é de unidade do wrapper.
import { storeArtifact, artifactKey } from '../../../src/output/output-storage.js';

describe('storeArtifact para imagens', () => {
  it('gera chave correta para image/png', () => {
    expect(artifactKey('img-job-01', 'image/png')).toBe('outputs/img-job-01.png');
  });
  it('gera chave correta para image/webp', () => {
    expect(artifactKey('img-job-02', 'image/webp')).toBe('outputs/img-job-02.webp');
  });
  it('storeArtifact retorna url + expiresAt', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const presignGet = vi.fn().mockResolvedValue('https://s3.example.com/outputs/img1.png?s=x');
    const result = await storeArtifact({
      storage: { putObject, presignGet, headObject: vi.fn() },
      jobId: 'img1',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
      ttlSeconds: 604800,
    });
    expect(result.url).toContain('s3.example.com');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
