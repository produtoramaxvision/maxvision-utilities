// src/output/output-storage.ts
// Orquestra upload de artefato para MinIO + geração de presigned URL.
// TTL padrão: 7 dias (604800s). Configurável via MEDIA_FORGE_ARTIFACT_TTL_SECONDS.
import type { OutputStorageClient } from './storage.js';

export interface StoredArtifact {
  key: string;
  url: string;
  expiresAt: string; // ISO 8601
}

export interface StoreArtifactOpts {
  storage: OutputStorageClient;
  jobId: string;
  bytes: Buffer;
  contentType: string;
  ttlSeconds?: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'application/octet-stream': 'bin',
};

/** Chave determinística: `outputs/{jobId}.{ext}`. Stateless — headObject/presign podem usar. */
export function artifactKey(jobId: string, contentType: string): string {
  const ext = MIME_TO_EXT[contentType] ?? 'bin';
  return `outputs/${jobId}.${ext}`;
}

/** Default TTL: 7 dias. Override: MEDIA_FORGE_ARTIFACT_TTL_SECONDS. */
export function defaultTtlSeconds(): number {
  const raw = process.env['MEDIA_FORGE_ARTIFACT_TTL_SECONDS'];
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 604800; // 7 days
}

export async function storeArtifact(opts: StoreArtifactOpts): Promise<StoredArtifact> {
  const ttl = opts.ttlSeconds ?? defaultTtlSeconds();
  const key = artifactKey(opts.jobId, opts.contentType);
  await opts.storage.putObject(key, opts.bytes, opts.contentType);
  const url = await opts.storage.presignGet(key, ttl);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  return { key, url, expiresAt };
}

/**
 * Presign-only path para uso no poll handler.
 *
 * Design F-B: o upload para MinIO ocorre dentro do webhook handler do provider
 * (createKlingWebhookHandler / createBytedanceWebhookHandler) no momento em que
 * o job completa. O poll handler apenas verifica se o objeto existe (headObject)
 * e gera uma nova URL assinada — sem re-baixar do CDN do provider. MinIO é a
 * source of truth.
 *
 * Retorna null se o objeto não existir ainda (job ainda não concluído ou upload
 * não aconteceu — fallback gracioso: o poll retorna assetUrls do provider).
 */
export async function presignExistingArtifact(opts: {
  storage: OutputStorageClient;
  jobId: string;
  contentType: string;
  ttlSeconds?: number;
}): Promise<StoredArtifact | null> {
  const ttl = opts.ttlSeconds ?? defaultTtlSeconds();
  const key = artifactKey(opts.jobId, opts.contentType);
  const head = await opts.storage.headObject(key);
  if (!head) return null;
  const url = await opts.storage.presignGet(key, ttl);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  return { key, url, expiresAt };
}
