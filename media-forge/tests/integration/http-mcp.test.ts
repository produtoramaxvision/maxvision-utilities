import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../src/http/app.js';

const env = { MEDIA_FORGE_API_KEYS: 'key-aaa', GOOGLE_API_KEY: 'test' } as NodeJS.ProcessEnv;

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
});

describe('POST /mcp', () => {
  it('initialize autenticado retorna serverInfo', async () => {
    const app = buildHttpApp({ env });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer key-aaa', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: initBody,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe('media-forge');
  });
});
