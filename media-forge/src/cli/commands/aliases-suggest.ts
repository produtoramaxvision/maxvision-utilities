import type { Command } from 'commander';
import { join } from 'node:path';
import { suggestNewAliases } from '../../refs/aliases-learn.js';

export function registerAliasesCommand(program: Command): void {
  const aliases = program
    .command('aliases')
    .description('Aliases utilities for taxonomy maintenance');

  aliases
    .command('suggest')
    .description('Surface unresolved alias phrases that have reached the hit threshold')
    .option('--min-hits <n>', 'Minimum number of hits to surface a suggestion', '5')
    .option('--log-path <path>', 'Override path to aliases-learn.jsonl')
    .action(
      async (opts: { minHits: string; logPath?: string }) => {
        const logPath =
          opts.logPath ??
          join(
            process.env['MEDIA_FORGE_PROJECT_DIR'] ?? '.media-forge',
            'aliases-learn.jsonl',
          );
        const minHits = parseInt(opts.minHits, 10);
        if (isNaN(minHits) || minHits < 1) {
          process.stderr.write('--min-hits must be a positive integer\n');
          process.exit(1);
        }

        const suggestions = await suggestNewAliases(logPath, { minHits });

        if (suggestions.length === 0) {
          process.stdout.write(`No alias suggestions (threshold: >=${minHits} hits).\n`);
          return;
        }

        process.stdout.write(
          `${suggestions.length} alias suggestion(s) (>=${minHits} hits):\n`,
        );
        for (const s of suggestions) {
          const candidateStr = Object.entries(s.candidateScores)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => `${cat}=${count}`)
            .join(', ');
          process.stdout.write(
            `  "${s.phrase}" -> ${s.topCandidate} (${s.hits} hits, candidates: ${candidateStr || 'none'})\n`,
          );
        }
        process.stdout.write(
          '\nTo accept: edit src/refs/taxonomy.ts ALIASES map and rebuild.\n',
        );
      },
    );
}
