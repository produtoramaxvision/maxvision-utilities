import { describe, it, expect, vi } from 'vitest';
import { validateLicense } from '../../../src/license/client.js';

describe('validateLicense', () => {
  it('200 valid → status ok + tier', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: true, tier: 'agency', revoked: false, expiresAt: null }), { status: 200 }),
    );
    const r = await validateLicense(
      { url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' },
      { fetchFn },
    );
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.tier).toBe('agency');
  });

  it('200 revoked → status revoked', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: false, revoked: true }), { status: 200 }),
    );
    const r = await validateLicense({ url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' }, { fetchFn });
    expect(r.status).toBe('revoked');
  });

  it('erro de rede → status unreachable (não invalid)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await validateLicense({ url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' }, { fetchFn });
    expect(r.status).toBe('unreachable');
  });

  it('200 valid:false sem revoked → status invalid', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ valid: false, revoked: false }), { status: 200 }),
    );
    const r = await validateLicense({ url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i' }, { fetchFn });
    expect(r.status).toBe('invalid');
  });
});
