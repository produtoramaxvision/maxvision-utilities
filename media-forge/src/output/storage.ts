// src/output/storage.ts
// Thin S3/MinIO client para artefatos gerados (outputs). Independente de
// MEDIA_FORGE_REFS_ENABLED — entrega de artefato não pode ser bloqueada pela
// feature flag de refs. Usa os mesmos pacotes já instalados:
// @aws-sdk/client-s3 ^3.700.0 + @aws-sdk/s3-request-presigner ^3.700.0.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MediaForgeConfig } from '../core/config.js';

export interface OutputStorageConfig {
  endpoint: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  useSsl: boolean;
}

export interface OutputStorageClient {
  /** Upload bytes. */
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Generate a presigned GET URL valid for `ttlSeconds`. */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  /** Check if a key exists (used by stateless poll path). */
  headObject(key: string): Promise<{ size: number; contentType?: string } | null>;
}

export function createOutputStorageClient(cfg: OutputStorageConfig): OutputStorageClient {
  if (!cfg.accessKey || !cfg.secretKey) {
    return {
      putObject: () =>
        Promise.reject(
          new Error('MinIO credentials missing (MINIO_ACCESS_KEY / MINIO_SECRET_KEY)'),
        ),
      presignGet: () => Promise.reject(new Error('MinIO credentials missing')),
      headObject: () => Promise.reject(new Error('MinIO credentials missing')),
    };
  }

  const s3 = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });

  return {
    async putObject(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async presignGet(key, ttlSeconds) {
      const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
      return getSignedUrl(s3, cmd, { expiresIn: ttlSeconds });
    },
    async headObject(key) {
      try {
        const resp = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return { size: resp.ContentLength ?? 0, contentType: resp.ContentType };
      } catch (err) {
        // S3 throws NoSuchKey / NotFound on missing object.
        const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (code === 404 || (err as { name?: string }).name === 'NotFound') {
          return null;
        }
        throw err;
      }
    },
  };
}

/** Build from MediaForgeConfig (uses MINIO_* env already loaded by loadConfig). */
export function outputStorageFromConfig(
  cfg: Pick<
    MediaForgeConfig,
    'minioEndpoint' | 'minioRegion' | 'minioBucket' | 'minioAccessKey' | 'minioSecretKey' | 'minioUseSsl'
  >,
): OutputStorageClient | null {
  if (!cfg.minioEndpoint) return null;
  return createOutputStorageClient({
    endpoint: cfg.minioEndpoint,
    region: cfg.minioRegion,
    accessKey: cfg.minioAccessKey,
    secretKey: cfg.minioSecretKey,
    bucket: cfg.minioBucket,
    useSsl: cfg.minioUseSsl,
  });
}
