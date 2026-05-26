// src/refs/ref-match-checker.ts
// Phase 3: cosine similarity between the moodboard reference and the generated
// output's first frame. Both are embedded via Voyage Multimodal-3 (same space as
// the indexer for consistency).
import { embedImages } from './voyage-embed.js';

export async function computeRefMatchScore(
  outputFrameJpeg: Buffer,
  moodboardJpeg: Buffer,
  voyageApiKey: string,
): Promise<number> {
  const results = await embedImages([outputFrameJpeg, moodboardJpeg], voyageApiKey);
  const a = results[0];
  const b = results[1];
  if (!a || !b) throw new Error('embedImages returned fewer than 2 results');
  return cosineSimilarity(a.vector, b.vector);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`dim mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
