# media-forge — Roadmap

---

## v0.1.0 — Current Release

**Scope:** Production-ready plugin for top-tier Google AI image and video generation via Claude Code, MCP, and CLI.

### What ships in v0.1.0

**Model support:**
- `gemini-3-pro-image-preview` (Nano Banana Pro) — full feature set: 4K, 10 aspect ratios, up to 14 reference images, thinking levels, editing, composition
- `imagen-4.0-ultra-generate-001` (Imagen 4 Ultra) — seed, negative prompt, multi-image batches
- `veo-3.1-generate-preview` (Veo 3.1 Pro) — T2V, I2V, interpolation, extension chains up to ~148s

**Plugin surfaces (3):**
- Claude Code plugin: 10 agents, 11 skills, 10 slash commands
- MCP server: 22 tools via stdio transport
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
- 760 unit tests (~95% line coverage)
- 16 integration tests (mocked E2E) + 6 gated (live API + dispatch + evals)
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

## Known Debts Carried into v0.1.0

The following debts are tracked in `.maxvision/notes/2026-05-22-media-forge-pending-debts.md` (planning repo, not in the plugin tree). Each has been explicitly accepted or deferred.

| ID | Severity | Status | Summary |
|---|---|---|---|
| DEBT-001 | Low | RESOLVED (P11, commit `7972964`) | `build-prompt-index.ts` was a stub; now delegates to `writeIndex()` from template-loader. `_index.json` has 30 entries. |
| DEBT-002 | Cosmetic | Accepted | `ApiFieldError` re-exported from `capabilities.ts` for caller ergonomics. Two valid import paths exist; harmless. |
| DEBT-003 | Medium | Deferred (out-of-band) | Openclaw global-install pollution (~3 GB) at user home dir. Separate cleanup session; not media-forge-specific. |
| DEBT-004 | None | Accepted | `eslint.config.js` `ignores` array added for `coverage/`, `dist/`, `node_modules/`. Standard practice. |
| DEBT-005 | Low | Accepted | `ImageInput`/`VideoInput` discriminated unions skip `superRefine`. MCP layer uses individual schemas (verified). |
| DEBT-006 | Low | Accepted (pending SDK update) | Imagen 4 Ultra `imageSize` not in SDK `GenerateImagesConfig`; emits `logger.warn` and proceeds. Wires in when SDK adds the field. |
| DEBT-007 | Low | Deferred to v0.2.0 | `paddleocr-wasm` backend stubbed; Cloud Vision default is production-ready for v0.1.0. |
| DEBT-008 | **Medium** | Workaround documented | ZodEffects schemas return `inputSchema: {}` in `tools/list` for ~10 of 22 tools. Runtime validation is correct. Client UI introspection is degraded. Workaround: use Option A (register `_Base` ZodObject for introspection, full schema in handler) before v0.2.0. See `docs/troubleshooting.md`. |
