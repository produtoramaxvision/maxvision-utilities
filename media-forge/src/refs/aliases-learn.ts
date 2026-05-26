// src/refs/aliases-learn.ts
// Append-only JSONL log of user phrases that didn't resolve to a known category.
// Periodically inspect via `media-forge aliases suggest` to refresh taxonomy.ts.
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface UnresolvedRecord {
  ts: string;
  phrase: string;
  briefSnippet: string;
  candidateMatches: string[]; // best-guess categories the system considered
}

export interface AliasSuggestion {
  phrase: string;
  hits: number;
  topCandidate: string;
  candidateScores: Record<string, number>;
}

export async function logUnresolvedAlias(input: {
  logPath: string;
  phrase: string;
  briefSnippet: string;
  candidateMatches: string[];
}): Promise<void> {
  const record: UnresolvedRecord = {
    ts: new Date().toISOString(),
    phrase: input.phrase.toLowerCase().trim(),
    briefSnippet: input.briefSnippet.slice(0, 200),
    candidateMatches: input.candidateMatches,
  };
  await mkdir(dirname(input.logPath), { recursive: true });
  await appendFile(input.logPath, JSON.stringify(record) + '\n');
}

export async function suggestNewAliases(
  logPath: string,
  opts: { minHits: number },
): Promise<AliasSuggestion[]> {
  let content: string;
  try {
    content = await readFile(logPath, 'utf8');
  } catch {
    return [];
  }
  const records = content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as UnresolvedRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is UnresolvedRecord => r !== null);

  const byPhrase = new Map<string, { hits: number; candidates: Record<string, number> }>();
  for (const r of records) {
    let entry = byPhrase.get(r.phrase);
    if (!entry) {
      entry = { hits: 0, candidates: {} };
      byPhrase.set(r.phrase, entry);
    }
    entry.hits += 1;
    for (const c of r.candidateMatches) {
      entry.candidates[c] = (entry.candidates[c] ?? 0) + 1;
    }
  }

  const suggestions: AliasSuggestion[] = [];
  for (const [phrase, { hits, candidates }] of byPhrase) {
    if (hits < opts.minHits) continue;
    const sorted = Object.entries(candidates).sort((a, b) => b[1] - a[1]);
    suggestions.push({
      phrase,
      hits,
      topCandidate: sorted[0]?.[0] ?? 'unknown',
      candidateScores: candidates,
    });
  }
  return suggestions.sort((a, b) => b.hits - a.hits);
}
