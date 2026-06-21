import { describe, it, expect } from 'vitest';
import { buildHttpApp } from '../../src/http/app.js';
import { NullRateLimiter } from '../../src/http/rate-limiter.js';
import type { IKeyStore, KeyRecord } from '../../src/http/key-store.js';

// Store fake: key-free → free, key-creator → creator
const fakeStore: IKeyStore = {
  async resolve(k: string): Promise<KeyRecord | null> {
    if (k === 'key-free') return { tenantId: 't-free', tier: 'free', scopes: [] };
    if (k === 'key-creator') return { tenantId: 't-creator', tier: 'creator', scopes: [] };
    return null;
  },
};
const limiter = new NullRateLimiter();
const env = { GOOGLE_API_KEY: 'test-key' } as NodeJS.ProcessEnv;

const toolsListBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {},
});

async function listTools(key: string): Promise<string[]> {
  const app = buildHttpApp({ env, store: fakeStore, limiter });
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: toolsListBody,
  });
  if (res.status !== 200) return [];
  const json = (await res.json()) as { result?: { tools?: Array<{ name: string }> } };
  return json.result?.tools?.map((t) => t.name) ?? [];
}

describe('tier gating (integração MCP)', () => {
  it('free tier: media_generate_image presente', async () => {
    const tools = await listTools('key-free');
    expect(tools).toContain('media_generate_image');
  });

  it('free tier: media_generate_video_t2v AUSENTE', async () => {
    const tools = await listTools('key-free');
    expect(tools).not.toContain('media_generate_video_t2v');
  });

  it('free tier: nenhuma tool Higgsfield presente', async () => {
    const tools = await listTools('key-free');
    const higgsfield = tools.filter((t) => t.startsWith('media_higgsfield'));
    expect(higgsfield).toHaveLength(0);
  });

  it('creator tier: media_generate_video_t2v presente', async () => {
    const tools = await listTools('key-creator');
    expect(tools).toContain('media_generate_video_t2v');
  });

  it('creator tier: media_refs_search AUSENTE', async () => {
    const tools = await listTools('key-creator');
    expect(tools).not.toContain('media_refs_search');
  });
});
