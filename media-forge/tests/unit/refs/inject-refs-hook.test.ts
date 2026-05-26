import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const HOOK = resolve('hooks/inject-refs.mjs');

function runHook(
  stdin: string,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const proc = spawn('node', [HOOK], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => res({ stdout, stderr, code: code ?? -1 }));
    proc.stdin.write(stdin);
    proc.stdin.end();
  });
}

describe('inject-refs.mjs hook', () => {
  it('emits empty {} when env vars missing', async () => {
    // CLAUDE_PLUGIN_ROOT set but no MINIO_* creds — hook must degrade gracefully
    const result = await runHook(
      JSON.stringify({ tool_input: { prompt: 'dolly-zoom test' } }),
      { CLAUDE_PLUGIN_ROOT: resolve('.') },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });

  it('early-exits when prompt has no taxonomy matches', async () => {
    // Creds present but prompt has no recognisable effect tag → zero MinIO calls
    const result = await runHook(
      JSON.stringify({ tool_input: { prompt: 'plain product shot on white background' } }),
      {
        CLAUDE_PLUGIN_ROOT: resolve('.'),
        MINIO_ENDPOINT: 'https://s3.example.com',
        MINIO_ACCESS_KEY: 'fake',
        MINIO_SECRET_KEY: 'fake',
        MINIO_BUCKET: 'media-forge-refs',
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });

  it('respects tool_input.refs_disabled=true', async () => {
    // Even with a matching prompt and ROOT set, refs_disabled bypasses everything
    const result = await runHook(
      JSON.stringify({ tool_input: { prompt: 'dolly-zoom scene', refs_disabled: true } }),
      { CLAUDE_PLUGIN_ROOT: resolve('.') },
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });
});
