# SE2 — Gallery records every video completion (tenant-attributed, webhook path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) or maxvision:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every completed video generation land in the gallery, attributed to the right tenant, including the async webhook completion path (today only the synchronous `media_kling_download` poll writes to the gallery).

**Architecture:** Providers stay tenancy-agnostic (they only submit + cost-track). The MCP handler annotates the freshly-submitted `video_jobs` row with the caller's `tenantId` (a new `setJobTenant`). On provider callback, each webhook handler reads the job record (now carrying `tenant_id` + `actual_usd`) and writes a gallery row. Gallery insert is already idempotent (`ON CONFLICT (generation_id) DO NOTHING`), so the existing sync kling write and the webhook write de-duplicate on the same `generation_id = jobId`.

**Tech Stack:** Node 22 ESM, TypeScript strict, `node:sqlite` (cost-tracker `video_jobs`), pg (gallery `generations`), Hono (webhook router), vitest + embedded-postgres.

**Pre-state:** `origin/homolog` / `origin/main` at media-forge **v0.2.7** (after SE4). `video_jobs` (sqlite) has NO `tenant_id`. `generations` (pg) already has `tenant_id`. All three video providers (kling, bytedance/seedance, higgsfield) have webhook handlers + a `webhook-router`.

**Key facts established by investigation (2026-06-21):**
- `src/core/cost-tracker.ts`: `recordJob` (INSERT on submit), `recordActualCost` (UPDATE on completion, idempotent on `actual_usd IS NULL`), `getJobRecord` (read by jobId). `video_jobs` columns: `id, provider, model, mode, params_hash, est_usd, actual_usd, duration_ms, status, created_at, completed_at, native_task_id, endpoint_kind, actual_credits`.
- `src/gallery/gallery-store.ts`: `insertGeneration({ generationId, tenantId, model, provider, costUsd, creditsDebited, creditValueUsd, minioKey?, signedUrl?, status? })` → `INSERT ... ON CONFLICT (generation_id) DO NOTHING`.
- Webhook factories instantiated in `src/http/server.ts:134-154`: `createHiggsfieldWebhookHandler({ dbPath, storage })`, `createKlingWebhookHandler({ ... })`, `createBytedanceWebhookHandler({ dbPath, outputsDir, storage })`. `galleryStore` is in scope there (created in the `DATABASE_URL` branch).
- `WebhookContext` = `{ provider, jobId, payload, headers }`; `WebhookHandler = (ctx) => Promise<void>`. Each handler already calls `recordActualCost({ jobId, actualUsd, ... })`.
- The sync gallery write lives in `src/mcp/handlers.ts:~2945` (kling_download), keyed `generationId = jobIdOrUrl`, `creditValueUsd: 0.01`, `creditsDebited: 0` (F-D seam).

---

## File Structure

**Create:**
- `media-forge/migrations/sqlite/008-video-jobs-tenant.sql` — `ALTER TABLE video_jobs ADD COLUMN tenant_id TEXT;`
- `media-forge/src/gallery/record-from-job.ts` — **(CEO review D5, DRY)** shared `recordGalleryFromJob({ galleryStore, dbPath, jobId, minioKey, logger })`: reads `getJobRecord`, inserts the gallery row (with `minioKey` populated — **D3**), or emits a structured skip log (**D4**). The single source the 3 webhook handlers call.
- `media-forge/tests/unit/gallery/record-from-job.test.ts` — unit test for the helper (happy / skip-no-cost / skip-no-job / null-tenant→default / idempotent).
- `media-forge/tests/integration/se2-gallery-webhook.int.test.ts` — DB-backed end-to-end (embedded-postgres + sqlite tmp): submit-annotate → webhook → gallery row with correct tenant + minio_key.

**Modify:**
- `media-forge/src/core/cost-tracker.ts` — `getJobRecord` SELECT + `JobRecord` add `tenantId`; new `setJobTenant({ dbPath, jobId, tenantId })`.
- `media-forge/src/mcp/handlers.ts` — after each video submit, call `setJobTenant(dbPath, jobId, deps.tenantId ?? 'default')`.
- `media-forge/src/video/providers/kling-webhook-handler.ts` — factory opts `galleryStore?`; gallery insert after `recordActualCost`.
- `media-forge/src/video/providers/bytedance-webhook-handler.ts` — same.
- `media-forge/src/video/providers/higgsfield-webhook-handler.ts` — same.
- `media-forge/src/http/server.ts` — pass `galleryStore` into the three webhook factory calls.
- `media-forge/tests/unit/...` — extend each webhook-handler unit test with the gallery-write assertion.

**Do NOT touch:** provider modules (`kling.ts`, `bytedance-seedance.ts`, `higgsfield.ts`, `google-veo.ts`) — tenancy stays out of the provider layer. `recordJob` is unchanged.

---

## Task 1: Migration 008 — add `tenant_id` to `video_jobs`

**Files:** Create `media-forge/migrations/sqlite/008-video-jobs-tenant.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 008-video-jobs-tenant.sql — attribute each video job to its tenant so the
-- async webhook completion path can record the generation in the gallery.
-- Existing rows: tenant_id stays NULL → treated as 'default' by readers.
ALTER TABLE video_jobs ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_video_jobs_tenant ON video_jobs (tenant_id);
```

- [ ] **Step 2: Confirm the sqlite migration runner picks it up** — `src/core/db.ts` `runMigrations` scans `migrations/sqlite/*.sql` lexically. `008-...` sorts after `007-actual-credits.sql`. Verify: `cd media-forge && grep -n "migrations/sqlite" src/core/db.ts`. Expected: the dir glob, no explicit allow-list to edit.

- [ ] **Step 3: Commit** — `git add media-forge/migrations/sqlite/008-video-jobs-tenant.sql && git commit -m "feat(media-forge): video_jobs.tenant_id migration (SE2)"`

## Task 2: cost-tracker — read `tenantId` + `setJobTenant` (TDD)

**Files:** `media-forge/src/core/cost-tracker.ts`; Test: `media-forge/tests/unit/core/cost-tracker.test.ts` (extend; confirm the file exists with `ls media-forge/tests/unit/core/cost-tracker.test.ts`, else create it next to the module's existing test).

- [ ] **Step 1: Write the failing test** — using a tmp sqlite db path (mirror the existing cost-tracker test's db setup):
  - `recordJob(...)` then `setJobTenant({ dbPath, jobId, tenantId: 't-1' })` then `getJobRecord({ dbPath, jobId }).tenantId === 't-1'`.
  - `getJobRecord` for a job recorded WITHOUT `setJobTenant` returns `tenantId === null`.
  - `setJobTenant` for an unknown jobId is a no-op (no throw).

```ts
// add to tests/unit/core/cost-tracker.test.ts
it('SE2: setJobTenant annotates the job and getJobRecord returns tenantId', () => {
  recordJob({ dbPath, jobId: 'j-se2', provider: 'kling', model: 'm', mode: 'std', paramsHash: 'h', estUsd: 1 });
  setJobTenant({ dbPath, jobId: 'j-se2', tenantId: 't-1' });
  expect(getJobRecord({ dbPath, jobId: 'j-se2' })?.tenantId).toBe('t-1');
});
it('SE2: getJobRecord tenantId is null when not annotated', () => {
  recordJob({ dbPath, jobId: 'j-none', provider: 'kling', model: 'm', mode: 'std', paramsHash: 'h', estUsd: 1 });
  expect(getJobRecord({ dbPath, jobId: 'j-none' })?.tenantId).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — `cd media-forge && pnpm exec vitest run tests/unit/core/cost-tracker.test.ts`. Expected: FAIL (`setJobTenant` missing, `tenantId` not on JobRecord).

- [ ] **Step 3: Implement** — in `cost-tracker.ts`:
  - Add `readonly tenantId: string | null;` to the `JobRecord` interface.
  - Add `tenant_id` to the `getJobRecord` SELECT column list AND to the row typing + the returned object: `tenantId: row.tenant_id`.
  - Add the new function:

```ts
export function setJobTenant(opts: { readonly dbPath: string; readonly jobId: string; readonly tenantId: string }): void {
  const db = ensureDb(opts.dbPath);
  db.prepare(`UPDATE video_jobs SET tenant_id = ? WHERE id = ?`).run(opts.tenantId, opts.jobId);
}
```

  (In the SELECT, add `tenant_id` after `actual_credits`; in the row type add `tenant_id: string | null`.)

- [ ] **Step 4: Run to verify pass** — same command. Expected PASS.
- [ ] **Step 5: Commit** — `git add media-forge/src/core/cost-tracker.ts media-forge/tests/unit/core/cost-tracker.test.ts && git commit -m "feat(media-forge): cost-tracker setJobTenant + getJobRecord.tenantId (SE2)"`

## Task 3: Handlers annotate tenant right after submit

**Files:** `media-forge/src/mcp/handlers.ts`

> The MCP video-submit handlers call `provider.generate(...)` (which does `recordJob` internally) and get back the internal `jobId`. Immediately annotate that row with the caller's tenant. `deps.tenantId` is already on `HandlersDeps`; `deps.config.projectDir` → the sqlite db path (same one the providers use — confirm via `grep -n "dbPath\|costDbPath\|projectDir" src/mcp/handlers.ts` and reuse the EXACT expression the handlers already pass to the providers, do NOT invent a new path).

- [ ] **Step 1: Locate every video-submit handler** — `cd media-forge && grep -n "media_kling_generate\|media_seedance\|media_higgsfield_generate\|media_video_route\|\.generate(" src/mcp/handlers.ts`. For each submit that returns a `jobId`, capture it.

- [ ] **Step 2: After each submit, annotate** — pattern (import `setJobTenant` from `../core/cost-tracker.js`):

```ts
const submit = await provider.generate(req);
// SE2: attribute the job to the caller so the async webhook can record the gallery row.
if (submit.jobId) setJobTenant({ dbPath, jobId: submit.jobId, tenantId: deps.tenantId ?? 'default' });
```

  Apply to the kling, seedance (bytedance), and higgsfield submit handlers. Use the SAME `dbPath` expression already in scope for that handler. If a submit path returns the jobId under a different field, use that field (verify against the handler's existing return typing — no guessing).

- [ ] **Step 3: Typecheck** — `pnpm typecheck`. Expected exit 0.
- [ ] **Step 4: Commit** — `git add media-forge/src/mcp/handlers.ts && git commit -m "feat(media-forge): annotate video_jobs tenant on submit (SE2)"`

## Task 4: Shared `recordGalleryFromJob` helper (TDD) — D3 + D4 + D5

**Files:** Create `media-forge/src/gallery/record-from-job.ts`; Test: `media-forge/tests/unit/gallery/record-from-job.test.ts`

> CEO review (2026-06-21) accepted three additions, all folded here: **D3** populate `minioKey` so the gallery row links to the artifact; **D4** structured skip-log when no row is written; **D5** one shared helper instead of 3 copies across the webhook handlers.

- [ ] **Step 1: Write the failing test** — fake `galleryStore` (spy `insertGeneration`) + a tmp sqlite db seeded via `recordJob` + `setJobTenant` + `recordActualCost`. Cases:
  - happy: job has `tenant_id='t-1'`, `actual_usd=0.63` → `insertGeneration` called with `{ generationId, tenantId:'t-1', provider, costUsd:0.63, minioKey:'outputs/j-1.mp4', status:'completed' }`.
  - null tenant → `tenantId:'default'`.
  - no cost (`actual_usd` null) → NO insert, `logger.warn` called once with reason `'no-cost'`.
  - job missing → NO insert, `logger.warn` reason `'no-job'`.
  - no galleryStore → no-op, no throw, no warn.
  - insert throws → caught, `logger.warn` reason `'insert-failed'` (the webhook must not fail because the gallery write failed).

- [ ] **Step 2: Run to verify failure** — `cd media-forge && pnpm exec vitest run tests/unit/gallery/record-from-job.test.ts`. Expected FAIL (module missing).

- [ ] **Step 3: Implement** `src/gallery/record-from-job.ts`:

```ts
import { getJobRecord } from '../core/cost-tracker.js';
import type { GalleryStore } from './gallery-store.js';

interface Logger { warn: (m: string, x?: Record<string, unknown>) => void }

/** Record a completed video job in the gallery (async webhook path), tenant-attributed.
 *  Idempotent via insertGeneration's ON CONFLICT(generation_id). Never throws — a gallery
 *  failure must not fail the webhook; every non-write is logged (D4), not silent. */
export async function recordGalleryFromJob(opts: {
  galleryStore?: GalleryStore;
  dbPath: string;
  jobId: string;
  minioKey?: string;     // D3: stable storage key; gallery presigns on read (signed URLs expire)
  logger: Logger;
}): Promise<void> {
  if (!opts.galleryStore) return; // self-host / no DB — nothing to record
  const job = getJobRecord({ dbPath: opts.dbPath, jobId: opts.jobId });
  if (!job) { opts.logger.warn('gallery skip', { reason: 'no-job', jobId: opts.jobId }); return; }
  if (typeof job.actualUsd !== 'number') {
    opts.logger.warn('gallery skip', { reason: 'no-cost', jobId: opts.jobId, provider: job.provider });
    return;
  }
  try {
    await opts.galleryStore.insertGeneration({
      generationId: opts.jobId,
      tenantId: job.tenantId ?? 'default',
      model: job.model,
      provider: job.provider,
      costUsd: job.actualUsd,
      creditsDebited: job.actualCredits ?? 0, // SEAM F-D: real credits when credit-core capture is wired (SE1)
      creditValueUsd: 0.01,                   // SEAM F-D
      ...(opts.minioKey ? { minioKey: opts.minioKey } : {}),
      status: 'completed',
    });
  } catch (err) {
    opts.logger.warn('gallery skip', { reason: 'insert-failed', jobId: opts.jobId, err: (err as Error).message });
  }
}
```

- [ ] **Step 4: Run to verify pass.** Then `pnpm typecheck`.
- [ ] **Step 5: Commit** — `git add media-forge/src/gallery/record-from-job.ts media-forge/tests/unit/gallery/record-from-job.test.ts && git commit -m "feat(media-forge): recordGalleryFromJob helper (minio_key + skip-log, SE2)"`

## Task 4b: Wire the 3 webhook handlers to the helper

**Files:** `media-forge/src/video/providers/{kling,bytedance,higgsfield}-webhook-handler.ts`; Tests: the matching `tests/unit/video/providers/*webhook*.test.ts`.

- [ ] **Step 1:** for each handler, add `galleryStore?: GalleryStore` + `logger` to its `Create*Opts` (the server already has `logger`; import `GalleryStore` type). AFTER the existing `recordActualCost({...})`, call the helper with the storage key the handler already knows (kling/bytedance presign `outputs/{jobId}.mp4`; use that exact expression — confirm per handler with `grep -n "outputs/\|presign\|\.mp4" <handler>`):

```ts
await recordGalleryFromJob({
  galleryStore: opts.galleryStore,
  dbPath: opts.dbPath,
  jobId: internalJobId,
  minioKey: `outputs/${internalJobId}.mp4`, // use the handler's actual output-key expression
  logger: opts.logger,
});
```

- [ ] **Step 2:** extend each handler's unit test: with a seeded completed job + a spy `galleryStore`, assert `insertGeneration` called with the right `{ tenantId, provider, costUsd, minioKey }`. Run each: `pnpm exec vitest run tests/unit/video/providers/<handler>.test.ts`. Expected PASS.
- [ ] **Step 3: Commit** — `git add media-forge/src/video/providers/*-webhook-handler.ts media-forge/tests/unit/video/providers/*webhook*.test.ts && git commit -m "feat(media-forge): webhook handlers record tenant-attributed gallery rows via helper (SE2)"`

## Task 4c: Fix the kling dual-writer (eng review D1) — minio_key parity

> **Eng review (2026-06-21, P2):** kling writes the gallery row via TWO paths — the sync `media_kling_download` handler (`handlers.ts:~2945`) AND the new webhook. `ON CONFLICT(generation_id) DO NOTHING` = first-writer-wins. The sync write omits `minio_key`, so if it lands first the kling row loses the D3 artifact link. bytedance/higgsfield have no sync write, so only kling is affected. Fix: make the sync write include `minio_key` too, so both writers produce equivalent rows and the race is harmless.

- [ ] **Step 1:** in `handlers.ts` (the kling_download sync gallery write, ~line 2945-2956), add `minioKey: \`outputs/${parsed.data.jobIdOrUrl}.mp4\`` to the `insertGeneration({...})` call (mirror the webhook's key expression; confirm the exact output-key form the sync path uses with `grep -n "outputs/\|\.mp4" src/mcp/handlers.ts`).
- [ ] **Step 2 (dual-writer test):** in `tests/integration/se2-gallery-webhook.int.test.ts`, add a case: apply the SYNC kling write first, then fire the kling WEBHOOK for the same jobId → assert exactly ONE `generations` row AND that it has `minio_key` set (whichever writer won, the key is present).
- [ ] **Step 3: Commit** — `git add media-forge/src/mcp/handlers.ts media-forge/tests/integration/se2-gallery-webhook.int.test.ts && git commit -m "fix(media-forge): kling sync gallery write includes minio_key (eng review, dual-writer parity)"`

> **Eng review P3 (non-blocking, impl note):** the webhook handler already calls `getJobRecord` to verify the job before doing work; `recordGalleryFromJob` reads it again. If trivial during implementation, pass the already-read record into the helper instead of re-reading. Indexed sqlite read, negligible — do NOT block on it.

## Task 5: Wire `galleryStore` into the webhook factories

**Files:** `media-forge/src/http/server.ts` (factory calls at ~134-154)

- [ ] **Step 1:** pass `galleryStore` AND `logger` into all three factory calls (both are in scope in the `DATABASE_URL` branch — `logger` is imported at `server.ts:8`; confirm with `grep -n "galleryStore\|logger" src/http/server.ts`):

```ts
createHiggsfieldWebhookHandler({ dbPath, storage, galleryStore, logger }),
createKlingWebhookHandler({ /* existing opts */, galleryStore, logger }),
createBytedanceWebhookHandler({ dbPath, outputsDir: seedanceOutputsDir, storage, galleryStore, logger }),
```

  When `galleryStore` is undefined (self-host / no DB), `recordGalleryFromJob` returns early (Task 4 guard) — no behavior change there.

- [ ] **Step 2: Typecheck** — `pnpm typecheck`. Expected exit 0.
- [ ] **Step 3: Commit** — `git add media-forge/src/http/server.ts && git commit -m "feat(media-forge): inject galleryStore into video webhook handlers (SE2)"`

## Task 6: End-to-end integration test (DB-backed)

**Files:** Create `media-forge/tests/integration/se2-gallery-webhook.int.test.ts` (embedded-postgres for gallery via the default vitest config's global-setup; a tmp sqlite file for `video_jobs`). Add the path to `vitest.config.ts` `include` (mirror the OPS3 `pg-migrate.int.test.ts` entry).

- [ ] **Step 1: Write the test** — `recordJob` a kling job → `setJobTenant('t-1')` → `recordActualCost(actualUsd=0.63)` → invoke the kling webhook handler (built with a real `GalleryStore` on an isolated pg schema) → assert a `generations` row exists with `tenant_id='t-1'`, `provider='kling'`, `cost_usd=0.63`, `status='completed'`. Then invoke the handler a SECOND time → assert still exactly ONE row (ON CONFLICT idempotency).
- [ ] **Step 2: Run** — `pnpm exec vitest run tests/integration/se2-gallery-webhook.int.test.ts`. Expected PASS.
- [ ] **Step 3: Commit** — `git add media-forge/tests/integration/se2-gallery-webhook.int.test.ts media-forge/vitest.config.ts && git commit -m "test(media-forge): SE2 end-to-end submit->webhook->gallery (tenant-attributed, idempotent)"`

## Task 7: Full validation + release

- [ ] **Step 1:** bump `media-forge/package.json` 0.2.7 → 0.2.8.
- [ ] **Step 2:** `cd media-forge && pnpm typecheck && pnpm lint && pnpm test && pnpm exec tsup`. Expected: typecheck/lint 0; tests pass (suite grows by the new tests, no FAILs); build OK.
- [ ] **Step 3:** push branch → homolog (clean worktree off origin/homolog); release homolog → main (`--no-ff`, no force) from a worktree off origin/main.
- [ ] **Step 4 (deploy — gated, user authorizes):** build media-forge 0.2.8 arm64 on the VPS (see [[deploy-while-ci-down]] memory), `docker service update`. The `008` migration auto-applies on boot via the sqlite runner; verify boot log + a webhook end-to-end records a gallery row.
- [ ] **Step 5:** update `.maxvision/PENDING.md`: SE2 ✅ done (webhook path attributes + records). Note the residual F-D seam (`creditsDebited`/`creditValueUsd` still 0/0.01 until credit-core capture is wired — that's SE1, not SE2).

---

## NOT in scope (SE2)

- The F-D capture seam (`creditsDebited`/`creditValueUsd` real values) — that's SE1 (credit-core capture wiring). SE2 keeps the documented `0` / `0.01` placeholder, same as the existing sync write.
- Provider-layer tenancy. Providers stay tenancy-agnostic by design; the handler annotates.
- Backfilling `tenant_id` for historical `video_jobs` rows (they read as `'default'`).
- Higgsfield's sync `_download` cost (it returns no `actualUsd`); the webhook path is the cost+tenant source. If a Higgsfield flow completes ONLY via sync poll with no webhook + no cost, it won't get a gallery row — flag as a follow-up if that flow exists (confirm Higgsfield always fires a webhook on completion).

## What already exists (reused, not rebuilt)

- `generations` table + `insertGeneration` (idempotent) + the gallery list tool — reused as-is.
- `recordJob` / `recordActualCost` / `getJobRecord` — extended (`tenantId` read + `setJobTenant`), not rebuilt.
- The three webhook handlers + `webhook-router` + the `server.ts` factory wiring — extended with `galleryStore`.
- The sync kling_download gallery write — left intact; de-dupes via ON CONFLICT.

## Self-Review

- **Spec coverage:** tenant attribution (T1-T3), webhook gallery write all 3 providers (T4-T5), idempotency + e2e (T6), validate+release (T7). ✓
- **Placeholder scan:** two confirm-before-edit spots, both correctness-driven (the exact `dbPath` expression in handlers T3; the jobId field name on each submit result T3) — flagged with grep steps, not lazy TODOs. The F-D credit seam is an explicit out-of-scope placeholder consistent with the existing code.
- **Type consistency:** `setJobTenant({dbPath,jobId,tenantId})` + `JobRecord.tenantId: string | null` used identically in cost-tracker, handlers, and all three webhook handlers; `insertGeneration` opts match the existing gallery-store signature.
- **Idempotency:** webhook insert + sync insert both key `generation_id = jobId`; `ON CONFLICT (generation_id) DO NOTHING` guarantees one row. Verified in T6.
- **Architecture:** providers untouched (tenancy is an app concern); tenant annotation is one extra sqlite UPDATE per submit, well before any webhook fires.

### CEO review accepted scope (2026-06-21, SELECTIVE EXPANSION)

- **D3 — minio_key:** the webhook gallery row now stores the stable storage key (`outputs/{jobId}.mp4`) so the gallery links to the artifact (presign on read). Folded into Task 4 helper + Task 4b.
- **D4 — skip-log:** `recordGalleryFromJob` emits a structured `logger.warn('gallery skip', {reason})` for every non-write (no-job / no-cost / insert-failed) — no silent gaps. Folded into Task 4.
- **D5 — DRY helper:** one `recordGalleryFromJob` (Task 4) replaces 3 inline copies; the 3 webhook handlers call it (Task 4b). Single place to maintain.
- Approach **A** (handler-annotates tenant + webhook-writes gallery; providers stay tenancy-agnostic) confirmed over threading-through-providers (B) and separate-map (C).

---

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_addressed | SELECTIVE EXPANSION; approach A confirmed; 3 cherry-picks accepted (D3 minio_key, D4 skip-log, D5 DRY helper) folded into Tasks 4/4b/5 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_addressed | 1 P2 (kling dual-writer minio_key → Task 4c) fixed; 1 P3 (double getJobRecord) noted; test coverage ~complete; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI scope (backend feature) |
| DX Review | `/plan-devex-review` | Developer experience | 0 | — | not run |

- **UNRESOLVED:** none — CEO D1-D5 + Eng D1 all answered.
- **VERDICT:** **CEO + ENG review COMPLETE — ready to implement.** SELECTIVE EXPANSION; 3 CEO cherry-picks (artifact link, skip observability, DRY helper) + 1 eng fix (kling dual-writer minio_key parity, Task 4c) folded in. Approach A locked (providers tenancy-agnostic). 0 critical gaps. No UI scope → design review n/a. Sequential implementation (single subsystem) — no worktree parallelization (all tasks touch the video/gallery/cost-tracker module chain).
