import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, '..', 'prompts');
const outFile = join(promptsDir, '_index.json');

interface PromptIndexEntry {
  domain: string;
  name: string;
  path: string;
}

function walk(dir: string, domain: string): PromptIndexEntry[] {
  if (!existsSync(dir)) return [];
  const out: PromptIndexEntry[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isFile() && (entry.endsWith('.yml') || entry.endsWith('.yaml'))) {
      out.push({
        domain,
        name: entry.replace(/\.ya?ml$/, ''),
        path: `prompts/${domain}/${entry}`,
      });
    }
  }
  return out;
}

function main(): void {
  if (!existsSync(promptsDir)) {
    process.stdout.write('build-prompt-index: prompts/ not present yet (P11 not started); skipping.\n');
    return;
  }
  const domains = readdirSync(promptsDir).filter((d) => {
    const full = join(promptsDir, d);
    return existsSync(full) && statSync(full).isDirectory();
  });
  const entries: PromptIndexEntry[] = [];
  for (const domain of domains) {
    entries.push(...walk(join(promptsDir, domain), domain));
  }
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries }, null, 2));
  process.stdout.write(`build-prompt-index: wrote ${entries.length} entries to ${outFile}\n`);
}

main();
