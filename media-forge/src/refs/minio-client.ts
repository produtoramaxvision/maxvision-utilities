// src/refs/minio-client.ts
// Thin wrapper over @aws-sdk/client-s3 specialised for the MinIO refs bucket.
// MinIO requires path-style addressing (forcePathStyle: true).
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface MinioConfig {
  endpoint: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  useSsl: boolean;
}

export interface MinioObject {
  key: string;
  size: number;
  etag?: string;
}

export interface ListObjectsResult {
  objects: MinioObject[];
  truncated: boolean;
  nextContinuationToken?: string;
}

export interface MinioClient {
  listObjects(prefix: string, max?: number, continuationToken?: string): Promise<ListObjectsResult>;
  headObject(key: string): Promise<{ size: number; contentType?: string }>;
  presignObject(key: string, ttlSeconds: number): Promise<string>;
  downloadObject(key: string): Promise<Buffer>;
}

export function createMinioClient(cfg: MinioConfig): MinioClient {
  if (!cfg.accessKey || !cfg.secretKey) {
    return {
      listObjects: () => Promise.reject(new Error('MinIO credentials missing (MINIO_ACCESS_KEY / MINIO_SECRET_KEY)')),
      headObject: () => Promise.reject(new Error('MinIO credentials missing')),
      presignObject: () => Promise.reject(new Error('MinIO credentials missing')),
      downloadObject: () => Promise.reject(new Error('MinIO credentials missing')),
    };
  }

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });

  return {
    async listObjects(prefix, max = 1000, continuationToken) {
      const resp = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: prefix,
          MaxKeys: max,
          ContinuationToken: continuationToken,
        }),
      );
      const objects: MinioObject[] = (resp.Contents ?? []).map((o) => ({
        key: o.Key!,
        size: o.Size ?? 0,
        etag: o.ETag,
      }));
      return {
        objects,
        truncated: resp.IsTruncated ?? false,
        nextContinuationToken: resp.NextContinuationToken,
      };
    },
    async headObject(key) {
      const resp = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return { size: resp.ContentLength ?? 0, contentType: resp.ContentType };
    },
    async presignObject(key, ttlSeconds) {
      const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
      return getSignedUrl(client, cmd, { expiresIn: ttlSeconds });
    },
    async downloadObject(key) {
      const resp = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const body = resp.Body as AsyncIterable<Uint8Array>;
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    },
  };
}
