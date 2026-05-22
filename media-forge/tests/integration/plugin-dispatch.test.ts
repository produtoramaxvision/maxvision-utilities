/**
 * MCP plugin dispatch smoke test (P12.5).
 *
 * Gated by RUN_INTEGRATION=1. Spawns `node dist/mcp/server.js` as a subprocess
 * and exercises the JSON-RPC wire protocol.
 *
 * Scope reduction note:
 *   Full Claude Code plugin dispatch (Agent tool spawning agents from agents/)
 *   requires the Claude Code runtime and is NOT testable from a Node subprocess.
 *   That path is verified manually in P15 (production validation checklist).
 *   This test covers the MCP server boundary: initialize, tools/list,
 *   media_validate_environment, media_dry_run_payload, media_help.
 *
 * Usage:
 *   pnpm test:integration:dispatch
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const RUN_INTEGRATION = Boolean(process.env['RUN_INTEGRATION']);
const SERVER_PATH = resolve('dist/mcp/server.js');

// ---------------------------------------------------------------------------
// JSON-RPC framing helper (same pattern as mcp-boot.test.ts)
// Arguments are hardcoded — no user input, no injection risk.
// ---------------------------------------------------------------------------

async function sendAndRead(
  child: ChildProcess,
  message: object,
  timeoutMs = 8_000,
): Promise<unknown> {
  return new Promise((resolveP, rejectP) => {
    const timer = setTimeout(
      () => rejectP(new Error(`timeout waiting for response to id=${(message as { id: unknown }).id}`)),
      timeoutMs,
    );
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
          // partial line — accumulate
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stdin?.write(JSON.stringify(message) + '\n');
  });
}

// ---------------------------------------------------------------------------
// Shared server lifecycle
// ---------------------------------------------------------------------------

async function spawnAndInit(idOffset = 0): Promise<ChildProcess> {
  const child = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GOOGLE_API_KEY: 'dummy-key-for-dispatch-smoke' },
  });

  await sendAndRead(child, {
    jsonrpc: '2.0',
    id: 1 + idOffset,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dispatch-smoke', version: '0' },
    },
  });

  child.stdin?.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
  );

  return child;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_INTEGRATION)('MCP plugin dispatch smoke (RUN_INTEGRATION gated)', () => {
  let child: ChildProcess | null = null;

  beforeAll(() => {
    if (!existsSync(SERVER_PATH)) {
      execSync('pnpm build', { stdio: 'inherit' });
    }
  });

  beforeEach(async () => {
    child = await spawnAndInit();
  });

  afterAll(() => {
    child?.kill('SIGTERM');
    child = null;
  });

  it('tools/list returns exactly 22 tools', async () => {
    const list = await sendAndRead(child!, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (list as { result: { tools: unknown[] } }).result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(22);
  }, 10_000);

  it('media_validate_environment returns ok boolean', async () => {
    const call = await sendAndRead(child!, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'media_validate_environment',
        arguments: {},
      },
    });

    const content = (call as { result: { content: Array<{ type: string; text: string }> } }).result
      .content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);

    // Response text should include ok: true or ok: false
    const text = content[0]?.text ?? '';
    expect(text).toMatch(/ok/i);
  }, 10_000);

  it('media_dry_run_payload returns structured content array', async () => {
    const call = await sendAndRead(child!, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'media_dry_run_payload',
        arguments: {
          op: 'nano-banana-pro',
          params: { prompt: 'test prompt', imageSize: '1K' },
        },
      },
    });

    const content = (call as { result: { content: unknown[] } }).result.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
  }, 10_000);

  it('media_help returns text containing tool names', async () => {
    const call = await sendAndRead(child!, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'media_help',
        arguments: {},
      },
    });

    const content = (call as { result: { content: Array<{ type: string; text: string }> } }).result
      .content;
    expect(Array.isArray(content)).toBe(true);

    const allText = content.map((c) => c.text ?? '').join('\n');
    // Help text must reference core tool names
    expect(allText).toMatch(/media_/i);
    expect(allText.length).toBeGreaterThan(100);
  }, 10_000);
});
