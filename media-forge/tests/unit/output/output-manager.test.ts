import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeTempDir, type TempDirHandle } from '../../helpers/fs-tempdir.js';
import { OutputManager } from '../../../src/output/output-manager.js';
import { FileSystemError } from '../../../src/core/errors.js';

describe('OutputManager', () => {
  let tmp: TempDirHandle;
  let manager: OutputManager;

  beforeEach(() => {
    tmp = makeTempDir('om-test-');
    manager = new OutputManager({ baseDir: tmp.path });
  });

  afterEach(() => {
    tmp.cleanup();
  });

  // ── 1. createJob returns {jobId, jobDir} inside baseDir/jobs/ ───────────────
  it('createJob returns {jobId, jobDir} with jobDir resolving inside baseDir/jobs/', async () => {
    const handle = await manager.createJob({ name: 'my-project', project: 'acme' });
    expect(handle.jobId).toBeTruthy();
    expect(path.isAbsolute(handle.jobDir)).toBe(true);
    expect(handle.jobDir.startsWith(path.join(tmp.path, 'jobs'))).toBe(true);
    expect(fs.existsSync(handle.jobDir)).toBe(true);
    // Marker file exists
    const marker = JSON.parse(
      fs.readFileSync(path.join(handle.jobDir, '.media-forge-job.json'), 'utf8'),
    ) as { project: string; name: string; createdAt: string };
    expect(marker.project).toBe('acme');
    expect(marker.name).toBe('my-project');
    expect(marker.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── 2. Concurrent: 100 distinct jobIds and dirs ──────────────────────────────
  it('concurrent createJob(x100) produces 100 distinct jobIds and dirs', async () => {
    const handles = await Promise.all(
      Array.from({ length: 100 }, (_, i) => manager.createJob({ name: `job-${i}` })),
    );
    const ids = new Set(handles.map((h) => h.jobId));
    const dirs = new Set(handles.map((h) => h.jobDir));
    expect(ids.size).toBe(100);
    expect(dirs.size).toBe(100);
    for (const h of handles) {
      expect(fs.existsSync(h.jobDir)).toBe(true);
    }
  });

  // ── 3. nextVersion on fresh job returns 'v1' and creates dir ────────────────
  it('nextVersion on fresh job returns v1 and creates the directory', async () => {
    const { jobId } = await manager.createJob({});
    const v = await manager.nextVersion({ jobId });
    expect(v).toBe('v1');
    const vDir = manager.resolveVersionDir(jobId, 'v1');
    expect(fs.existsSync(vDir)).toBe(true);
  });

  // ── 4. nextVersion with existing v1, v3 returns v4 ──────────────────────────
  it('nextVersion with v1 and v3 already present returns v4', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    fs.mkdirSync(path.join(jobDir, 'v1'));
    fs.mkdirSync(path.join(jobDir, 'v3'));
    const v = await manager.nextVersion({ jobId });
    expect(v).toBe('v4');
    expect(fs.existsSync(path.join(jobDir, 'v4'))).toBe(true);
  });

  // ── 5. nextVersion concurrent (10 parallel → v1..v10) ───────────────────────
  it('nextVersion concurrent: 10 parallel calls produce distinct versions v1..v10', async () => {
    const { jobId } = await manager.createJob({});
    const versions = await Promise.all(
      Array.from({ length: 10 }, () => manager.nextVersion({ jobId })),
    );
    const sorted = [...versions].sort((a, b) => {
      const na = parseInt(a.slice(1), 10);
      const nb = parseInt(b.slice(1), 10);
      return na - nb;
    });
    // All versions unique
    expect(new Set(versions).size).toBe(10);
    // All directories exist
    for (const v of versions) {
      const vDir = manager.resolveVersionDir(jobId, v);
      expect(fs.existsSync(vDir)).toBe(true);
    }
    // Must be exactly v1..v10 (retry loop re-reads max on each attempt, so no gaps)
    const nums = sorted.map((v) => parseInt(v.slice(1), 10));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // ── 6. saveAsset writes file with computed extension from mime ───────────────
  it('saveAsset writes a file with the correct extension for the given mime', async () => {
    const { jobId } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    const buf = Buffer.from('fake-png-data');
    const result = await manager.saveAsset({
      jobId,
      version: 'v1',
      kind: 'image',
      bytes: buf,
      mime: 'image/png',
    });
    expect(result.filename).toBe('asset.png');
    expect(result.bytes).toBe(buf.length);
    expect(result.mime).toBe('image/png');
    expect(path.isAbsolute(result.path)).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);
    expect(fs.readFileSync(result.path)).toEqual(buf);
  });

  // ── 7. saveAsset with custom filename uses that filename verbatim ────────────
  it('saveAsset with custom filename uses that filename verbatim', async () => {
    const { jobId } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    const buf = Buffer.from('video-data');
    const result = await manager.saveAsset({
      jobId,
      version: 'v1',
      kind: 'video',
      bytes: buf,
      mime: 'video/mp4',
      filename: 'my-custom-output.mp4',
    });
    expect(result.filename).toBe('my-custom-output.mp4');
    expect(fs.existsSync(result.path)).toBe(true);
  });

  // ── 8. saveMetadata writes valid JSON ────────────────────────────────────────
  it('saveMetadata writes valid JSON that round-trips via JSON.parse', async () => {
    const { jobId } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    const meta = { model: 'test-model', prompt: 'hello world', seed: 42 };
    await manager.saveMetadata({ jobId, version: 'v1', metadata: meta });
    const vDir = manager.resolveVersionDir(jobId, 'v1');
    const raw = fs.readFileSync(path.join(vDir, 'metadata.json'), 'utf8');
    const parsed = JSON.parse(raw) as typeof meta;
    expect(parsed).toEqual(meta);
  });

  // ── 9. savePayload REDACTS api keys via sanitize ──────────────────────────────
  it('savePayload redacts apiKey via sanitize before writing', async () => {
    const { jobId } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    const payload = { apiKey: 'real-secret-here', model: 'test', prompt: 'hello' };
    await manager.savePayload({ jobId, version: 'v1', payload });
    const vDir = manager.resolveVersionDir(jobId, 'v1');
    const raw = fs.readFileSync(path.join(vDir, 'payload.json'), 'utf8');
    expect(raw).not.toContain('real-secret-here');
    expect(raw).toContain('****');
    const parsed = JSON.parse(raw) as { apiKey: string; model: string };
    expect(parsed.model).toBe('test');
  });

  // ── 10. savePrompt writes text with trailing newline ─────────────────────────
  it('savePrompt writes text with a trailing newline', async () => {
    const { jobId } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    await manager.savePrompt({ jobId, version: 'v1', prompt: 'Generate a sunset' });
    const vDir = manager.resolveVersionDir(jobId, 'v1');
    const raw = fs.readFileSync(path.join(vDir, 'prompt.txt'), 'utf8');
    expect(raw).toBe('Generate a sunset\n');
  });

  it('savePrompt does not double-append newline when prompt already ends with newline', async () => {
    const { jobId } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    await manager.savePrompt({ jobId, version: 'v1', prompt: 'Prompt with newline\n' });
    const vDir = manager.resolveVersionDir(jobId, 'v1');
    const raw = fs.readFileSync(path.join(vDir, 'prompt.txt'), 'utf8');
    expect(raw).toBe('Prompt with newline\n');
  });

  // ── 11. writeSummary produces SUMMARY.md with required fields ─────────────────
  it('writeSummary produces SUMMARY.md containing all 5 required fields', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    const buf = Buffer.from('img');
    const asset = await manager.saveAsset({ jobId, version: 'v1', kind: 'image', bytes: buf, mime: 'image/png' });
    await manager.writeSummary({
      jobId,
      finalVersion: 'v1',
      brief: 'Test generation for sunset theme',
      finalAssetPath: asset.path,
      totalCostUsd: 0.24,
    });
    const summaryPath = path.join(jobDir, 'SUMMARY.md');
    expect(fs.existsSync(summaryPath)).toBe(true);
    const content = fs.readFileSync(summaryPath, 'utf8');
    expect(content).toContain(`# Job ${jobId}`);
    expect(content).toContain('**Final version:** v1');
    expect(content).toContain('**Final asset:**');
    expect(content).toContain('**Total cost:** $0.2400 USD');
    expect(content).toContain('Test generation for sunset theme');
  });

  // ── 12. markFinal copies all files from version into final/ ──────────────────
  it('markFinal copies all files from v2 into final/', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    // Create v1 and v2
    await manager.nextVersion({ jobId });
    await manager.nextVersion({ jobId });
    // Write 2 files to v2
    const v2Dir = path.join(jobDir, 'v2');
    fs.writeFileSync(path.join(v2Dir, 'asset.png'), Buffer.from('png-data'));
    fs.writeFileSync(path.join(v2Dir, 'metadata.json'), '{"ok":true}');

    const { finalDir, copies } = await manager.markFinal({ jobId, version: 'v2' });
    expect(path.isAbsolute(finalDir)).toBe(true);
    expect(finalDir).toBe(path.join(jobDir, 'final'));
    expect(copies.length).toBe(2);
    expect(copies.every((c) => path.isAbsolute(c))).toBe(true);
    expect(fs.existsSync(path.join(finalDir, 'asset.png'))).toBe(true);
    expect(fs.existsSync(path.join(finalDir, 'metadata.json'))).toBe(true);
  });

  // ── 13. markFinal REPLACES final/ on second call ─────────────────────────────
  it('markFinal replaces final/ on second call with no orphans', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    await manager.nextVersion({ jobId });

    const v1Dir = path.join(jobDir, 'v1');
    const v2Dir = path.join(jobDir, 'v2');
    fs.writeFileSync(path.join(v1Dir, 'old-file.png'), Buffer.from('old'));
    fs.writeFileSync(path.join(v2Dir, 'new-file.png'), Buffer.from('new'));

    // First markFinal from v1
    await manager.markFinal({ jobId, version: 'v1' });
    expect(fs.existsSync(path.join(jobDir, 'final', 'old-file.png'))).toBe(true);

    // Second markFinal from v2 — should replace
    await manager.markFinal({ jobId, version: 'v2' });
    expect(fs.existsSync(path.join(jobDir, 'final', 'new-file.png'))).toBe(true);
    // Orphan from previous v1 must be gone
    expect(fs.existsSync(path.join(jobDir, 'final', 'old-file.png'))).toBe(false);
  });

  // ── 14. markFinal: copies[0] is absolute (Windows path safety) ───────────────
  it('markFinal returns copies with absolute paths (cross-platform)', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    await manager.nextVersion({ jobId });
    const v1Dir = path.join(jobDir, 'v1');
    fs.writeFileSync(path.join(v1Dir, 'asset.mp4'), Buffer.from('video'));

    const { copies } = await manager.markFinal({ jobId, version: 'v1' });
    expect(copies.length).toBeGreaterThan(0);
    for (const c of copies) {
      expect(path.isAbsolute(c)).toBe(true);
    }
  });

  // ── 15. appendCostLog adds JSONL line with model, usd, timestamp ──────────────
  it('appendCostLog adds a JSONL line with model, usd, and a timestamp', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    await manager.appendCostLog({ jobId, model: 'imagen-4', usd: 0.06 });
    const logPath = path.join(jobDir, 'cost.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!) as { model: string; usd: number; ts: string };
    expect(entry.model).toBe('imagen-4');
    expect(entry.usd).toBe(0.06);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appendCostLog includes serialized breakdown when provided', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    await manager.appendCostLog({
      jobId,
      model: 'veo-3.1',
      usd: 0.4,
      breakdown: { base: 0.3, audio: 0.1 },
    });
    const logPath = path.join(jobDir, 'cost.jsonl');
    const raw = fs.readFileSync(logPath, 'utf8');
    expect(raw).toContain('veo-3.1');
  });

  // ── 16. appendCostLog atomic under concurrent calls ──────────────────────────
  it('appendCostLog under 10 concurrent calls produces 10 lines without truncation', async () => {
    const { jobId, jobDir } = await manager.createJob({});
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        manager.appendCostLog({ jobId, model: `model-${i}`, usd: i * 0.01 }),
      ),
    );
    const logPath = path.join(jobDir, 'cost.jsonl');
    const lines = fs.readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    expect(lines.length).toBe(10);
    // All lines are valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  // ── 17. Path traversal: resolveJobDir throws FileSystemError ─────────────────
  it('resolveJobDir with traversal path throws FileSystemError', () => {
    expect(() => manager.resolveJobDir('../../../etc/passwd')).toThrow(FileSystemError);
  });

  // ── 18. Path traversal: saveAsset with traversal version throws ───────────────
  it('saveAsset with traversal in version throws FileSystemError', async () => {
    const { jobId } = await manager.createJob({});
    await expect(
      manager.saveAsset({
        jobId,
        version: '../escape',
        kind: 'image',
        bytes: Buffer.from('x'),
        mime: 'image/png',
      }),
    ).rejects.toThrow(FileSystemError);
  });
});
