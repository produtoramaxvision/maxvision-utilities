// src/refs/marengo-embed.ts
// AWS Bedrock InvokeModel call to TwelveLabs Marengo 3.0 for video-native embedding.
// Accepts a Buffer of the original gif/webp (no keyframe extraction needed).
// Returns Float32Array of dim 512 (Marengo dim is smaller than Voyage 1024).
// IMPORTANT: pgvector schema in Phase 2 is fixed at dim 1024 (refs_index table).
// Marengo uses a parallel table refs_index_marengo with vector(512) — see
// migrations/002-refs-index-marengo.sql.
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const MODEL_ID = process.env.MARENGO_MODEL_ID ?? 'twelvelabs.marengo-embed-3-0-v1:0';

export interface MarengoEmbedCfg {
  region: string;
  accessKey?: string;
  secretKey?: string;
}

export interface MarengoEmbedResult {
  vector: Float32Array;
}

/**
 * Embed one or more raw video/gif/webp buffers via TwelveLabs Marengo 3.0 on AWS Bedrock.
 * Returns one 512-dim Float32Array per input clip, in order.
 *
 * AWS credentials are resolved lazily:
 * - When cfg.accessKey + cfg.secretKey are provided they take precedence.
 * - Otherwise the SDK credential chain applies (env vars AWS_ACCESS_KEY_ID /
 *   AWS_SECRET_ACCESS_KEY, ~/.aws/credentials, IAM role, etc.).
 */
export async function embedVideos(
  rawClips: Buffer[],
  cfg: MarengoEmbedCfg,
): Promise<MarengoEmbedResult[]> {
  const client = new BedrockRuntimeClient({
    region: cfg.region,
    ...(cfg.accessKey && cfg.secretKey
      ? { credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey } }
      : {}),
  });

  const out: MarengoEmbedResult[] = [];
  for (const clip of rawClips) {
    const body = JSON.stringify({
      inputType: 'video',
      mediaSource: { base64String: clip.toString('base64') },
    });
    const resp = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body,
      }),
    );
    const text = new TextDecoder().decode(resp.body);
    const parsed = JSON.parse(text) as { data: Array<{ embedding: number[] }> };
    const first = parsed.data[0];
    if (!first) throw new Error('Marengo response contained no embedding data');
    out.push({ vector: Float32Array.from(first.embedding) });
  }
  return out;
}
