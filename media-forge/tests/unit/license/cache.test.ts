import { describe, it, expect, vi } from 'vitest';
import { LicenseCache } from '../../../src/license/cache.js';
import type { LicenseStatus } from '../../../src/license/types.js';

function cacheWith(seq: LicenseStatus[]) {
  const calls = [...seq];
  const validate = vi.fn(async () => calls.shift() ?? ({ status: 'unreachable', reason: 'drained' } as LicenseStatus));
  return new LicenseCache({
    url: 'https://lic/validate', licenseKey: 'k', instanceId: 'i',
    revalidateMs: 1000, graceMs: 10_000,
  }, { validate });
}

describe('LicenseCache', () => {
  it('boot ok → allowed', async () => {
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    expect(c.getState().allowed).toBe(true);
    c.stop();
  });

  it('boot unreachable (sem cache bom) → fail-closed', async () => {
    const c = cacheWith([{ status: 'unreachable', reason: 'net' }]);
    await c.start();
    expect(c.getState().allowed).toBe(false);
    c.stop();
  });

  it('ok depois revoked → allowed false imediato', async () => {
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    expect(c.getState().allowed).toBe(true);
    await c.revalidateNow({ status: 'revoked', reason: 'r' });
    expect(c.getState().allowed).toBe(false);
    c.stop();
  });

  it('ok depois unreachable dentro da graça → allowed (grace)', async () => {
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    await c.revalidateNow({ status: 'unreachable', reason: 'net' });
    expect(c.getState().allowed).toBe(true); // dentro de graceMs
    c.stop();
  });

  it('ok depois unreachable além da graça → allowed false', async () => {
    vi.useFakeTimers();
    const c = cacheWith([{ status: 'ok', tier: 'agency', expiresAt: null }]);
    await c.start();
    vi.advanceTimersByTime(20_000); // > graceMs
    await c.revalidateNow({ status: 'unreachable', reason: 'net' });
    expect(c.getState().allowed).toBe(false);
    c.stop();
    vi.useRealTimers();
  });
});
