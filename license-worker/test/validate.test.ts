import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

const ADMIN = { Authorization: 'Bearer test-admin-secret', 'content-type': 'application/json' };

async function issue(tier = 'agency') {
  const r = await SELF.fetch('https://x/admin/issue', {
    method: 'POST', headers: ADMIN, body: JSON.stringify({ tier }),
  });
  return (await r.json() as { licenseKey: string }).licenseKey;
}

describe('license worker', () => {
  it('issue → validate válido (bind instance) → revoke → invalid', async () => {
    const key = await issue();

    const ok = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, instanceId: 'inst-1' }),
    })).json();
    expect(ok).toMatchObject({ valid: true, tier: 'agency', revoked: false });

    // chave presa a inst-1 → inst-2 rejeitada
    const other = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, instanceId: 'inst-2' }),
    })).json();
    expect((other as { valid: boolean }).valid).toBe(false);

    await SELF.fetch('https://x/admin/revoke', {
      method: 'POST', headers: ADMIN, body: JSON.stringify({ licenseKey: key }),
    });
    const after = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: key, instanceId: 'inst-1' }),
    })).json();
    expect(after).toMatchObject({ valid: false, revoked: true });
  });

  it('admin sem secret → 401', async () => {
    const r = await SELF.fetch('https://x/admin/issue', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(401);
  });

  it('chave inexistente → valid:false', async () => {
    const r = await (await SELF.fetch('https://x/validate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'nope', instanceId: 'i' }),
    })).json();
    expect((r as { valid: boolean }).valid).toBe(false);
  });
});
