import { describe, it, expect } from 'vitest';
import { buildJobStatusRoute } from '../../../src/http/job-status.js';
const route = (rec: { status: string; actualCredits: number | null } | null) => buildJobStatusRoute({
  secret: 's', getJobRecord: () => (rec as never),
});
describe('/job-status/:jobId', () => {
  it('completed → {status:completed, actualCredits}', async () => {
    const res = await route({ status: 'completed', actualCredits: 25 }).request('/J', { headers: { 'x-mf-status-secret': 's' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'completed', actualCredits: 25 });
  });
  it('failed → {status:failed}', async () => {
    const res = await route({ status: 'failed', actualCredits: null }).request('/J', { headers: { 'x-mf-status-secret': 's' } });
    expect(await res.json()).toEqual({ status: 'failed' });
  });
  it('pending → {status:unknown}', async () => {
    const res = await route({ status: 'pending', actualCredits: null }).request('/J', { headers: { 'x-mf-status-secret': 's' } });
    expect(await res.json()).toEqual({ status: 'unknown' });
  });
  it('missing record → {status:unknown}', async () => {
    const res = await route(null).request('/MISSING', { headers: { 'x-mf-status-secret': 's' } });
    expect(await res.json()).toEqual({ status: 'unknown' });
  });
  it('bad secret → 401', async () => {
    const res = await route({ status: 'completed', actualCredits: 25 }).request('/J', { headers: { 'x-mf-status-secret': 'wrong' } });
    expect(res.status).toBe(401);
  });
  it('FAIL CLOSED: empty configured secret + no header → 401 (no fail-open)', async () => {
    const open = buildJobStatusRoute({ secret: '', getJobRecord: () => ({ status: 'completed', actualCredits: 25 } as never) });
    expect((await open.request('/J')).status).toBe(401);
    expect((await open.request('/J', { headers: { 'x-mf-status-secret': '' } })).status).toBe(401);
  });
  it('FAIL CLOSED: valid secret but empty incoming header → 401', async () => {
    const res = await route({ status: 'completed', actualCredits: 25 }).request('/J', { headers: { 'x-mf-status-secret': '' } });
    expect(res.status).toBe(401);
  });
});
