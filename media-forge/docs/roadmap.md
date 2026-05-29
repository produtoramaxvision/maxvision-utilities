# media-forge — Roadmap

---

## v0.1.1 — Current Release

**Scope:** Production-ready plugin for top-tier image and video generation via Claude Code, MCP, and CLI. Google-only image plus multi-provider video (Veo, Higgsfield, Kling 3.0, Seedance 2.0).

> History: v0.1.1 consolidates v0.1.0 (P0–P12 baseline) + refs-integration (MinIO/pgvector reference library) + P13 provider abstraction + P14 Higgsfield + P15 Kling 3.0 + P16 Seedance 2.0. The `0.1.1` tag is a clean semver reset of the in-development `-pNN` phase suffixes; no code change from `0.5.0-p16`.

### What ships in v0.1.1

**Model support:**
- `gemini-3-pro-image-preview` (Nano Banana Pro) — full feature set: 4K, 10 aspect ratios, up to 14 reference images, thinking levels, editing, composition
- `imagen-4.0-ultra-generate-001` (Imagen 4 Ultra) — seed, negative prompt, multi-image batches
- `veo-3.1-generate-preview` (Veo 3.1 Pro) — T2V, I2V, interpolation, extension chains up to ~148s

**Video providers (4) behind a unified `VideoProvider` interface:**
- Google Veo 3.1 — T2V/I2V/interpolate/extend
- Higgsfield — Soul / Soul ID / DoP / Cinema Studio / Speak / Marketing Studio / Recast / Virality Predictor
- Kling 3.0 (Kuaishou) — t2v/i2v Standard+Pro, 4K Master, Omni multi-shot, motion brush, elements, lip-sync
- Seedance 2.0 (ByteDance, via fal.ai) — Standard/Fast tiers, multi-shot, reference fusion, native audio; feature-flagged (`MEDIA_FORGE_SEEDANCE_ENABLED`)
- `video-router` agent picks provider by capability + cost + IP-risk; SQLite cost tracker + webhook router

**Reference library (refs-integration):**
- Curated MinIO bucket wired as semantic reference source; pgvector search (Voyage Multimodal-3), Marengo 3.0 alt backend (AWS Bedrock); 4 refs MCP tools + NBP moodboard fusion

**Plugin surfaces (3):**
- Claude Code plugin: 14 agents, 14 skills, 10 slash commands
- MCP server: 54 tools via stdio transport (50 with Seedance disabled)
- CLI: `media-forge` binary with `image`, `video`, `cost`, `audit`, `prompts`, `models`, `config`, `doctor` subcommands

**Quality review pipeline:**
- 3-stage reviewer (OCR + brand compliance + LLM-as-judge)
- Bounded retry loop (max 3 attempts)
- Smart routing across 10 error classes
- Full lineage tracking (trace.jsonl + lineage.json per job)

**Prompt template library:**
- 30 templates across 10 domains (3 per domain)
- YAML format with variables, defaults, attribution
- Searchable index at `prompts/_index.json`

**Cost safety:**
- 4-tier cost guard (silent / notice / confirm / block)
- Daily cap ($25 default, configurable)
- Dry-run default for all generation commands

**Test coverage:**
- 1394 tests passing (8 skipped, live-API gated) across unit + integration + MCP + CLI + provider suites
- Per-phase regression tests (p13–p16) + live smoke tests gated behind `MEDIA_FORGE_RUN_LIVE_TESTS=true`
- 5 golden PSNR comparison tests
- Reviewer calibration eval (15 scenarios, ≥80% accuracy target)

---

## v0.2.0 — Candidates

### 10 deferred domain agents

These agents were designed in the specification but deferred from v0.1.0 to keep the initial release focused. Each maps to an existing Nano Banana Pro / Veo 3.1 Pro capability but requires domain-specific prompt engineering and review tuning.

| Agent | Role |
|---|---|
| `media-forge:illustration-artist` | Line-art, hand-drawn illustration, editorial style |
| `media-forge:cartoon-animator` | Cartoon, anime, cel-shaded video via Nano Banana Pro + Veo 3.1 Pro |
| `media-forge:3d-render-artist` | CGI renders, octane-style, Nano Banana Pro 4K |
| `media-forge:social-content-creator` | 9:16 verticals, Reels, TikTok, Shorts (top-tier only) |
| `media-forge:motion-graphics` | Animated logos, type animation, abstract keyframes + Veo |
| `media-forge:comic-panel-artist` | Comic sequences, manga, multi-panel layouts |
| `media-forge:infographic-designer` | Data visualization, structured infographics, high text accuracy |
| `media-forge:architectural-viz` | Interior/exterior renders, walkthrough video via Veo 3.1 Pro |
| `media-forge:food-photography` | Flatlay, macro, hero, splash slow-mo |
| `media-forge:fashion-photographer` | Editorial, catalog, runway, lifestyle |

### 120 deferred prompt templates

30 templates ship in v0.1.0 (3 per domain × 10 active domains). 120 more are planned for v0.2.0, covering:
- 10 templates per active domain (7 additional per domain)
- 3 templates per new domain (10 deferred domains × 3 = 30 templates for new agents)
- Total target for v0.2.0: ~150 templates in `prompts/_index.json`

### paddleocr-wasm OCR backend (DEBT-007)

The local PaddleOCR WASM backend is stubbed in `src/review/ocr-validator.ts`. v0.2.0 will implement the WASM init + inference path, removing the dependency on Cloud Vision API for OCR and enabling fully offline text validation. The WASM binary size and startup latency trade-offs will be documented.

### Other v0.2.0 candidates

- `media_list_outputs` full implementation (currently returns empty list placeholder)
- PDF input for `prompt-engineer` to ingest creative briefs
- Lightroom-style color grade preset application
- Multi-shot video assembly (FFmpeg stitch + crossfade wrapper)
- Google Omni integration (pending public API availability; feature-flagged stub via `MEDIA_FORGE_OMNI=experimental`)

---

## v0.3.0+ — Vision

- Multi-region SDK (automatic `person_generation` coercion per Google regional rules, no manual flag)
- Batch job orchestration (queue N assets with shared context; progress dashboard)
- Web UI for job management and lineage visualization
- Webhook notifications on job completion (for CI/CD integration)
- Additional model support as Google releases new tiers (model IDs isolated in `src/core/models.ts` for drop-in upgrade)

---

## Known Debts (as of v0.1.1)

All open follow-ups and pending items are tracked in a single file: `.maxvision/dev-ledger/FOLLOWUPS.md` (planning repo, not in the plugin tree). The resolved-debt audit trail is archived alongside it. The table below is a snapshot; `FOLLOWUPS.md` is the source of truth.

| ID | Severity | Status | Summary |
|---|---|---|---|
| DEBT-001 | Low | RESOLVED (P11, commit `7972964`) | `build-prompt-index.ts` was a stub; now delegates to `writeIndex()` from template-loader. `_index.json` has 30 entries. |
| DEBT-002 | Cosmetic | Accepted | `ApiFieldError` re-exported from `capabilities.ts` for caller ergonomics. Two valid import paths exist; harmless. |
| DEBT-003 | Medium | Deferred (out-of-band) | Openclaw global-install pollution (~3 GB) at user home dir. Separate cleanup session; not media-forge-specific. |
| DEBT-004 | None | Accepted | `eslint.config.js` `ignores` array added for `coverage/`, `dist/`, `node_modules/`. Standard practice. |
| DEBT-005 | Low | Accepted | `ImageInput`/`VideoInput` discriminated unions skip `superRefine`. MCP layer uses individual schemas (verified). |
| DEBT-006 | Low | Accepted (pending SDK update) | Imagen 4 Ultra `imageSize` not in SDK `GenerateImagesConfig`; emits `logger.warn` and proceeds. Wires in when SDK adds the field. |
| DEBT-007 | Low | Deferred to v0.2.0 | `paddleocr-wasm` backend stubbed; Cloud Vision default is production-ready for v0.1.0. |
| DEBT-008 | Medium | **RESOLVED (v0.1.0)** | ZodEffects `tools/list` empty `inputSchema` fixed: `_Base` ZodObject registered for JSON Schema emission, `validationSchema` re-parsed at handler boundary. Upstream filed `modelcontextprotocol/typescript-sdk#2145`. |
| FU-P13 | Low | Open (P17 quality-maxout) | Dual cost ledger (`cost.jsonl` + SQLite `cost.db`) runs in parallel; unify into one source of truth. |
| FU-P15 | Low | Open — verify on first live run | Kling V3 Master (4K) ~$0.18/s and Omni multi-shot ~$0.168/s are placeholder rates flagged `pricing.source: 'volatile-by-tier'`. Confirm against live invoice. |
| FU-P16 | Operator risk | Accepted (operator responsibility) | Seedance 2.0 under active Disney/Paramount IP litigation. Zero runtime IP gating shipped; emergency removal via `MEDIA_FORGE_SEEDANCE_ENABLED=false`. |
