import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { licenseGate } from '../../../src/license/middleware.js';
import type { LicenseState } from '../../../src/license/types.js';

function appWith(state: LicenseState) {
  const app = new Hono();
  app.use('/mcp', licenseGate({ getState: () => state }));
  app.post('/mcp', (c) => c.json({ ok: true }));
  return app;
}

describe('licenseGate', () => {
  it('allowed → passa', async () => {
    const app = appWith({ allowed: true, reason: 'ok', tier: 'agency', lastCheckedAt: 1 });
    const res = await app.request('/mcp', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('not allowed → 403 com reason', async () => {
    const app = appWith({ allowed: false, reason: 'license revoked', tier: null, lastCheckedAt: 1 });
    const res = await app.request('/mcp', { method: 'POST' });
    expect(res.status).toBe(403);
    expect((await res.json() as { reason: string }).reason).toContain('revoked');
  });
});
