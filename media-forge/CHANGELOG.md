# Changelog

All notable changes to `media-forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
