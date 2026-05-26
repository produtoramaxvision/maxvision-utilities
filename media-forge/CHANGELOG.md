# Changelog

All notable changes to `media-forge` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
