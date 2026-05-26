// One-shot indexer driver. Run with:
//   pnpm tsx scripts/run-indexer-once.ts --categories all|dolly-zoom,bullet-time
//
// Reads MinIO / Voyage / pgvector creds from env. Logs structured JSON summary
// to stderr at end with totalObjects / totalFrames / elapsedSec / estimatedCostUsd.
// Safe to re-run: the indexer uses ON CONFLICT UPSERT.
//
// Steps 1, 3-6 of Task 2.5 require live DB + API access — run manually.
// This file is Step 2 only.
import { createMinioClient } from '../src/refs/minio-client.js';
import { createPgvectorClient } from '../src/refs/pgvector-client.js';
import { runIndexer } from '../src/refs/indexer.js';
import { CATEGORIES } from '../src/refs/taxonomy.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // --help guard
  if (args.includes('--help') || args.includes('-h')) {
    process.stderr.write(
      [
        'Usage: pnpm tsx scripts/run-indexer-once.ts [--categories=all|cat1,cat2]',
        '',
        'Options:',
        '  --categories=<value>  Comma-separated category names or "all" (default: all)',
        '  --help, -h            Show this help message',
        '',
        'Environment variables:',
        '  MINIO_ENDPOINT          Required. MinIO S3-compat endpoint URL.',
        '  MINIO_REGION            Optional. Default: us-east-1.',
        '  MINIO_BUCKET            Optional. Default: media-forge-refs.',
        '  MINIO_ACCESS_KEY        Required for MinIO auth.',
        '  MINIO_SECRET_KEY        Required for MinIO auth.',
        '  MINIO_USE_SSL           Optional. Default: true.',
        '  PGVECTOR_URL            Required. PostgreSQL connection string (scoped role).',
        '  VOYAGE_API_KEY          Required. Voyage Multimodal-3 API key.',
        '  MEDIA_FORGE_INDEXER_BATCH  Optional. Rows per flush batch. Default: 50.',
      ].join('\n') + '\n',
    );
    process.exit(0);
  }

  const catArg = args.find((a) => a.startsWith('--categories='))?.split('=')[1] ?? 'all';

  if (!catArg.length) {
    process.stderr.write('Error: --categories= requires a value (e.g. --categories=all)\n');
    process.exit(1);
  }

  const categories = catArg === 'all' ? [...CATEGORIES] : catArg.split(',');

  const minio = createMinioClient({
    endpoint: process.env['MINIO_ENDPOINT'] ?? '',
    region: process.env['MINIO_REGION'] ?? 'us-east-1',
    bucket: process.env['MINIO_BUCKET'] ?? 'media-forge-refs',
    accessKey: process.env['MINIO_ACCESS_KEY'],
    secretKey: process.env['MINIO_SECRET_KEY'],
    useSsl: (process.env['MINIO_USE_SSL'] ?? 'true') !== 'false',
  });

  const pgUrl = process.env['PGVECTOR_URL'] ?? '';
  if (!pgUrl) {
    process.stderr.write('Error: PGVECTOR_URL is required\n');
    process.exit(1);
  }

  const pg = createPgvectorClient(pgUrl);

  const start = Date.now();

  const summary = await runIndexer({
    minio,
    pg,
    categories,
    batchSize: Number(process.env['MEDIA_FORGE_INDEXER_BATCH'] ?? 50),
    framesPerObject: 3,
    voyageApiKey: process.env['VOYAGE_API_KEY'],
  });

  const elapsedSec = (Date.now() - start) / 1000;

  // Cost estimate: Voyage Multimodal-3 = $0.12 per 1M tokens; each frame ~1000 tokens.
  const estimatedCostUsd = (summary.totalFrames * 1000 * 0.12) / 1_000_000;

  process.stderr.write(
    JSON.stringify(
      {
        totalObjects: summary.totalObjects,
        totalFrames: summary.totalFrames,
        totalBatches: summary.totalBatches,
        elapsedSec,
        estimatedCostUsd,
      },
      null,
      2,
    ) + '\n',
  );

  await pg.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
