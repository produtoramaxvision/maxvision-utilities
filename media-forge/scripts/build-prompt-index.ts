import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIndex } from '../src/prompts/template-loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, '..', 'prompts');

writeIndex(promptsDir)
  .then((idx) =>
    process.stdout.write(
      `build-prompt-index: wrote ${idx.count} entries to ${join(promptsDir, '_index.json')}\n`,
    ),
  )
  .catch((err: unknown) => {
    process.stderr.write(
      `build-prompt-index: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
