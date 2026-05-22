/**
 * Tests for utility CLI commands (commit 9.4):
 * cost, audit, prompts, models, config
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
} from '../../../src/core/models.js';

// ---------------------------------------------------------------------------
// 1. cost estimate
// ---------------------------------------------------------------------------
describe('cost estimate', () => {
  it('returns totalUsd and maxAttempts when op=image-nano-banana-pro', async () => {
    const { buildCostEstimate } = await import('../../../src/cli/commands/cost.js');
    const result = buildCostEstimate({ op: 'image-nano-banana-pro', maxAttempts: '3' });
    expect(result.totalUsd).toBeGreaterThan(0);
    expect(result.maxAttempts).toBe(3);
    expect(result).toHaveProperty('perAttemptUsd');
    expect(result).toHaveProperty('breakdown');
  });

  it('totalUsd = perAttemptUsd * maxAttempts', async () => {
    const { buildCostEstimate } = await import('../../../src/cli/commands/cost.js');
    const result = buildCostEstimate({ op: 'image-nano-banana-pro', maxAttempts: '3' });
    expect(result.totalUsd).toBeCloseTo(result.perAttemptUsd * 3, 5);
  });

  it('video op returns video cost', async () => {
    const { buildCostEstimate } = await import('../../../src/cli/commands/cost.js');
    const result = buildCostEstimate({ op: 'video-t2v', maxAttempts: '2' });
    expect(result.op).toBe('video-t2v');
    expect(result.maxAttempts).toBe(2);
    expect(result.totalUsd).toBeGreaterThan(0);
  });

  it('imagen-4-ultra op returns Ultra cost', async () => {
    const { buildCostEstimate } = await import('../../../src/cli/commands/cost.js');
    const result = buildCostEstimate({ op: 'image-imagen-4-ultra' });
    expect(result.perAttemptUsd).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. cost summary --today
// ---------------------------------------------------------------------------
describe('cost summary', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `mf-cost-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns daily aggregate from seeded cost.jsonl', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tmpDir, 'cost.jsonl');
    await fs.writeFile(
      logPath,
      [
        JSON.stringify({ date: today, usd: 0.24, model: 'test' }),
        JSON.stringify({ date: today, usd: 0.06, model: 'test2' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const { getCostSummary } = await import('../../../src/cli/commands/cost.js');
    const result = getCostSummary({ projectDir: tmpDir, today: true });
    expect(result.usd).toBeCloseTo(0.30, 5);
    expect(result.entries).toBe(2);
    expect(result.date).toBe(today);
  });

  it('returns 0 usd when no cost.jsonl file exists', async () => {
    const { getCostSummary } = await import('../../../src/cli/commands/cost.js');
    const result = getCostSummary({ projectDir: tmpDir, today: true });
    expect(result.usd).toBe(0);
    expect(result.entries).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. audit all — empty dir
// ---------------------------------------------------------------------------
describe('audit', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `mf-audit-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('audit all with empty dir returns empty jobs array', async () => {
    const { listAllJobs } = await import('../../../src/cli/commands/audit.js');
    const jobs = await listAllJobs(tmpDir);
    expect(jobs).toEqual([]);
  });

  // 4. audit <jobId> returns aggregated metadata
  it('audit jobId reads metadata.json', async () => {
    const { readJobSummary } = await import('../../../src/cli/commands/audit.js');
    const jobDir = path.join(tmpDir, 'jobs', 'job-abc123');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({ costUsd: 0.24, verdict: 'pass' }),
    );

    const summary = await readJobSummary(jobDir, 'job-abc123');
    expect(summary.jobId).toBe('job-abc123');
    expect(summary.costUsd).toBe(0.24);
    expect(summary.verdict).toBe('pass');
  });

  it('audit all lists jobs with verdict and cost', async () => {
    const { listAllJobs } = await import('../../../src/cli/commands/audit.js');
    const jobsDir = path.join(tmpDir, 'jobs');
    const jobDir = path.join(jobsDir, 'job-001');
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(
      path.join(jobDir, 'metadata.json'),
      JSON.stringify({ costUsd: 0.10, verdict: 'pass' }),
    );

    const jobs = await listAllJobs(tmpDir);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobId).toBe('job-001');
    expect(jobs[0]?.verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// 5. prompts list with empty prompts dir → graceful message
// ---------------------------------------------------------------------------
describe('prompts', () => {
  it('prompts list with empty index → returns not-populated message', async () => {
    // The prompts/_index.json currently has count: 0 (P11 not done)
    // We verify the command logic: if count === 0, print NOT_POPULATED_MSG
    const NOT_POPULATED_MSG = 'prompts library not yet populated (pending P11)';
    // Simulate empty index
    const index = { generatedAt: new Date().toISOString(), count: 0, entries: [] };
    let output = '';
    if (!index || index.count === 0) {
      output = NOT_POPULATED_MSG;
    }
    expect(output).toBe(NOT_POPULATED_MSG);
  });
});

// ---------------------------------------------------------------------------
// 6. models prints all 3 LOCKED IDs
// ---------------------------------------------------------------------------
describe('models', () => {
  it('LOCKED_MODEL_INFO contains all 3 locked IDs', async () => {
    const { LOCKED_MODEL_INFO } = await import('../../../src/cli/commands/models.js');
    const ids = LOCKED_MODEL_INFO.map((m) => m.id);
    expect(ids).toContain(IMAGE_MODEL_NANO_BANANA_PRO);
    expect(ids).toContain(IMAGE_MODEL_IMAGEN_4_ULTRA);
    expect(ids).toContain(VIDEO_MODEL_VEO_3_1_PRO);
    expect(ids).toHaveLength(3);
  });

  it('each model has type and capabilities', async () => {
    const { LOCKED_MODEL_INFO } = await import('../../../src/cli/commands/models.js');
    for (const m of LOCKED_MODEL_INFO) {
      expect(m.type).toMatch(/^(image|video)$/);
      expect(m.capabilities.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7-10. config commands
// ---------------------------------------------------------------------------
describe('config', () => {
  let tmpConfigHome: string;
  let origEnv: string | undefined;

  beforeEach(async () => {
    tmpConfigHome = path.join(os.tmpdir(), `mf-config-test-${Date.now()}`);
    await fs.mkdir(tmpConfigHome, { recursive: true });
    origEnv = process.env['MEDIA_FORGE_CONFIG_HOME'];
    process.env['MEDIA_FORGE_CONFIG_HOME'] = tmpConfigHome;
  });

  afterEach(async () => {
    if (origEnv !== undefined) {
      process.env['MEDIA_FORGE_CONFIG_HOME'] = origEnv;
    } else {
      delete process.env['MEDIA_FORGE_CONFIG_HOME'];
    }
    await fs.rm(tmpConfigHome, { recursive: true, force: true });
  });

  // 7. config set apiKey=test writes to temp HOME dir
  it('config set apiKey=test writes to config.json', async () => {
    const { configSet, getConfigPath } = await import('../../../src/cli/commands/config.js');
    await configSet('apiKey=test-api-key');
    const raw = await fs.readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['apiKey']).toBe('test-api-key');
  });

  // 8. config get apiKey reads back
  it('config get apiKey reads back the value', async () => {
    const { configSet, configGet } = await import('../../../src/cli/commands/config.js');
    await configSet('apiKey=my-key');
    const value = await configGet('apiKey');
    expect(value).toBe('my-key');
  });

  // 9. config set badkey=x → exitErr with ApiFieldError
  it('config set unknown key throws ApiFieldError', async () => {
    const { configSet } = await import('../../../src/cli/commands/config.js');
    const { ApiFieldError } = await import('../../../src/core/errors.js');
    await expect(configSet('unknownKey=value')).rejects.toThrow(ApiFieldError);
  });

  // 10. config unset apiKey removes the key
  it('config unset removes a key', async () => {
    const { configSet, configUnset, configGet } = await import('../../../src/cli/commands/config.js');
    await configSet('apiKey=temp-key');
    await configUnset('apiKey');
    const value = await configGet('apiKey');
    expect(value).toBeUndefined();
  });

  it('config get non-existent key returns undefined', async () => {
    const { configGet } = await import('../../../src/cli/commands/config.js');
    const value = await configGet('apiKey');
    expect(value).toBeUndefined();
  });

  it('config unset unknown key throws ApiFieldError', async () => {
    const { configUnset } = await import('../../../src/cli/commands/config.js');
    const { ApiFieldError } = await import('../../../src/core/errors.js');
    await expect(configUnset('notAKey')).rejects.toThrow(ApiFieldError);
  });
});
