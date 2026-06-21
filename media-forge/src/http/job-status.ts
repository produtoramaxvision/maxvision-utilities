import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { JobRecord } from '../core/cost-tracker.js';

export interface JobStatusDeps {
  secret: string;
  getJobRecord: (jobId: string) => JobRecord | null;
}

/** Constant-time secret check that FAILS CLOSED: an empty configured secret or an
 *  empty/absent incoming header is always rejected (no fail-open when the env is
 *  unset). Length mismatch short-circuits before timingSafeEqual (which throws on
 *  unequal-length buffers); for a 32+ char random secret the length leak is moot. */
function secretMatches(provided: string, expected: string): boolean {
  if (expected.length === 0 || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Internal oracle for credit-core's sweep. Only explicit 'completed' becomes
 *  'completed' (carrying persisted actualCredits); else 'failed' or 'unknown'. */
export function buildJobStatusRoute(deps: JobStatusDeps) {
  const app = new Hono();
  app.get('/:jobId', (c) => {
    const provided = c.req.header('x-mf-status-secret') ?? '';
    if (!secretMatches(provided, deps.secret)) return c.json({ error: 'unauthorized' }, 401);
    // Robust: a missing/unopenable cost.db (fresh container with no jobs yet) must
    // degrade to 'unknown' (→ credit-core RELEASES, safe), never a 500 that looks
    // like an outage. getJobRecord throws ERR_SQLITE_ERROR when the db file/dir
    // is absent — treat any lookup failure as "job not known".
    let rec: JobRecord | null;
    try {
      rec = deps.getJobRecord(c.req.param('jobId'));
    } catch {
      return c.json({ status: 'unknown' });
    }
    if (!rec) return c.json({ status: 'unknown' });
    if (rec.status === 'completed') return c.json(rec.actualCredits != null ? { status: 'completed', actualCredits: rec.actualCredits } : { status: 'completed' });
    if (rec.status === 'failed') return c.json({ status: 'failed' });
    return c.json({ status: 'unknown' });
  });
  return app;
}
