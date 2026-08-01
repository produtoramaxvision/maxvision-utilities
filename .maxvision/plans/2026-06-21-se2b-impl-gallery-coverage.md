# SE2-B Implementation Plan — Gallery coverage for seedance + higgsfield + image-gen

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) or maxvision:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the gallery hold EVERY generation, tenant-attributed — extend SE2's kling coverage to seedance, higgsfield, and image-gen (imagen / nano-banana).

**Architecture:** Reuse SE2's shipped infra — `recordGalleryFromJob` (`src/gallery/record-from-job.ts`, idempotent + skip-log), `setJobTenant`/`getJobRecord.tenantId`, `video_jobs.tenant_id` (migration 008). SE2-B only adds the per-provider completion hooks where the cost + tenant are present. Gallery-cost-capture only — credit debit stays the F-D placeholder (billing inert). Decided in CEO review 2026-06-21 (SELECTIVE EXPANSION): see `2026-06-21-se2b-seedance-higgsfield-gallery.md`.

**Tech Stack:** Node 22 ESM, TypeScript strict, `node:sqlite` (cost-tracker), pg (gallery), vitest + embedded-postgres.

**Pre-state:** media-forge **v0.2.8** on `origin/homolog`/`origin/main` (SE2 kling shipped). Grounding (verified 2026-06-21):
- Seedance: submit tools `media_seedance_{text_to_video,image_to_video,multishot,reference_fusion}` exist (`handlers.ts:3000-3042`); **NO `media_seedance_poll`** tool. `BytedanceSeedanceProvider.pollStatus()` records `actual_usd` on completion (`bytedance-seedance.ts:439,452`).
- Higgsfield: `HiggsfieldProvider` already has `pollStatus()` (`higgsfield.ts:188`), `estimateCostUSD()` (`:339`), and `recordActualCostUSD(jobId, usd, finalStatus?)` (`:357`) — but `recordActualCostUSD` is NOT called on poll completion. `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT` env drives pricing.
- Image-gen: `media_generate_imagen` (`handlers.ts:1999`) + nano-banana (`:1989`) handlers call `maybeStoreImageArtifact(...)` and **never `insertGeneration`** → image generations are NOT in the gallery (gap confirmed). Image gen is synchronous (handler returns the result + cost).

---

## File Structure

**Modify:**
- `media-forge/src/mcp/schemas.ts` — add `media_seedance_poll` tool schema (mirror `media_kling_poll`).
- `media-forge/src/mcp/handlers.ts` — (a) register `media_seedance_poll` handler → `recordGalleryFromJob`; (b) image-gen handlers (imagen + nano-banana) → `recordGalleryFromJob` after store; both have `deps.galleryStore` + `deps.tenantId` in `registerAllTools` scope.
- `media-forge/src/video/providers/higgsfield.ts` — call `recordActualCostUSD` inside `pollStatus()` on `state === 'completed'`.
- `media-forge/src/video/providers/higgsfield-webhook-handler.ts` OR the higgsfield poll handler — call `recordGalleryFromJob` after cost is recorded.
- Tests alongside each.

**Reuse (do NOT rebuild):** `recordGalleryFromJob`, `setJobTenant`, `getJobRecord`, migration 008.

---

## Task 1: Seedance — `media_seedance_poll` tool + gallery (TDD)

**Files:** `media-forge/src/mcp/schemas.ts`, `media-forge/src/mcp/handlers.ts`; Test: `media-forge/tests/unit/mcp/seedance-poll.test.ts` + integration.

- [ ] **Step 0 (confirm):** verify there is no existing tool that already finalizes seedance — `grep -nE "seedance|bytedance" src/mcp/schemas.ts` + check whether any download/poll handler calls `seedanceProvider().pollStatus`. If one exists, wire the gallery there instead of adding a tool (DD1=C). Otherwise proceed (DD1→A).
- [ ] **Step 1: Write failing test** — `media_seedance_poll` handler: given a seeded seedance job (`setJobTenant('t-1')`) whose `pollStatus` returns `completed` with cost recorded, the handler calls `recordGalleryFromJob` → a gallery row (provider `seedance`/`bytedance`, tenant `t-1`, `minioKey`). Run → FAIL.
- [ ] **Step 2: Add the schema** in `schemas.ts` mirroring `media_kling_poll` (`{ jobId: string }` input).
- [ ] **Step 3: Register the handler** in `handlers.ts` (in `registerAllTools`, near the seedance submit tools ~3000, where `deps.galleryStore`/`deps.tenantId`/dbPath are in scope): call `seedanceProvider().pollStatus(input.jobId)` (records cost), then on `status.state === 'completed'` call `recordGalleryFromJob({ galleryStore: deps.galleryStore, dbPath: <handler dbPath>, jobId: status.jobId, minioKey: \`outputs/${status.jobId}.mp4\`, logger })`. Confirm the seedance output-key form with `grep -n "outputs/" src/video/providers/bytedance-seedance.ts`.
- [ ] **Step 4: Run to pass.** Then `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media-forge): media_seedance_poll records tenant-attributed gallery row (SE2-B)`

## Task 2: Higgsfield — capture cost on poll completion + gallery (TDD)

**Files:** `media-forge/src/video/providers/higgsfield.ts`; the higgsfield poll/webhook handler; Tests alongside.

- [ ] **Step 1: Write failing test** — after higgsfield `pollStatus` reaches `completed`, `actual_usd` is recorded (via `recordActualCostUSD`) AND `recordGalleryFromJob` writes a gallery row (provider `higgsfield`, tenant from the job, real cost). Run → FAIL.
- [ ] **Step 2: Capture cost in `pollStatus`** — in `higgsfield.ts` `pollStatus()`, on `state === 'completed'`, compute the cost (`estimateCostUSD(req)` if no authoritative actual is returned; document the source) and call `this.recordActualCostUSD(jobId, usd, 'completed')`. Guard: `recordActualCost`'s `WHERE actual_usd IS NULL` makes re-poll a no-op (idempotent). Throw a named error if `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT` is unset (mirror the existing `estimateCostUSD` guard at `:351`).
- [ ] **Step 3: Gallery hook** — at the higgsfield completion handler (the poll registration in `handlers.ts` ~2791 `media_higgsfield_poll`, where `deps.galleryStore` is in scope), after cost is recorded call `recordGalleryFromJob({...})` with the higgsfield output key.
- [ ] **Step 4: Run to pass.** `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media-forge): higgsfield captures actual cost on poll + records gallery (SE2-B)`

## Task 3: Image-gen — gallery row after generation (TDD)

**Files:** `media-forge/src/mcp/handlers.ts` (imagen `:1999`, nano-banana `:1989`); Test: `media-forge/tests/unit/mcp/image-gallery.test.ts` + integration.

> Image gen is SYNCHRONOUS: the handler generates, stores via `maybeStoreImageArtifact`, returns. The gallery write goes right after the store, using the generation's cost + `deps.tenantId` + the stored key. These are images, not video — `generation_id` = the image `generateJobId(...)`; provider = `imagen`/`nano-banana`.

- [ ] **Step 1: Write failing test** — imagen + nano-banana handlers, with `deps.galleryStore` + `deps.tenantId`, after a successful generation write a gallery row (provider `imagen`/`nano-banana`, tenant, `minioKey` from the stored artifact, cost from the generation). Run → FAIL.
- [ ] **Step 2: Confirm the cost + key source** — `grep -n "estimateCost\|costUsd\|maybeStoreImageArtifact\|generateJobId" src/mcp/handlers.ts src/image/*.ts` to find the image generation's actual/estimated cost and the stored MinIO key returned by `maybeStoreImageArtifact`.
- [ ] **Step 3: Implement** — after `maybeStoreImageArtifact(...)` in each image handler, if `deps.galleryStore`, call `recordGalleryFromJob` OR `deps.galleryStore.insertGeneration(...)` directly (the helper expects a `video_jobs` record via `getJobRecord`; image gen has no `video_jobs` row, so call `insertGeneration` directly with `{ generationId, tenantId: deps.tenantId ?? 'default', model, provider, costUsd, creditsDebited:0, creditValueUsd:0.01, minioKey, status:'completed' }`). **DECISION FLAG:** image gen has no `video_jobs` row → use `insertGeneration` directly, NOT `recordGalleryFromJob` (which reads `video_jobs`). Keep the skip-log behavior inline.
- [ ] **Step 4: Run to pass.** `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(media-forge): image generations recorded in gallery (imagen + nano-banana, SE2-B)`

## Task 4: Integration test — all providers in the gallery (DB-backed)

**Files:** `media-forge/tests/integration/se2b-gallery-coverage.int.test.ts` (add to `vitest.config.ts` include).

- [ ] **Step 1:** seed + drive each path: seedance poll→completed, higgsfield poll→completed, imagen/nano-banana generate → assert a `generations` row per provider, tenant-attributed, `minio_key` set, idempotent (re-run → no dup).
- [ ] **Step 2: Run** (default vitest config, embedded-postgres). Expected PASS.
- [ ] **Step 3: Commit** — `test(media-forge): SE2-B end-to-end gallery coverage (seedance/higgsfield/image-gen)`

## Task 5: Validate + release

- [ ] **Step 1:** bump `package.json` 0.2.8 → 0.2.9.
- [ ] **Step 2:** `cd media-forge && pnpm typecheck && pnpm lint && pnpm test && pnpm exec tsup`. All green.
- [ ] **Step 3:** push branch → homolog (worktree off origin/homolog); release homolog → main (`--no-ff`).
- [ ] **Step 4 (deploy gated):** build 0.2.9 arm64 on VPS + `service update` (see [[deploy-while-ci-down]]); verify the boot + a gallery row per provider.
- [ ] **Step 5:** update `.maxvision/PENDING.md`: SE2 ✅ FULL (all providers + image-gen); F-D credit seam still open (SE1).

---

## NOT in scope (SE2-B)
- Real credit debit (`creditsDebited`/`creditValueUsd` actuals) — that's SE1/F-D.
- A background reconcile worker for seedance (DD1 chose the poll tool, not a worker).
- Re-architecting the image-gen sync flow.

## What already exists (reused)
- `recordGalleryFromJob`, `setJobTenant`, `getJobRecord`, migration 008 (SE2). Higgsfield `recordActualCostUSD`/`estimateCostUSD` (already present, just not called on completion).

## Self-Review
- Spec coverage: seedance (T1), higgsfield cost+gallery (T2), image-gen (T3), e2e (T4), release (T5). ✓
- Placeholder scan: 3 confirm-before-edit spots (seedance existing-surface; image cost/key source; output-key forms) — all with grep steps, correctness-driven.
- Type consistency: `recordGalleryFromJob` reused for video (has `video_jobs`); image-gen uses `insertGeneration` directly (no `video_jobs` row) — flagged explicitly in T3 to avoid a wrong helper call.
- Money note: SE2-B records COST (cost-tracking), not credit DEBIT — billing stays inert. Higgsfield cost-capture is idempotent via `actual_usd IS NULL`.

---

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_addressed | (on the scoping doc) SELECTIVE; approach A; DD1=C→add poll, DD2=A capture; image-gen parity accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | pending | recommended next on this impl plan |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI scope |

- **UNRESOLVED:** none (design decisions settled in the scoping doc's CEO review).
- **VERDICT:** Implementation plan ready, grounded in verified call-sites (seedance has no poll tool → add one; higgsfield `recordActualCostUSD` exists → wire it; image-gen gap confirmed → `insertGeneration` directly). Builds on SE2 infra. **Run `/plan-eng-review` before implementing** (required gate). Gallery-cost-capture only; credit debit stays SE1/F-D.
