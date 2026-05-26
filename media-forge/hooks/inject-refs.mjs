#!/usr/bin/env node
// Hook handler invoked by hooks.json on PreToolUse for media_generate_video_* and
// media_generate_image*. Reads the PreToolUse payload from stdin, sniffs effect
// tags out of the prompt text, calls the in-process refs service to fetch a few
// presigned URLs, and emits an additionalContext block on stdout so Claude sees
// available refs before invoking the actual generator.
//
// IMPORTANT: hooks are best-effort. ANY failure must exit 0 with empty output —
// failing a hook would block generation, which is worse than skipping refs.
//
// ORDER (EA3 applied):
//   1. Read stdin + parse
//   2. refs_disabled early-exit
//   3. Import taxonomy only (cheap)
//   4. Scan prompt for matches
//   5. Early-exit if zero matches (saves ~200-500ms MinIO round-trip)
//   6. Check env vars
//   7. Lazy-import createRefsService (pulls @aws-sdk/client-s3)
//   8. searchRefs + emit filmlingo context
import { stdin } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.CLAUDE_PLUGIN_ROOT;
if (!ROOT) process.exit(0);

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
        hookEventName: 'PreToolUse',
        additionalContext,
      },
    }),
  );
}

async function main() {
  try {
    // 1. Read + parse stdin
    const raw = await readStdin();
    if (!raw) { emit(null); return; }
    const payload = JSON.parse(raw);
    const toolInput = payload?.tool_input ?? {};

    // 2. refs_disabled early-exit (ET3 test 3)
    if (toolInput.refs_disabled === true) { emit(null); return; }

    const promptText = (toolInput.prompt || toolInput.refined_spec || '') + '';

    // 3. Import taxonomy (cheap — no network, no AWS SDK)
    // Use pathToFileURL for Windows compatibility (bare path 'C:\...' is not a valid ESM specifier)
    const { CATEGORIES, resolveAliases, getFilmlingoHint } = await import(
      pathToFileURL(resolve(ROOT, 'dist/refs/taxonomy.js')).href
    );

    // 4. Scan prompt for category keyword + alias matches (EA3 early-exit guard)
    // Saves ~200-500ms on every gen call that doesn't need refs.
    const lower = promptText.toLowerCase();
    const matched = new Set();

    const quickMatch = CATEGORIES.some(
      (c) => lower.includes(c.replace(/-/g, ' ')) || lower.includes(c),
    );
    if (quickMatch) {
      // Build full matched set (all hits, not just first)
      for (const cat of CATEGORIES) {
        if (lower.includes(cat.replace(/-/g, ' ')) || lower.includes(cat)) matched.add(cat);
      }
    }

    // Also try alias tokens even if quickMatch already found something
    for (const tok of lower.match(/[a-z][a-z-]{2,}/g) ?? []) {
      const canon = resolveAliases(tok);
      if (canon) matched.add(canon);
    }

    // 5. Early-exit if zero taxonomy matches (EA3)
    if (matched.size === 0) { emit(null); return; }

    // 6. Check env vars — must have endpoint + credentials to proceed
    const cfg = {
      endpoint: process.env.MINIO_ENDPOINT,
      region: process.env.MINIO_REGION || 'us-east-1',
      bucket: process.env.MINIO_BUCKET || 'media-forge-refs',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      useSsl: (process.env.MINIO_USE_SSL ?? 'true') !== 'false',
    };
    if (!cfg.endpoint || !cfg.accessKey || !cfg.secretKey) { emit(null); return; }

    // 7. Lazy-import refs service (pulls @aws-sdk/client-s3 — deferred until here)
    const { createRefsService } = await import(
      pathToFileURL(resolve(ROOT, 'dist/refs/refs-service.js')).href
    );

    // 8. Search refs and build additionalContext
    const svc = createRefsService(cfg);
    const refs = await svc.searchRefs({
      tags: [...matched].slice(0, 3),
      mode: 'tag',
      limit: 3,
      seed: Date.now() & 0xffff,
      ttlSeconds: 3000,
    });

    const lines = [];
    lines.push(`REFERENCES AVAILABLE (media-forge-refs, ${refs.length} samples):`);
    for (const r of refs) {
      lines.push(`- ${r.category} :: ${r.presignedUrl}`);
    }
    lines.push('');
    for (const cat of matched) {
      const hint = getFilmlingoHint(cat);
      if (!hint) continue;
      lines.push(`FILMLINGO (${cat}):`);
      lines.push(`  Canonical terms: ${hint.canonicalTerms.join(', ')}`);
      if (hint.lens?.length) lines.push(`  Lens: ${hint.lens.join(', ')}`);
      if (hint.cameraMove?.length) lines.push(`  Camera move: ${hint.cameraMove.join(', ')}`);
      lines.push(`  Reference films: ${hint.referenceFilms.join(', ')}`);
      lines.push(`  Suggested suffix: ${hint.promptSuffix}`);
      lines.push('');
    }

    emit(lines.join('\n'));
  } catch (err) {
    // Best-effort — log to stderr but never block generation
    process.stderr.write(`[inject-refs] ${err?.message ?? err}\n`);
    emit(null);
  }
}

main();
