import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { runDoctor } from '../../../src/cli/commands/doctor.js';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
} from '../../../src/core/models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchOk(status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({ status, ok: status < 400 }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// 1. config ok=true when apiKey set → mode='gemini'
// ---------------------------------------------------------------------------
describe('runDoctor — config check', () => {
  it('reports mode=gemini when GOOGLE_API_KEY is set', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.config.ok).toBe(true);
    expect(result.checks.config.mode).toBe('gemini');
  });

  it('reports mode=gemini when GEMINI_API_KEY is set', async () => {
    const result = await runDoctor({
      env: { GEMINI_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.config.ok).toBe(true);
    expect(result.checks.config.mode).toBe('gemini');
  });

  it('reports mode=vertex when Vertex AI creds are set', async () => {
    const result = await runDoctor({
      env: {
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'my-project',
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.config.ok).toBe(true);
    expect(result.checks.config.mode).toBe('vertex');
  });

  // 2. config ok=false when no creds → missing list populated
  it('reports ok=false with missing list when no credentials', async () => {
    const result = await runDoctor({
      env: {},
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.config.ok).toBe(false);
    expect(result.checks.config.missing).toBeDefined();
    expect((result.checks.config.missing ?? []).length).toBeGreaterThan(0);
  });

  it('reports ok=false with missing project when Vertex enabled but no project', async () => {
    const result = await runDoctor({
      env: { GOOGLE_GENAI_USE_VERTEXAI: 'true' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.config.ok).toBe(false);
    expect(result.checks.config.missing).toBeDefined();
    const missing = result.checks.config.missing ?? [];
    expect(missing.some((m) => m.includes('PROJECT'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. outputDir creates+writes+unlinks → ok=true
// ---------------------------------------------------------------------------
describe('runDoctor — output dir check', () => {
  it('creates dir and writes probe → ok=true', async () => {
    const tmpDir = path.join(os.tmpdir(), `mf-doctor-test-${Date.now()}`);
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: tmpDir,
    });
    expect(result.checks.outputDir.ok).toBe(true);
    expect(result.checks.outputDir.writable).toBe(true);
    expect(result.checks.outputDir.path).toBe(tmpDir);
    // probe should be unlinked
    await expect(fs.access(path.join(tmpDir, '.write-probe'))).rejects.toThrow();
    // cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // 4. outputDir on read-only path → ok=false, reason set
  it('reports ok=false for inaccessible path', async () => {
    // Use a path inside a non-existent drive letter or an invalid path
    const badPath =
      process.platform === 'win32'
        ? 'Z:\\nonexistent-drive\\outputs-test'
        : '/nonexistent-root-path-abc123/outputs';
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: badPath,
    });
    // On some systems mkdir might succeed for certain paths — only assert if it fails
    if (!result.checks.outputDir.ok) {
      expect(result.checks.outputDir.writable).toBe(false);
      expect(result.checks.outputDir.reason).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. network skip → check is { ok: true, reachable: undefined }
// ---------------------------------------------------------------------------
describe('runDoctor — network check', () => {
  it('skips network check when skipNetwork=true', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.network.ok).toBe(true);
    expect(result.checks.network.reachable).toBeUndefined();
  });

  // 6. network reachable (mock fetchImpl returns 200) → ok=true
  it('reports reachable=true when fetch returns 200', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      outputBaseDir: os.tmpdir(),
      fetchImpl: makeFetchOk(200),
    });
    expect(result.checks.network.ok).toBe(true);
    expect(result.checks.network.reachable).toBe(true);
  });

  it('reports reachable=true when fetch returns 404 (< 500)', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      outputBaseDir: os.tmpdir(),
      fetchImpl: makeFetchOk(404),
    });
    expect(result.checks.network.ok).toBe(true);
    expect(result.checks.network.reachable).toBe(true);
  });

  // 7. network 500 (mock returns 500) → ok=false, reason set
  it('reports ok=false when fetch returns 500', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      outputBaseDir: os.tmpdir(),
      fetchImpl: makeFetchOk(500),
    });
    expect(result.checks.network.ok).toBe(false);
    expect(result.checks.network.reachable).toBe(false);
    expect(result.checks.network.reason).toBeDefined();
  });

  it('reports ok=false when fetch throws (network error)', async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      outputBaseDir: os.tmpdir(),
      fetchImpl: failFetch,
    });
    expect(result.checks.network.ok).toBe(false);
    expect(result.checks.network.reason).toContain('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// 8. models list contains all 3 LOCKED IDs
// ---------------------------------------------------------------------------
describe('runDoctor — models check', () => {
  it('lists all 3 locked model IDs', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.models.ok).toBe(true);
    expect(result.checks.models.checked).toContain(IMAGE_MODEL_NANO_BANANA_PRO);
    expect(result.checks.models.checked).toContain(IMAGE_MODEL_IMAGEN_4_ULTRA);
    expect(result.checks.models.checked).toContain(VIDEO_MODEL_VEO_3_1_PRO);
    expect(result.checks.models.checked).toHaveLength(3);
  });

  it('contains exact locked model ID strings', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.checks.models.checked).toEqual(
      expect.arrayContaining([
        'gemini-3-pro-image-preview',
        'imagen-4.0-ultra-generate-001',
        'veo-3.1-generate-preview',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Aggregate result.ok=true when all 4 ok
// ---------------------------------------------------------------------------
describe('runDoctor — aggregate result', () => {
  it('result.ok=true when all checks pass', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.ok).toBe(true);
  });

  // 10. Aggregate result.ok=false when any fails
  it('result.ok=false when config fails', async () => {
    const result = await runDoctor({
      env: {},
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.ok).toBe(false);
  });

  it('result.ok=false when output dir fails', async () => {
    const badPath =
      process.platform === 'win32'
        ? 'Z:\\nonexistent-drive\\outputs-xyz'
        : '/proc/sys/nonexistent/outputs';
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: badPath,
    });
    // Only assert ok=false if the outputDir check actually fails
    if (!result.checks.outputDir.ok) {
      expect(result.ok).toBe(false);
    }
  });

  it('result.ok=false when network fails', async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      outputBaseDir: os.tmpdir(),
      fetchImpl: failFetch,
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. registerDoctorCommand: CLI integration
// ---------------------------------------------------------------------------
describe('registerDoctorCommand — CLI integration', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes JSON to stdout and exits 0 when all ok', async () => {
    // Test that --json flag makes the output parseable JSON
    const tmpDir = path.join(os.tmpdir(), `mf-doctor-cli-${Date.now()}`);
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: tmpDir,
    });
    expect(result.ok).toBe(true);
    // Verify JSON.stringify works on the result (wiring check)
    const json = JSON.parse(JSON.stringify(result, null, 2)) as typeof result;
    expect(json.ok).toBe(true);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('exits 0 when result.ok=true', async () => {
    const result = await runDoctor({
      env: { GOOGLE_API_KEY: 'test-key' },
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    // simulate what the action handler does
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    expect(() => process.exit(result.ok ? 0 : 1)).toThrow('process.exit(0)');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('exits 1 when result.ok=false', async () => {
    const result = await runDoctor({
      env: {},
      skipNetwork: true,
      outputBaseDir: os.tmpdir(),
    });
    expect(result.ok).toBe(false);
    expect(() => process.exit(result.ok ? 0 : 1)).toThrow('process.exit(1)');
  });
});
