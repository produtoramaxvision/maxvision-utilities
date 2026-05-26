// src/refs/tag-search.ts
// Phase 1 search: list-objects per category prefix, deterministically sample N,
// presign each, return structured refs.
import type { MinioClient, MinioObject } from './minio-client.js';
import { isCategory, resolveAliases } from './taxonomy.js';

const MAX_OBJECTS_PER_CATEGORY = Number(
  process.env['MEDIA_FORGE_MAX_OBJECTS_PER_CATEGORY'] ?? '10000',
);

export interface SampleOptions {
  limitPerCategory: number;
  seed: number;
  ttlSeconds: number;
}

export interface RefRationale {
  mode: 'tag' | 'semantic';
  rank?: number;
  cosineDistance?: number;
  seedUsed: number;
}

export interface RefRecord {
  category: string;
  objectKey: string;
  size: number;
  presignedUrl: string;
  rationale: RefRationale;
}

// Deterministic seeded shuffle (Mulberry32 PRNG) so identical (seed, input) → identical output.
function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const j = Math.floor(r * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

export async function sampleByCategory(
  client: MinioClient,
  rawCategories: readonly string[],
  opts: SampleOptions,
): Promise<RefRecord[]> {
  const resolved: string[] = [];
  for (const raw of rawCategories) {
    const cat = isCategory(raw) ? raw : resolveAliases(raw);
    if (!cat) throw new Error(`unknown category or alias: ${raw}`);
    resolved.push(cat);
  }

  const all: RefRecord[] = [];
  for (const cat of resolved) {
    const allObjects: MinioObject[] = [];
    let token: string | undefined;
    do {
      const page = await client.listObjects(`${cat}/`, 1000, token);
      allObjects.push(...page.objects);
      token = page.truncated ? page.nextContinuationToken : undefined;
      if (allObjects.length >= MAX_OBJECTS_PER_CATEGORY) break;
    } while (token);

    const picks = seededShuffle(allObjects, opts.seed).slice(0, opts.limitPerCategory);
    for (let rank = 0; rank < picks.length; rank++) {
      const obj = picks[rank] as NonNullable<(typeof picks)[number]>;
      const url = await client.presignObject(obj.key, opts.ttlSeconds);
      all.push({
        category: cat,
        objectKey: obj.key,
        size: obj.size,
        presignedUrl: url,
        rationale: { mode: 'tag', rank, seedUsed: opts.seed },
      });
    }
  }
  return all;
}
