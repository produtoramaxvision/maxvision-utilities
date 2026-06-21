import { Hono } from 'hono';
import type { JobRecord } from '../core/cost-tracker.js';

export interface JobStatusDeps {
  secret: string;
  getJobRecord: (jobId: string) => JobRecord | null;
}

/** Internal oracle for credit-core's sweep. Only explicit 'completed' becomes
 *  'completed' (carrying persisted actualCredits); else 'failed' or 'unknown'. */
export function buildJobStatusRoute(deps: JobStatusDeps) {
  const app = new Hono();
  app.get('/:jobId', (c) => {
    if (c.req.header('x-mf-status-secret') !== deps.secret) return c.json({ error: 'unauthorized' }, 401);
    const rec = deps.getJobRecord(c.req.param('jobId'));
    if (!rec) return c.json({ status: 'unknown' });
    if (rec.status === 'completed') return c.json(rec.actualCredits != null ? { status: 'completed', actualCredits: rec.actualCredits } : { status: 'completed' });
    if (rec.status === 'failed') return c.json({ status: 'failed' });
    return c.json({ status: 'unknown' });
  });
  return app;
}
