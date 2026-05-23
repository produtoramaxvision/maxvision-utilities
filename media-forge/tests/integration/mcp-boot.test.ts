/**
 * Integration smoke test for the MCP server (P8.3).
 *
 * Gated behind RUN_INTEGRATION=1 to avoid blocking CI.
 * Requires a built dist/ — run `pnpm build` first.
 *
 * Usage:
 *   RUN_INTEGRATION=1 pnpm test tests/integration/mcp-boot.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const RUN_INTEGRATION = Boolean(process.env['RUN_INTEGRATION']);

async function sendAndRead(
  child: ChildProcess,
  message: object,
  timeoutMs = 5000,
): Promise<unknown> {
  return new Promise((resolveP, rejectP) => {
    const timer = setTimeout(() => rejectP(new Error('timeout waiting for response')), timeoutMs);
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { jsonrpc?: string; id?: unknown };
          if (
            parsed.jsonrpc === '2.0' &&
            parsed.id === (message as { id: unknown }).id
          ) {
            child.stdout?.off('data', onData);
            clearTimeout(timer);
            resolveP(parsed);
            return;
          }
        } catch {
          // partial line — continue accumulating
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stdin?.write(JSON.stringify(message) + '\n');
  });
}

describe.skipIf(!RUN_INTEGRATION)('MCP server boot (integration)', () => {
  let child: ChildProcess | null = null;
  const serverPath = resolve('dist/mcp/server.js');

  beforeAll(async () => {
    if (!existsSync(serverPath)) {
      execSync('pnpm build', { stdio: 'inherit' });
    }
  });

  afterAll(() => {
    child?.kill('SIGTERM');
    child = null;
  });

  it('initializes and lists 22 tools', async () => {
    child = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GOOGLE_API_KEY: 'dummy-key-for-smoke' },
    });

    const init = await sendAndRead(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    });

    expect(init).toMatchObject({
      result: { serverInfo: { name: 'media-forge' } },
    });

    child.stdin?.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );

    const list = await sendAndRead(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(
      (list as { result: { tools: unknown[] } }).result.tools,
    ).toHaveLength(22);
  }, 10_000);

  it('handles tools/call media_dry_run_payload', async () => {
    if (!child || child.killed) {
      child = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GOOGLE_API_KEY: 'dummy' },
      });
      await sendAndRead(child, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 's', version: '0' },
        },
      });
      child.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
      );
    }

    const call = await sendAndRead(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'media_dry_run_payload',
        arguments: { op: 'test', params: {} },
      },
    });

    expect((call as { result: { content: unknown[] } }).result.content).toBeTruthy();
    expect(
      Array.isArray((call as { result: { content: unknown[] } }).result.content),
    ).toBe(true);
  }, 10_000);
});
