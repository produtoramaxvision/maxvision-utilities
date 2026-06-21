import { describe, it, expect } from 'vitest';
import { httpStatusProbe, isProbeUrlAllowed } from '../src/probe.js';
const mkFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
describe('httpStatusProbe', () => {
  const base = { statusUrlFor: async () => 'http://mcp-server:3000/job-status/J', secret: 's', timeoutMs: 500, allowedHosts: ['mcp-server'] };
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

  // SSRF / secret-exfiltration guard: a caller-supplied status_url pointing
  // anywhere outside the allowlist must NOT receive the secret (no fetch at all).
  it('SSRF: disallowed host → unknown and the secret is never sent', async () => {
    let called = false;
    const spyFetch = (async () => { called = true; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const probe = httpStatusProbe({ ...base, statusUrlFor: async () => 'http://attacker.example.com/x', fetchImpl: spyFetch });
    expect((await probe('t', 'J')).status).toBe('unknown');
    expect(called).toBe(false);
  });
  it('SSRF: metadata IP / loopback / userinfo all rejected', () => {
    expect(isProbeUrlAllowed('http://169.254.169.254/latest/meta-data', ['mcp-server'])).toBe(false);
    expect(isProbeUrlAllowed('http://127.0.0.1:3000/x', ['mcp-server'])).toBe(false);
    expect(isProbeUrlAllowed('http://localhost/x', ['mcp-server'])).toBe(false);
    expect(isProbeUrlAllowed('http://mcp-server:3000@attacker.com/x', ['mcp-server'])).toBe(false); // userinfo trick
    expect(isProbeUrlAllowed('file:///etc/passwd', ['mcp-server'])).toBe(false);
    expect(isProbeUrlAllowed('http://mcp-server:3000/job-status/J', ['mcp-server'])).toBe(true); // allowed
  });
});
