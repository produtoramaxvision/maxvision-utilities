import { describe, it, expect } from 'vitest';
import { httpStatusProbe } from '../src/probe.js';
const mkFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
describe('httpStatusProbe', () => {
  const base = { statusUrlFor: async () => 'http://mcp-server:3000/job-status/J', secret: 's', timeoutMs: 500 };
  it('completed → completed + actualCredits', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: mkFetch(200, { status: 'completed', actualCredits: 12 }) });
    expect(await probe('t', 'J')).toEqual({ status: 'completed', actualCredits: 12 });
  });
  it('failed → failed', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: mkFetch(200, { status: 'failed' }) });
    expect((await probe('t', 'J')).status).toBe('failed');
  });
  it('non-2xx → unknown', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: mkFetch(500, {}) });
    expect((await probe('t', 'J')).status).toBe('unknown');
  });
  it('no status_url → unknown', async () => {
    const probe = httpStatusProbe({ ...base, statusUrlFor: async () => null, fetchImpl: mkFetch(200, { status: 'completed' }) });
    expect((await probe('t', 'J')).status).toBe('unknown');
  });
  it('fetch throws → unknown', async () => {
    const probe = httpStatusProbe({ ...base, fetchImpl: (async () => { throw new Error('net'); }) as unknown as typeof fetch });
    expect((await probe('t', 'J')).status).toBe('unknown');
  });
});
