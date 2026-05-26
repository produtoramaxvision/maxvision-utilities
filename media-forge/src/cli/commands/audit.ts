import type { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from '../../core/config.js';
import { createMinioClient } from '../../refs/minio-client.js';
import { generateAuditGallery } from '../../refs/audit-gallery.js';

export interface JobSummary {
  jobId: string;
  jobDir: string;
  versionDir?: string;
  version?: string;
  verdict?: string;
  costUsd?: number;
  error?: string;
}

/**
 * OutputManager persists per-version artifacts under `<jobDir>/v<N>/`
 * (`metadata.json`, `verdict.json`, `trace.jsonl`, ...). The audit command
 * inspects the latest version on disk; if the job has no version directories
 * yet (e.g. dry-run or pre-write failure) it falls back to the job root.
 */
async function pickLatestVersionDir(jobDir: string): Promise<string> {
  const entries = await fs.readdir(jobDir).catch(() => [] as string[]);
  const versions = entries
    .filter((e) => /^v\d+$/.test(e))
    .map((e) => ({ name: e, n: parseInt(e.slice(1), 10) }))
    .sort((a, b) => b.n - a.n);
  return versions.length > 0 ? path.join(jobDir, versions[0]!.name) : jobDir;
}

export async function readJobSummary(jobDir: string, jobId: string): Promise<JobSummary> {
  const summary: JobSummary = { jobId, jobDir };

  try {
    const targetDir = await pickLatestVersionDir(jobDir);
    if (targetDir !== jobDir) {
      summary.versionDir = targetDir;
      summary.version = path.basename(targetDir);
    }

    const metaPath = path.join(targetDir, 'metadata.json');
    const metaRaw = await fs.readFile(metaPath, 'utf8').catch(() => null);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw) as Record<string, unknown>;
      if (typeof meta['costUsd'] === 'number') summary.costUsd = meta['costUsd'];
      if (typeof meta['verdict'] === 'string') summary.verdict = meta['verdict'];
    }

    // Try verdict.json (latest version)
    const verdictPath = path.join(targetDir, 'verdict.json');
    const verdictRaw = await fs.readFile(verdictPath, 'utf8').catch(() => null);
    if (verdictRaw) {
      const verdict = JSON.parse(verdictRaw) as Record<string, unknown>;
      if (typeof verdict['verdict'] === 'string') summary.verdict = verdict['verdict'];
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
  }

  return summary;
}

export async function listAllJobs(projectDir: string): Promise<JobSummary[]> {
  const jobsDir = path.join(projectDir, 'jobs');
  try {
    const entries = await fs.readdir(jobsDir);
    const summaries: JobSummary[] = [];
    for (const entry of entries) {
      const jobDir = path.join(jobsDir, entry);
      const stat = await fs.stat(jobDir).catch(() => null);
      if (stat?.isDirectory()) {
        summaries.push(await readJobSummary(jobDir, entry));
      }
    }
    return summaries;
  } catch {
    return [];
  }
}

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Audit job metadata and verdicts')
    .argument('<jobId>', 'Job ID or "all" for all jobs')
    .option('--json', 'Output as JSON')
    .option('--project-dir <dir>', 'Override .media-forge project dir')
    .option('--gallery', 'Generate HTML gallery of ref thumbnails for this job')
    .option('--gallery-dir <dir>', 'Output directory for gallery (default: job version dir)')
    .action(async (jobId: string, opts: { json?: boolean; projectDir?: string; gallery?: boolean; galleryDir?: string }) => {
      const projectDir =
        opts.projectDir ??
        process.env['MEDIA_FORGE_PROJECT_DIR'] ??
        path.join(process.cwd(), '.media-forge');

      if (jobId === 'all') {
        const jobs = await listAllJobs(projectDir);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify({ jobs }, null, 2)}\n`);
        } else {
          if (jobs.length === 0) {
            process.stdout.write('No jobs found.\n');
          } else {
            process.stdout.write(`${jobs.length} job(s):\n`);
            for (const j of jobs) {
              process.stdout.write(
                `  ${j.jobId}  verdict=${j.verdict ?? 'n/a'}  cost=${j.costUsd != null ? `$${j.costUsd.toFixed(4)}` : 'n/a'}\n`,
              );
            }
          }
        }
      } else {
        const jobDir = path.join(projectDir, 'jobs', jobId);
        const summary = await readJobSummary(jobDir, jobId);
        if (opts.json) {
          process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else {
          process.stdout.write(`jobId: ${summary.jobId}\n`);
          process.stdout.write(`dir: ${summary.jobDir}\n`);
          if (summary.versionDir) {
            process.stdout.write(`version: ${summary.version}\n`);
          }
          process.stdout.write(`verdict: ${summary.verdict ?? 'n/a'}\n`);
          process.stdout.write(`cost: ${summary.costUsd != null ? `$${summary.costUsd.toFixed(4)}` : 'n/a'}\n`);
          if (summary.error) {
            process.stdout.write(`error: ${summary.error}\n`);
          }
        }

        if (opts.gallery) {
          const targetDir = summary.versionDir ?? summary.jobDir;
          const tracePath = path.join(targetDir, 'trace.jsonl');
          const outputDir = opts.galleryDir ?? targetDir;
          const cfg = loadConfig();
          const client = createMinioClient({
            endpoint: cfg.minioEndpoint ?? '',
            region: cfg.minioRegion,
            accessKey: cfg.minioAccessKey,
            secretKey: cfg.minioSecretKey,
            bucket: cfg.minioBucket,
            useSsl: cfg.minioUseSsl,
          });
          const gallery = await generateAuditGallery({ tracePath, outputDir, client });
          process.stdout.write(`gallery: ${gallery.htmlPath} (${gallery.thumbCount} thumb(s))\n`);
        }
      }
    });
}
