#!/usr/bin/env node
// SessionStart hook — best-effort taxonomy drift detection. Never fails the session.
// Uses pathToFileURL for Windows ESM compat (same pattern as inject-refs.mjs / Task 1.9).
import { stdin } from 'node:process';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function readStdin() {
  const chunks = [];
  for await (const c of stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function emit(additionalContext) {
  if (!additionalContext) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    }),
  );
}

async function main() {
  try {
    await readStdin(); // drain stdin even if unused

    const ROOT = process.env.CLAUDE_PLUGIN_ROOT;
    if (!ROOT) { emit(null); return; }

    const cfg = {
      endpoint: process.env.MINIO_ENDPOINT,
      region: process.env.MINIO_REGION || 'us-east-1',
      bucket: process.env.MINIO_BUCKET || 'media-forge-refs',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      useSsl: (process.env.MINIO_USE_SSL ?? 'true') !== 'false',
    };
    if (!cfg.endpoint || !cfg.accessKey || !cfg.secretKey) { emit(null); return; }

    // Use pathToFileURL for Windows ESM compat (bare 'C:\...' path is not a valid specifier).
    // createMinioClient is re-exported from refs-service.js (minio-client.js is bundled inside it).
    const { createMinioClient } = await import(
      pathToFileURL(resolve(ROOT, 'dist/refs/refs-service.js')).href
    );
    const { CATEGORIES } = await import(
      pathToFileURL(resolve(ROOT, 'dist/refs/taxonomy.js')).href
    );

    const client = createMinioClient(cfg);
    // List top-level prefixes by paging with max keys — best-effort (first 5000 objects)
    const { objects } = await client.listObjects('', 5000);
    const remoteCats = new Set();
    for (const obj of objects) {
      const idx = obj.key.indexOf('/');
      if (idx > 0) remoteCats.add(obj.key.slice(0, idx));
    }
    const added = [...remoteCats].filter((c) => !CATEGORIES.includes(c));
    const removed = CATEGORIES.filter((c) => !remoteCats.has(c));

    // Persist snapshot so diffAgainstSnapshot() consumers can use it
    const snapDir = resolve(process.env.CLAUDE_PROJECT_DIR ?? '.', '.media-forge');
    await mkdir(snapDir, { recursive: true });
    await writeFile(
      resolve(snapDir, 'refs-categories-snapshot.json'),
      JSON.stringify({ ts: new Date().toISOString(), categories: [...remoteCats].sort() }, null, 2),
    );

    if (added.length === 0 && removed.length === 0) { emit(null); return; }

    const lines = ['media-forge-refs taxonomy drift detected:'];
    if (added.length > 0) {
      lines.push(`  + ${added.length} new categories: ${added.slice(0, 10).join(', ')}${added.length > 10 ? '...' : ''}`);
    }
    if (removed.length > 0) {
      lines.push(`  - ${removed.length} removed: ${removed.slice(0, 10).join(', ')}`);
    }
    lines.push(`  Snapshot: ${resolve(snapDir, 'refs-categories-snapshot.json')}`);
    lines.push('  Action: run `pnpm tsx scripts/regen-taxonomy.ts` to refresh src/refs/taxonomy.ts.');
    emit(lines.join('\n'));
  } catch (err) {
    process.stderr.write(`[refresh-taxonomy] ${err?.message ?? err}\n`);
    emit(null);
  }
}

main();
