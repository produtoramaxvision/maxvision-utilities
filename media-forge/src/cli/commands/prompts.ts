import type { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOT_POPULATED_MSG = 'prompts library not yet populated (pending P11)';

interface PromptIndexEntry {
  domain: string;
  name: string;
  path: string;
}

interface PromptIndex {
  generatedAt: string;
  count: number;
  entries: PromptIndexEntry[];
}

async function loadPromptIndex(): Promise<PromptIndex | null> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Walk up from dist/cli/commands → find prompts/_index.json
    const candidates = [
      path.join(here, '..', '..', '..', 'prompts', '_index.json'),
      path.join(process.cwd(), 'prompts', '_index.json'),
    ];
    for (const candidate of candidates) {
      const raw = await fs.readFile(candidate, 'utf8').catch(() => null);
      if (raw) {
        return JSON.parse(raw) as PromptIndex;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function registerPromptsCommand(program: Command): void {
  const prompts = program.command('prompts').description('Browse the prompt library (P11)');

  // list
  prompts
    .command('list')
    .description('List all prompts, optionally filtered by domain')
    .option('--domain <d>', 'Filter by domain')
    .option('--json', 'Emit JSON')
    .action(async (opts: { domain?: string; json?: boolean }) => {
      const index = await loadPromptIndex();
      if (!index || index.count === 0) {
        process.stdout.write(`${NOT_POPULATED_MSG}\n`);
        return;
      }
      const entries = opts.domain
        ? index.entries.filter((e) => e.domain === opts.domain)
        : index.entries;
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      } else {
        for (const e of entries) {
          process.stdout.write(`${e.domain}/${e.name}\n`);
        }
      }
    });

  // show
  prompts
    .command('show')
    .description('Show a prompt by ID (domain/name)')
    .argument('<id>', 'Prompt ID (domain/name)')
    .option('--json', 'Emit JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      const index = await loadPromptIndex();
      if (!index || index.count === 0) {
        process.stdout.write(`${NOT_POPULATED_MSG}\n`);
        return;
      }
      const [domain, name] = id.split('/');
      const entry = index.entries.find((e) => e.domain === domain && e.name === name);
      if (!entry) {
        process.stderr.write(`prompt '${id}' not found\n`);
        process.exit(1);
      }
      const raw = await fs.readFile(path.join(process.cwd(), entry.path), 'utf8').catch(() => null);
      if (!raw) {
        process.stderr.write(`prompt file not readable: ${entry.path}\n`);
        process.exit(1);
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify({ id, path: entry.path, content: raw }, null, 2)}\n`);
      } else {
        process.stdout.write(raw);
      }
    });

  // search
  prompts
    .command('search')
    .description('Search prompts by keyword')
    .argument('<query>', 'Search query')
    .option('--json', 'Emit JSON')
    .action(async (query: string, opts: { json?: boolean }) => {
      const index = await loadPromptIndex();
      if (!index || index.count === 0) {
        process.stdout.write(`${NOT_POPULATED_MSG}\n`);
        return;
      }
      const q = query.toLowerCase();
      const matches = index.entries.filter(
        (e) => e.name.toLowerCase().includes(q) || e.domain.toLowerCase().includes(q),
      );
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
      } else {
        if (matches.length === 0) {
          process.stdout.write('No matches found.\n');
        } else {
          for (const e of matches) {
            process.stdout.write(`${e.domain}/${e.name}\n`);
          }
        }
      }
    });
}
