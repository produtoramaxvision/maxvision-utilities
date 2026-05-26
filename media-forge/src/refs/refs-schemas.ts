// src/refs/refs-schemas.ts
// Zod schemas for the 4 new MCP tools. Follows the project convention of
// keeping domain schemas next to domain code and re-exporting them from
// src/mcp/schemas.ts.
import { z } from 'zod';

export const RefsSearchInput = z.object({
  tags: z.array(z.string().min(1)).min(1).max(5),
  mode: z.enum(['tag', 'semantic']).default('tag'),
  limit: z.number().int().min(1).max(20).default(5),
  queryText: z.string().optional(),
  queryImagePath: z.string().optional(),
  filters: z
    .object({
      minDurationMs: z.number().int().optional(),
      maxDurationMs: z.number().int().optional(),
      paletteHint: z.string().optional(),
    })
    .optional(),
  seed: z.number().int().default(0),
  ttlSeconds: z.number().int().min(60).max(3600).default(3000),
});
export type RefsSearchInputT = z.infer<typeof RefsSearchInput>;

export const RefsComposeMoodboardInput = z.object({
  refKeys: z.array(z.string().min(1)).min(1).max(10),
  subjectImagePaths: z.array(z.string().min(1)).max(4).default([]),
  effectTags: z.array(z.string().min(1)).min(1),
  outputSize: z.enum(['1024', '2048', '4096']).default('2048'),
  styleHint: z.string().optional(),
});
export type RefsComposeMoodboardInputT = z.infer<typeof RefsComposeMoodboardInput>;

export const RefsPresignInput = z.object({
  objectKeys: z.array(z.string().min(1)).min(1).max(50),
  ttlSeconds: z.number().int().min(60).max(3600).default(3000),
});
export type RefsPresignInputT = z.infer<typeof RefsPresignInput>;

export const RefsIndexInput = z.object({
  categoryFilter: z.array(z.string()).optional(),
  batchSize: z.number().int().min(1).max(200).default(50),
  embeddingModel: z
    .enum(['voyage-multimodal-3', 'cohere-embed-v4', 'clip-vit-l-14'])
    .default('voyage-multimodal-3'),
  forceReindex: z.boolean().default(false),
});
export type RefsIndexInputT = z.infer<typeof RefsIndexInput>;
