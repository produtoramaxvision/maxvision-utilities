// tests/integration/license-gate.test.ts
// Prova literal do exit criteria F-F:
//   - POST /mcp → 403 sob licença revogada
//   - GET /health → 200 (sempre)
//   - GET /metrics → 200 (sempre)
// Gate vive no middleware HTTP (/mcp handler em app.ts) — não no wrap() per-tool.
// Isso garante o status HTTP 403 literal (não JSON-RPC error com HTTP 200).
import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../src/http/app.js';
import type { LicenseState } from '../../src/license/types.js';

const env = { MEDIA_FORGE_API_KEYS: 'key-aaa', GOOGLE_API_KEY: 'test' } as NodeJS.ProcessEnv;
const revoked: LicenseState = { allowed: false, reason: 'license revoked', tier: null, lastCheckedAt: 1 };
const valid: LicenseState = { allowed: true, reason: 'ok', tier: 'agency', lastCheckedAt: 1 };

describe('license gate (self-host C1) — exit criteria', () => {
  it('licença revogada → POST /mcp 403, mas /health e /metrics 200', async () => {
    const app = buildHttpApp({ env, licenseState: () => revoked });
    const mcp = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(mcp.status).toBe(403);

    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/metrics')).status).toBe(200);
  });

  it('auth-first: sem Bearer → 401 mesmo com licença válida', async () => {
    const app = buildHttpApp({ env, licenseState: () => valid });
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('licença válida + auth ok → /mcp não é 401/403', async () => {
    const app = buildHttpApp({ env, licenseState: () => valid });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }),
    });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
