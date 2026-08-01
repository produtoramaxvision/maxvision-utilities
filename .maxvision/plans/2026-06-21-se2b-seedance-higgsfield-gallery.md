# SE2-B — Gallery coverage for seedance + higgsfield (scoping doc)

> **Status: SCOPING / design-first.** This is NOT yet an engineer-ready implementation plan. SE2-B couples to deferred provider cost-capture (post-EXT1) and a product-surface decision (a new poll tool). Settle the open decisions below (via `/plan-ceo-review` and `/office-hours`) BEFORE turning this into a `writing-plans` implementation plan. Created 2026-06-21 after SE2 shipped kling coverage (v0.2.8) and the implementation revealed seedance/higgsfield are not reachable by the SE2 webhook path.

**Goal:** Every completed video generation lands in the gallery, tenant-attributed — extending SE2's kling coverage to **seedance/bytedance** and **higgsfield**.

**Why this is a separate, design-first piece (proven during SE2 impl):**
- SE2 added `recordGalleryFromJob` (`media-forge/src/gallery/record-from-job.ts`) and wired it into all 3 video webhook handlers + the kling sync write. It writes a gallery row only when the job record has `actual_usd`.
- **kling** records `actual_usd` at webhook time → gallery row written. ✅ (shipped, v0.2.8)
- **bytedance/seedance**: the webhook only ACKs (fal.ai 15s delivery window); `actual_usd` is recorded EXCLUSIVELY inside `BytedanceSeedanceProvider.pollStatus()` (`bytedance-seedance.ts:439,452`). **No MCP handler calls `pollStatus` with `deps.galleryStore` in scope** — there is no `media_seedance_poll` tool. So the webhook gallery call skips (`no-cost`) and nothing else writes the row.
- **higgsfield**: `HiggsfieldProvider.pollStatus()` (`higgsfield.ts:188-257`) does NOT record cost at all. Billing/capture for higgsfield is explicitly DEFERRED in code (`handlers.ts:2701-2706`: "left unbilled until provider-level capture plumbing lands (post-EXT1)").

**The reusable infra SE2 already shipped (build on it, do NOT rebuild):**
- `video_jobs.tenant_id` (migration 008) + `setJobTenant` (annotated on every video submit) + `getJobRecord.tenantId`.
- `recordGalleryFromJob({ galleryStore, dbPath, jobId, minioKey, logger })` — idempotent (gallery `ON CONFLICT(generation_id) DO NOTHING`), with skip-log. **The hook is ready; B only needs to call it at a point where the cost + tenant are present for these two providers.**

---

## Decisions resolved (CEO review 2026-06-21, SELECTIVE EXPANSION)

- **Approach (D1) = A — gallery-cost-capture:** capture real cost → write the gallery row; keep credit debit as the F-D placeholder (billing stays inert). Do NOT bundle SE1/F-D credit-debit (it's still inert; bundling builds billing before it's needed). Accept that the capture plumbing gets re-touched when F-D lands.
- **DD1 (seedance surface) = C:** the implementation FIRST confirms whether an existing poll/status tool already routes seedance; reuse it if so (wire the gallery there). Only if none exists, fall back to adding a `media_seedance_poll` tool (mirroring the existing `media_kling_poll`).
- **DD2 (higgsfield) = A — build real cost capture:** thread `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT` into `HiggsfieldProvider.pollStatus()` so it records `actual_usd` on completion, then write the gallery row with the real cost.
- **DD3 = (folded into D1):** gallery-cost-capture only; no credit-debit bundling.
- **Scope expansion accepted (D5) = image-gen gallery parity:** investigate whether image generations (imagen / nano-banana) also miss the gallery; if the gap exists, cover them in SE2-B too (so the gallery becomes "every generation," not just video). First task: confirm the image-gen gap before building.

## Open design decisions (RESOLVED above — kept for context)

**DD1 — Seedance: how does the cost-bearing completion reach a handler with `galleryStore`?**
- Today seedance cost lands inside `provider.pollStatus()`, which is called from... where? **Confirm the current seedance completion/poll flow** (is there an existing tool users call to finalize a seedance job, or does it rely solely on the webhook ACK + a background reconcile?). Options:
  - (a) Add a new `media_seedance_poll` MCP tool (schema in `schemas.ts` + handler in `registerAllTools` with `deps.galleryStore`) that calls `pollStatus` then `recordGalleryFromJob`. **Product-surface change** (new user-facing tool).
  - (b) If a generic poll/finalize handler already routes seedance, wire `recordGalleryFromJob` there (no new tool).
  - (c) Move the gallery write INTO `pollStatus` — **rejected** (pushes tenancy/gallery into the provider layer; violates SE2's chosen layering).
- **This is the product question — needs the user / `/office-hours`.**

**DD2 — Higgsfield: build cost capture, or gallery-without-cost?**
- Higgsfield `pollStatus` records no cost. Two sub-options:
  - (a) Build cost capture: thread higgsfield pricing into `pollStatus` (the `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT` env exists) → `recordActualCost` on completion → then `recordGalleryFromJob`. **This is the deferred post-EXT1 billing-capture work — money-coupled.**
  - (b) Gallery-without-cost: write the gallery row with `costUsd: 0` (or est) when higgsfield completes, accepting the F-D placeholder. Decouples gallery from the billing seam, but the gallery row's cost is wrong until (a) lands.
- **Money-coupled — needs explicit decision + eng review.**

**DD3 — Does this belong WITH the credit-capture work (SE1 / F-D)?**
- Cost capture for seedance/higgsfield IS the same plumbing that would wire real credit debit (the `creditsDebited`/`creditValueUsd` F-D seam). Doing gallery cost-capture separately from credit-capture may duplicate the seam. **Decide: bundle SE2-B with SE1/F-D, or ship gallery-cost-only first.**

---

## Provisional approach (pending the decisions above)

```
SEEDANCE  ── pollStatus() records actual_usd (EXISTS)
          └─ DD1: handler with galleryStore → recordGalleryFromJob  ── gallery row ✅
HIGGSFIELD ── pollStatus() records NOTHING (GAP)
          ├─ DD2a: add cost capture in pollStatus (post-EXT1, money) ─┐
          └─ DD2b: gallery row cost=0 placeholder ───────────────────┴─ gallery row
```

## Provisional task outline (NOT engineer-ready until DD1-DD3 resolved)

1. **Explore** the seedance completion/poll flow + the higgsfield pricing path; produce the DD1/DD2 answers with code references.
2. **Seedance (DD1):** the handler hook + `recordGalleryFromJob` + TDD (poll→completed→gallery row, tenant-attributed, idempotent vs the webhook skip).
3. **Higgsfield (DD2):** per the decision — cost capture in `pollStatus` (+ tests) OR cost=0 gallery write.
4. **Integration test:** seedance + higgsfield submit→complete→gallery row, tenant-attributed.
5. Validate (typecheck/lint/test/tsup), release, deploy gated.

## What already exists (reused)
- Full SE2 infra (tenant annotation, helper, migration) — B only adds the per-provider completion hooks.

## NOT in scope (SE2-B)
- Real credit debit (that's SE1/F-D unless DD3 bundles them).
- Re-architecting the webhook ACK model.

---

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_addressed | SELECTIVE EXPANSION; approach A (gallery-cost-capture, no billing bundle); DD1=C (reuse-or-add seedance poll), DD2=A (build higgsfield real cost capture); +1 cherry-pick: image-gen gallery parity accepted into scope |
| Eng Review | `/plan-eng-review` | Architecture & tests | 0 | pending | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI scope (backend) |

- **UNRESOLVED:** none — D1-D5 answered. All design decisions resolved.
- **VERDICT:** CEO review COMPLETE (SELECTIVE EXPANSION). Scope locked: seedance gallery (reuse-or-add poll) + higgsfield gallery WITH real cost capture + image-gen gallery parity (investigate-then-cover). Gallery-cost-capture only, no credit-debit bundle (billing inert). This doc is now ready to become an engineer-ready `writing-plans` implementation plan. **Recommend `/plan-eng-review` next** (architecture/tests) before the implementation plan, given the new cost-capture plumbing + the new tool surface. SE2 kling coverage already shipped (v0.2.8, main `d2d35d5`).
