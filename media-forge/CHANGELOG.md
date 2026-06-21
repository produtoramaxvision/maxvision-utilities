# Changelog

All notable changes to `media-forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-06-21

### Fixed

- **cost-tracker SQLite crashed on first write in the hosted container.** `openDb()`
  opened the db file without creating its parent dir, so when `MEDIA_FORGE_PROJECT_DIR`
  was unset (resolving to a non-existent `/app/.media-forge`), `recordJob` /
  `getJobRecord` / gallery / refs threw `unable to open database file`. `openDb` now
  `mkdir`s the parent dir first. Unblocks video-job tracking, billing capture accuracy,
  gallery, cost reports, and the F-E sweep oracle's `actual_credits` source.
- **Deploy:** the stack now mounts a `mcp-data` volume at `/data` and sets
  `MEDIA_FORGE_PROJECT_DIR=/data/media-forge`, so `cost.db` (`video_jobs`) survives
  redeploys instead of living on the ephemeral container fs.

## [0.2.2] - 2026-06-20

### Fixed

- **Job-status oracle robustness + auth.** `/job-status` degrades to `{status:'unknown'}`
  on a missing/unopenable db (no 500), and fails closed: the route only mounts when a
  `MEDIA_FORGE_STATUS_SECRET` >= 32 chars is set, with constant-time secret compare.

## [0.2.1] - 2026-06-20

### Added

- **F-E sweep oracle.** Internal `/job-status/:jobId` endpoint (sourced from
  `video_jobs`, secret-gated) lets credit-core's TTL sweep settle expired Kling
  reservations with the real captured cost. `video_jobs.actual_credits` persists the
  already-computed credits at live capture; `reserveForJob` registers each
  reservation's `status_url` pointing back at this service.

## [0.2.0] - 2026-06-02

### Fixed

- **Docker HEALTHCHECK:** use `127.0.0.1` instead of `localhost`. The HTTP server
  binds `0.0.0.0` (IPv4); `localhost` resolves to `::1` (IPv6) first inside the
  container, so the healthcheck got `connection refused` and Swarm SIGKILLed the
  task in a restart loop despite the server being healthy.

### Added

- **HTTP transport (F-A):** hosted MCP server over Hono + Streamable HTTP
  (stateless, per-request `McpServer`) alongside the existing stdio path. New
  `src/http/` (`auth.ts` Bearer resolver, `app.ts` with `/health` `/metrics`
  `/mcp`, `startHttpServer()`), pinned MCP SDK `^1.29`, `start:http` script.
- **Docker image + publish:** multi-stage arm64 `Dockerfile` (system ffmpeg,
  `/health` healthcheck); `release.yml` builds + pushes
  `ghcr.io/produtoramaxvision/media-forge-mcp` to ghcr on the release tag.

### Docs / Metadata sync (no code change)

Aligns marketplace + plugin metadata and roadmap with the actual post-P16 surface.
Counts had drifted from the v0.1.0 figures.

- `marketplace.json`: added the 3 missing skills to media-forge's `skills` array
  (`higgsfield-prompting`, `kling-prompting`, `seedance-prompting`) — marketplace
  installs were silently omitting them. Refreshed the plugin description
  (10→14 subagents, 11→14 skills, 22→54 MCP tools, multi-provider video).
- `media-forge/.claude-plugin/plugin.json`: description updated to 14 subagents +
  multi-provider video; added `higgsfield`/`kling`/`seedance` keywords.
- `docs/roadmap.md`: reframed "Current Release" v0.1.0 → v0.1.1 with the 4-provider
  video surface + refs-integration; corrected counts; marked DEBT-008 RESOLVED;
  added open follow-ups FU-P13 (dual cost ledger), FU-P15 (Kling placeholder
  pricing), FU-P16 (Seedance IP context).

## 0.1.1 — 2026-05-28

### Official initial stable release

Version reset to `0.1.1` to establish clean semver-aligned baseline for the
public marketplace listing. Code is the consolidated state of phases P13–P16
(provider abstraction → Higgsfield → Kling → Seedance) plus the two PR#13
release-time security hotfixes. No code changes from `0.5.0-p16`; this is a
metadata-only bump that:

- Aligns plugin + package + marketplace metadata versions
- Drops the in-development `-pNN` phase suffix from the public version string
- Establishes the version pattern future releases will increment from

For the per-phase change history see the sections below (`0.5.0-p16` and
earlier preserve the original phase-numbered release notes).

## 0.5.0-p16 — 2026-05-27

### P16 — Seedance 2.0 FULL Integration

Adds ByteDance Seedance 2.0 as the fourth first-class video provider in
media-forge. Primary access via `@fal-ai/client` (USD billing, no China-region
KYC). Optional fallback via direct BytePlus ARK REST. Native audio generation
included on all tiers at no extra cost.

**Added**
- `BytedanceSeedanceProvider` adapter in `src/video/providers/bytedance-seedance.ts`
  with fal.ai primary path (`fal.queue.submit/status/result`) and BytePlus ARK
  REST fallback path. Lazy singleton pattern (`getBytedanceSeedanceProvider`).
- `BytePlus ARK` direct REST client (`src/video/providers/byteplus-ark.ts`)
  with `submitArkTask`, `pollArkTask`, `downloadArkAsset` for fal.ai-bypass
  workflows.
- 2 Seedance 2.0 model specs (no Pro tier — fal.ai v2 ships Standard + Fast
  only): `seedance-2.0-standard` ($0.3024/sec, 480p/720p/1080p) and
  `seedance-2.0-fast` ($0.2419/sec, 480p/720p). Both `audioNative: true`,
  `ipRiskLevel: 'high'`.
- `BytedanceSeedanceExtras` arm in `ProviderExtras` union covering tier mode,
  reference URLs, multi-shot timestamps, frame-anchor edit semantic.
- 4 MCP tools (MCP_TOOLS 45 → 49):
  - `media_seedance_text_to_video` — base T2V with full param surface
  - `media_seedance_image_to_video` — I2V with optional `endImageUrl` for
    start→end frame-anchored transitions (absorbs the original
    "targeted edit" semantic from plan body since fal.ai v2 ships no native
    edit endpoint)
  - `media_seedance_multishot` — T2V wrapper that structures `shots[]` into
    multi-cut prompts with timestamp segmentation (sum ≤ 15s, max 4 shots)
  - `media_seedance_reference_fusion` — R2V with `@Image1/@Video1/@Audio1`
    mention syntax (≤9 images + ≤3 videos + ≤3 audios)
- `seedance-prompting` skill: tier selection, multi-shot syntax, @-mention
  reference grammar, frame-anchored edit pattern, director-level camera vocab,
  failure modes.
- `seedance-director` subagent for tier/mode orchestration.
- `video-router` heuristic extended with Seedance routing predicates: cost-
  bottom-tier drafts (Fast), multi-shot timestamp cuts, mixed-asset reference
  fusion, audio+video joint generation, frame-anchored start→end (i2v with
  `endImageUrl`).
- `cost-tracker` helper `getJobRecord(jobId)` for per-tier rate lookup in
  webhook + poll convergence paths.
- `feature-flags` module with `isSeedanceEnabled(env?)` helper.
- Setup wizard step for `FAL_KEY` (required) + `BYTEPLUS_ARK_API_KEY`
  (optional fallback) + `MEDIA_FORGE_SEEDANCE_ENABLED` (default true).

**Changed**
- `PROVIDERS` runtime array now `['google', 'higgsfield', 'kling', 'bytedance']`.
- `ADAPTED_PROVIDERS` set dynamically computed from `isSeedanceEnabled()` —
  removes `bytedance` from routing when flag disabled (45 tools, not 49).
- `pricing.unit` literal union extended with `'per-second'` (fal.ai native
  billing unit; `'usd-per-second'` retained as legacy alias via switch
  fall-through in `normalizeCostUSD`).
- `VideoModelSpec.resolutions` literal union extended with `'480p'` (Seedance
  Fast supports 480p downscale).
- `VideoModelSpec.limits` interface extended with `maxImageRefs`,
  `maxVideoRefs`, `maxAudioRefs` for reference-to-video bound enforcement.

**Feature flag (emergency removal)**
- `MEDIA_FORGE_SEEDANCE_ENABLED=false` skips all 4 Seedance tool registrations
  and removes `bytedance` from `ADAPTED_PROVIDERS`. Single-flip emergency
  removal if Disney/Paramount injunction lands. Default `true`. Accepts
  `false|0|no|off` (case-insensitive, whitespace-trimmed) as disabled.

**Endpoint corrections vs plan body (per Amendment A0, intel-driven)**
- Plan body assumed `fal-ai/bytedance/seedance/v2/{tier}/{mode}` slugs and
  3-tier Pro/Standard/Fast pricing. Live `context7` query against
  `/websites/fal_ai_models` corrected to `fal-ai/bytedance/seedance-2.0/[fast/]{mode}`
  (no `/v2/` infix, no Pro tier exists in v2), per-second pricing, and
  6 endpoints (2 tiers × 3 modes). All hardcoded plan paths replaced
  in-place before execution. Intel file:
  `.maxvision/intel/2026-05-27-seedance-fal-slugs.md`.

**Legal Note — Seedance 2.0 IP context**
- ByteDance Seedance 2.0 is the subject of active C&D / IP litigation from
  Disney + Paramount over training-data sourcing. media-forge ships zero
  runtime IP gating (operator responsibility — strict D2 user decision).
  Operators using Seedance 2.0 assume full responsibility for compliance with
  applicable IP law in their jurisdiction. See README "Legal Note on
  Seedance 2.0" for context and emergency-removal mechanism
  (`MEDIA_FORGE_SEEDANCE_ENABLED=false`).

**Tests**
- Full suite: 1142 → 1281 passing (+139 net). 8 skipped (live E2E gated).
- New regression test: `tests/integration/p16-seedance-regression.test.ts`.
- New live test (gated): `tests/integration/seedance-live.test.ts` requires
  `MEDIA_FORGE_RUN_LIVE_TESTS=true` + `FAL_KEY=...`.

**Runtime deps**
- Added `@fal-ai/client@^1.7.0` (1.10.1 actual). Pure-JS deps
  (`@msgpack/msgpack`, `eventsource-parser`, `robot3`). No native bindings,
  no `node-gyp`. Verified pre-install via Task 1.5 pacote-manifest probe.

## 0.4.0-p15 — 2026-05-27

### P15 — Kling 3.0 FULL Integration

Adds Kuaishou Kling 3.0 as the third first-class video provider in media-forge.
All production Kling modes are wired: t2v + i2v (Standard + Pro), motion brush,
elements multi-ref, lip-sync (text + emotion or audio), Omni multi-shot
orchestration (up to 6 cuts in one call), video extension chain, and 4K Master
hero shots. Routing heuristic prefers Kling for multi-shot, 4K, motion-brush,
elements, lip-sync-emotion, and cost-sensitive volume work.

**Added**
- `KlingProvider` adapter in `src/video/providers/kling.ts`
- Hand-rolled JWT HS256 auth helper (`src/video/providers/auth/kling-jwt.ts`)
  with 25-minute per-access-key token cache. No new runtime deps.
- 4 Kling model specs registered: `kling-v3-standard` ($0.126/s),
  `kling-v3-pro` ($0.168/s), `kling-v3-master` (4K, ~$0.18/s placeholder),
  `kling-v3-omni` (multi-shot, ~$0.168/s placeholder)
- `KlingExtras` arm in `ProviderExtras` union (motion brush regions, elementIds,
  lipSync spec, omniMultiShot spec, watermark policy, character orientation)
- Kling webhook handler (`src/video/providers/kling-webhook-handler.ts`)
  resolves Kling `task_id` → internal `jobId`, downloads assets, records actual cost
- 8 new MCP tools (count 37→45): `media_kling_motion_brush`, `media_kling_element_create`,
  `media_kling_element_list`, `media_kling_element_delete`, `media_kling_elements`,
  `media_kling_lip_sync`, `media_kling_omni_multishot`, `media_kling_video_extend`
- New skill `skills/kling-prompting/SKILL.md` — 5-part prompt spine + cookbook
- New subagent `agents/kling-director.md` — orchestrates all Kling modes
- Live integration test gated behind `MEDIA_FORGE_RUN_LIVE_TESTS=true`
- Watermark guard — paid keys default `watermark_info.enabled=false`; explicit
  opt-in logs a warning

**Changed**
- `video-router` heuristic now prefers Kling for: multi-shot mode, 4K resolution,
  motion-brush, elements, lip-sync-with-emotion, and cost-sensitive t2v (Kling V3
  Standard at $0.126/s beats Veo at $0.50/s)
- `PROVIDERS` runtime array grows to `['google', 'higgsfield', 'kling']`
- `commands/setup.md` + `skills/setup/SKILL.md` add Kling credential wizard step

**Dependencies**
- ZERO new runtime dependencies. JWT signing is hand-rolled via `node:crypto`.

**Pricing flags**
- Kling V3 Master (4K) rate is placeholder $0.18/s — verify on first live invocation
- Kling V3 Omni multi-shot rate is placeholder $0.168/s — verify on first live invocation
- Both flagged `pricing.source: 'volatile-by-tier'` in registry

**Backward compatibility**
- All P13 + P14 exports preserved
- Existing routing decisions unchanged for cases where Kling is not the cost or
  capability winner (e.g. Veo still wins on audio-native + preferProvider override)

## 0.3.0-p14 — 2026-05-27

### P14 — Higgsfield FULL Integration

First full third-party video provider integration. Higgsfield's complete surface (Soul / Soul 2.0 / Soul ID / DoP / Cinema Studio 3.5 / Speak / Speak 2.0 / Marketing Studio / Recast / Virality Predictor) is wired as a `VideoProvider` alongside Veo, with goal-backward parity for all VIDEO_MODES it natively supports.

**Added**
- `HiggsfieldProvider` REST adapter in `src/video/providers/higgsfield.ts`
- `HiggsfieldExtras` discriminated arm of `ProviderExtras` in `src/video/providers/base.ts`
- 10 Higgsfield model specs in `VIDEO_MODELS` (Soul / Soul Pro / Soul 2 / DoP / DoP Turbo / Speak / Speak 2 / Cinema Studio 3.5 / Marketing Studio / Recast)
- `'higgsfield'` promoted into runtime `PROVIDERS` array
- SQLite migrations 002 (`soul_ids`) + 003 (`provider_request_map`)
- `src/core/soul-id-cache.ts` lifecycle API
- `src/core/provider-request-map.ts` request_id ↔ jobId reconciliation (SQLite + in-memory cache)
- `src/video/providers/higgsfield-webhook.ts` webhook payload mapper, registered at MCP boot
- 7 new MCP tools (count 30 → 37): `media_higgsfield_soul_id`, `media_higgsfield_dop`, `media_higgsfield_cinema_studio`, `media_higgsfield_speak`, `media_higgsfield_marketing_studio`, `media_higgsfield_recast`, `media_higgsfield_virality_predictor`
- Subagent `agents/higgsfield-director.md` covering all modes + Soul ID lifecycle + dispatch
- Skill `skills/higgsfield-prompting/SKILL.md` — MCSLA formula, DoP cheatsheet, Cinema lens dictionary, Marketing template decision tree

**Changed**
- `agents/video-router.md` — extended dispatch + P14 routing heuristic (lip-sync / targeted-edit / DoP / Cinema / Marketing → Higgsfield; plain modes → cheapest)
- `handleVideoRoute` — capability-before-cost ranking with safe `normalizeCostUSD` fallback for missing `usdPerCredit`
- `commands/setup.md` — Higgsfield plan picker (Plus/Ultra/Business/custom), `MEDIA_FORGE_HIGGSFIELD_USD_PER_CREDIT`, `MEDIA_FORGE_WEBHOOK_PUBLIC_URL`

**Auth resolution** (Task 1 empirical probe)
- Confirmed which auth scheme the platform accepts (`hf-api-key`+`hf-secret` SDK form vs `Authorization: Key K:S` REST form); documented in `higgsfield-headers.ts` JSDoc.

**Backward compatibility**
- All P13 tests continue to pass.
- `GoogleVeoProvider`, `media_video_cost_estimate`, `media_video_cost_report`, `media_video_route` (Veo path), `media_video_webhook_status` unchanged.
- Existing SQLite migrations 001 (video_jobs) unaffected.

## 0.2.0-p13 — 2026-05-26

### P13 — Provider Abstraction Foundation

Refactors media-forge to support multiple video providers behind a unified `VideoProvider` interface. Veo 3.1 remains the only wired provider in this release; P14-P16 add Higgsfield, Kling 3.0, Seedance 2.0. P13 also pre-stages P14 deps (Higgsfield SDK + auth helper, webhook router scaffold).

**Added**
- `Provider` type + `VIDEO_MODELS` registry + `PRICING_OVERRIDES` runtime hook in `src/core/models.ts`
- `VideoProvider` interface + `DownloadedAsset` return type + typed `ProviderExtras` discriminated union in `src/video/providers/base.ts`
- `GoogleVeoProvider` adapter in `src/video/providers/google-veo.ts` (local-path download passthrough, cost-tracker integration)
- SQLite cost tracker via Node built-in `node:sqlite` — `src/core/db.ts`, `src/core/cost-tracker.ts`, `migrations/sqlite/001-video-jobs.sql`
- `normalizeCostUSD` cross-unit cost helper + `loadPricingOverridesFromEnv` in `src/core/pricing.ts`
- Webhook router scaffold in `src/video/providers/webhook-router.ts` — HMAC + replay protection + origin guard + body cap + rate limit; bind 127.0.0.1 default
- Higgsfield auth scaffold in `src/video/providers/auth/higgsfield-headers.ts` — `hf-api-key` + `hf-secret` headers (verified against `@higgsfield/client@0.2.1` source)
- CLI: `media-forge cost report --by-provider --period 30d` (extends existing `cost estimate` + `cost summary`)
- MCP tools: `media_video_route`, `media_video_cost_estimate`, `media_video_cost_report`, `media_video_webhook_status`
- Subagent: `agents/video-router.md` (new) — routes by capability + cost + IP-risk

**Changed**
- Subagent renamed: `agents/video-editor.md` → `agents/veo-director.md` (git mv preserves history)
- `commands/setup.md` wizard now asks for `MEDIA_FORGE_DEFAULT_PROVIDER`, webhook secret, Higgsfield credentials
- Node engines: `>=20.0.0` → `>=22.5.0` (required for stable `node:sqlite` built-in)

**Dependencies**
- Added: `@higgsfield/client@0.2.1` (SDK install — no API calls yet; P14 will exercise)
- NOT added (plan deviation): `better-sqlite3` — replaced with built-in `node:sqlite` to avoid node-gyp build failures on Windows + Node 25

**Backward compatibility**
- All legacy exports in `src/core/models.ts` preserved (no consumer breakage)
- Existing `cost.jsonl` log and `cost summary` CLI continue to work alongside new SQLite-backed `cost report`
- Existing Veo MCP tools (`media_generate_video_*`) untouched

**Testing**
- 927/927 tests passing (76+ files, mix of unit + integration + MCP + CLI)
- P13 regression test confirms Veo flow works through new abstraction
- MCP server registration test prevents silent tool-not-registered fails (uses `_registeredTools` introspection with SDK version pin)

**Known follow-ups (documented in Execution Amendments at plan tail)**
- `skills/setup/SKILL.md` not synced with `commands/setup.md` — P14 chore
- `download()` API still passes path-as-jobId — split to typed `downloadByJobId` + `readLocalAsset` in P14 webhook router work
- Dual cost ledger (cost.jsonl + cost.db) — unify in P17 quality-maxout

## [0.1.0] — 2026-05-22

First production release. Top-tier Google AI image+video generation as a Claude Code plugin, MCP server, and standalone CLI.

### Added

- **Top-tier model lock (LOCKED, not configurable):**
  - `gemini-3-pro-image-preview` (Nano Banana Pro) — text-to-image, edit, compose, describe, palette extraction. Up to 4K, 10 aspect ratios, 14 reference images, thinking levels MINIMAL/LOW/MEDIUM/HIGH, Google Search grounding.
  - `imagen-4.0-ultra-generate-001` (Imagen 4 Ultra) — seed, negative prompt, 1K/2K, deterministic generation.
  - `veo-3.1-generate-preview` (Veo 3.1 Pro) — text-to-video, image-to-video, frame interpolation, asset references (up to 3), extension chains (+7s per hop, up to 20 hops/~148s, internal 720p forced). 720p/1080p/4K with `durationSeconds=8` constraint, 16:9 / 9:16 aspect ratios.

- **22 MCP tools** registered via `@modelcontextprotocol/sdk` 1.29.0 stdio transport. Image (6) + Video (7) + Pipeline/Utility (8) + Help (1).

- **CLI** (`media-forge` binary) — `doctor`, `image {generate,imagen,edit,compose,describe,palette}`, `video {t2v,i2v,interpolate,refs,extend,poll,download,wait}` (+ `--bg` background mode), `cost`, `audit`, `prompts`, `models`, `config` subcommands. Positional `<prompt>` arguments.

- **11 domain-specialized subagents** (`agents/*.md`): cinematic-director, product-photographer, ad-designer, character-designer, hyperrealistic-artist, enterprise-corrector (Opus), prompt-engineer, scene-composer, veo-director, video-router, quality-reviewer (Opus, xhigh thinking, read-only).

- **11 skills** (`skills/<name>/SKILL.md`): 8 entry skills (create, setup, campaign, character-sheet, scene-compose, cinematic-short, extend-video, audit), 1 knowledge skill (capability-matrix), 2 internal skills (ocr-validate, brand-check).

- **10 slash commands** (`commands/*.md`) including zero-arg `/media-forge` help router.

- **30 prompt templates** across 10 domains (3 per domain): product, character, cinematic, ad-creative, hyperrealistic, enterprise, video-t2v, video-i2v, video-extension, food-product-crossover. YAML with Zod-validated frontmatter + `${variable}` interpolation + `_index.json` build script.

- **Smart-routing 3-stage reviewer:** OCR (Cloud Vision default, PaddleOCR stub for v0.2.0) → brand compliance (CIEDE2000 ΔE, logo presence via Cloud Vision, font keyword scan) → LLM judge (Claude Opus via subagent dispatch inside Claude Code OR via `@anthropic-ai/sdk` standalone). 10 error classes route to fix agents with bounded retries (max 3).

- **Output manager:** versioned `./outputs/jobs/<jobId>/v<N>/` structure with `asset.<ext>`, `metadata.json`, `payload.json`, `prompt.json`, `summary.json`, `trace.jsonl` (per-step JSONL), `lineage.json` (cross-version).

- **Cost guard:** dry-run default for any cost ≥$0.50 (`--dry-run` flag works without API key), audit log (`~/.media-forge/cost-log.jsonl`), `MEDIA_FORGE_CONFIRM_THRESHOLD_USD` / `MEDIA_FORGE_BLOCK_THRESHOLD_USD` / `MEDIA_FORGE_DAILY_CAP_USD` knobs.

- **Hybrid Gemini API + Vertex AI:** `GOOGLE_API_KEY` / `GEMINI_API_KEY` env vars enable Gemini Developer API; `GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` enable Vertex mode.

- **`SubagentStart` and `SessionEnd` hooks** (`hooks/hooks.json`) with cross-platform Git Bash wrapper (`run-hook.cmd`).

- **Plugin scaffold:** `.claude-plugin/plugin.json` (auto-discovery for skills/commands/agents/hooks/mcpServers), `.mcp.json` env-interpolation.

- **Tests:** 782 unit (50+ files), 16 integration mocked, 2 integration live (real API, gated $0.50 cap), 5 golden PSNR fixtures, 15 reviewer calibration eval scenarios.

- **Marketplace integration:** `maxvision-utilities/.claude-plugin/marketplace.json` registers media-forge as 3rd plugin alongside n8n-skills + gtm-skills.

- **Documentation:** README (production), `docs/specification.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/usage.md` (cookbook with 22 tools + 5 recipes), `docs/troubleshooting.md`, `docs/final-coverage-checklist.md`, `CONTRIBUTING.md` (3 add-flow guides), `docs/devloop.md` (`pnpm dev:claude` hot-reload).

### Fixed

- **BUG-1 (dry-run required API key):** `loadConfig()` no longer throws on missing `GOOGLE_API_KEY`. Validation moved to `createClient()`, conditional on `dryRun === false`. Dry-run, `--help`, `--version`, and `media-forge doctor` now work without auth.

- **BUG-2 (CLI docs vs reality):** README + `docs/specification.md` examples aligned to positional `<prompt>` syntax used by commander `.argument()`. `docs/usage.md` already correct.

- **BUG-3 (Gemini Developer API rejects Vertex-only fields):** stripped `personGeneration` (image) and `generateAudio` (video) from payloads when `client.mode === 'gemini'`. Schemas unchanged (Vertex users still set them); conditional spread emits API-compatible payloads in both modes. `logger.debug` breadcrumb records stripped fields.

- **BUG-4 (`operations.getVideosOperation` throws `_fromAPIResponse is not a function`):** polling now instantiates the real `GenerateVideosOperation` class from `@google/genai` instead of passing a plain `{ name }` object. The SDK's own `_fromAPIResponse` correctly normalizes the mldev response (`generatedSamples` → `generatedVideos`).

- **DEBT-008 (MCP `tools/list` empty inputSchema for ZodEffects-wrapped tools):** registered `_Base` plain ZodObject as `inputSchema` for proper JSON Schema emission; added `validationSchema` field on `MCPTool` carrying the full `superRefine` schema; `validateInput()` helper re-parses at handler boundary. Cross-field rules still enforced server-side. Filed upstream [`modelcontextprotocol/typescript-sdk#2145`](https://github.com/modelcontextprotocol/typescript-sdk/issues/2145) with repro + suggested `unwrapToObject` helper.

- Test infra: `vitest.integration.config.ts` exclude conflict with `pnpm test:integration:live` script (runtime `describe.skipIf` gate suffices). Plugin-dispatch test process leak (`afterAll` → `afterEach`). Windows U+F03A path encoding (renamed `skills/media-forge:X/` → short names; loader concatenates plugin name at runtime).

### Changed

- Video resolution default exposed as `720p` (cost-conscious, extension-chain compatible). `1080p` and `4k` require `durationSeconds=8` per Google API constraint; extension hops always 720p per Google API constraint.

- Live-smoke fixtures (`tests/integration/live-smoke.test.ts`) now follow the OFFICIAL Google prompt frameworks (Nano Banana Pro structure + Veo 3.1 5-part formula). File header documents source URLs and explains why subjects avoid copyright/celebrity mappings that trigger Layer 2 RAI `IMAGE_RECITATION`. Doubles as executable reference for P11 templates.

### Known limitations (carried into v0.1.0)

- **DEBT-003 — Openclaw 3GB pollution at home directory.** Out-of-band cleanup deferred to a dedicated session. Unrelated to media-forge functionality.
- **DEBT-006 — Imagen 4 Ultra `imageSize` parameter silently dropped.** `@google/genai` 2.6.0 `GenerateImagesConfig` interface lacks the field. Imagen falls back to its own default; `logger.warn` emits when non-default requested. Will activate when SDK adds the field.
- **DEBT-007 — `paddleocr-wasm` OCR backend stubbed.** Cloud Vision default is fully functional. Local PaddleOCR backend deferred to v0.2.0.
- **`media_compose_scene`** uses Nano Banana Pro semantic edit only (no manual masks); inpaint requires `--mask <path>` and is supported via `media_edit_image` only.
- **v0.2.0 candidate domains** (10 deferred from the initial 20-subagent design): illustration-artist, cartoon-animator, 3d-render-artist, social-content-creator, motion-graphics, comic-panel-artist, infographic-designer, architectural-viz, food-photography, fashion-photographer. With 120 deferred templates.

### Initial scaffold (from earlier unreleased baseline)

- Initial plugin scaffold (folders, package.json, TypeScript strict config, tsup build, ESLint flat config, Prettier, Vitest with 80% coverage thresholds).
- pnpm-workspace.yaml at marketplace root to isolate media-forge from external pnpm workspaces.
