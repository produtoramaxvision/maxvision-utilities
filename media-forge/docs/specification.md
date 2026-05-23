# media-forge — Specification

**Version:** 0.1.0
**Source:** Distilled from design spec (2026-05-21) + implementation reality (P0-P12 complete).

---

## 1. Model Lock Policy

media-forge exposes exactly three model identifiers. These constants are defined in `src/core/models.ts` and are the single source of truth — all service files, CLI commands, MCP schemas, and documentation reference these constants, never raw strings.

```
IMAGE_MODEL_NANO_BANANA_PRO  = "gemini-3-pro-image-preview"
IMAGE_MODEL_IMAGEN_4_ULTRA   = "imagen-4.0-ultra-generate-001"
VIDEO_MODEL_VEO_3_1_PRO      = "veo-3.1-generate-preview"
```

**Why top-tier only:** The plugin is quality-first. Exposing mid-tier or budget models would create decision paralysis and unpredictable output quality. Cost guards (see §5 of README) compensate for the higher per-call price.

**What is excluded:**
- Nano Banana 2 / Nano Banana (non-Pro variants)
- Imagen 4 Fast / Imagen 4 Standard
- Veo 3.1 Fast / Veo 3.1 Lite
- Google Omni (no public API as of v0.1.0; feature-flagged stub only via `MEDIA_FORGE_OMNI=experimental`)

---

## 2. Capability Matrix

### 2.1 Nano Banana Pro (`gemini-3-pro-image-preview`)

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `aspectRatio` | `1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`, `16:9`, `21:9` | `1:1` | 10 ratios |
| `imageSize` | `1K`, `2K`, `4K` | `4K` | Top-tier default is 4K |
| `thinkingLevel` | `minimal`, `low`, `medium`, `High` | `High` | Pro-only feature |
| `personGeneration` | `ALLOW_ALL`, `ALLOW_ADULT`, `ALLOW_NONE` | `ALLOW_ADULT` | Region-coerced for EU/UK/CH/MENA |
| `referenceImages` | array, max 14 | `[]` | Sub-quotas: ≤6 object refs + ≤5 character refs |
| `useGoogleSearch` | boolean | `false` | Incompatible with caching/code-execution/function-calling |
| Supports composition | yes | — | Up to 14 role-labeled reference images |
| Supports editing | yes | — | Semantic add/remove/replace |
| Seed / negative prompt | no | — | Use Imagen 4 Ultra for these |

### 2.2 Imagen 4 Ultra (`imagen-4.0-ultra-generate-001`)

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `aspectRatio` | `1:1`, `9:16`, `16:9`, `3:4`, `4:3` | `1:1` | 5 ratios (subset of Nano Banana Pro) |
| `numberOfImages` | 1–4 | 1 | Batch generation |
| `seed` | integer (optional) | — | Reproducible generation |
| `negativePrompt` | string (optional) | — | Exclude unwanted elements |
| `personGeneration` | `ALLOW_ALL`, `ALLOW_ADULT`, `ALLOW_NONE` | `ALLOW_ADULT` | Same coercion rules |
| `imageSize` | `1K`, `2K` | `2K` | Note: SDK v2.6.0 does not expose this field in `GenerateImagesConfig`; value is logged as a warning (DEBT-006) |
| Seed / negative prompt | yes | — | Primary use case for Imagen 4 path |
| Max images per call | 4 | — | |

### 2.3 Veo 3.1 Pro (`veo-3.1-generate-preview`)

| Parameter | Values | Default | Notes |
|---|---|---|---|
| `aspectRatio` | `16:9`, `9:16` | `16:9` | |
| `durationSeconds` | `4`, `6`, `8` | `8` | Top-tier default is max duration |
| `resolution` | `720p`, `1080p`, `4k` | `720p` | `1080p` and `4k` require `durationSeconds=8` (capability validator) |
| `personGeneration` | `allow_all`, `allow_adult` | `allow_adult` | `allow_none` not supported by Veo |
| `seed` | integer (optional) | — | |
| `numberOfVideos` | `1` (literal) | 1 | Gemini API hard limit for Veo 3.1 |
| Supports audio | yes | — | |
| Supports I2V | yes | — | First frame anchor |
| Supports interpolation | yes | — | First + last frame |
| Supports extension | yes | — | +7s per hop; internal resolution forced to 720p |
| Max extension hops | 20 | — | Max total ~148s |
| Polling timeout | 15 minutes | — | Abortable via AbortSignal |
| Download TTL | 2 days | — | Plugin downloads immediately on completion |

**Extension note:** Video extension hops output at 720p regardless of the original resolution. This is a Google API constraint, not a plugin choice. The orchestrator preserves the Pro-tier model throughout and documents the resolution trade-off.

---

## 3. MCP Tool Registry (22 tools)

The MCP server exposes exactly 22 tools, registered in `src/mcp/handlers.ts` using schemas from `src/mcp/schemas.ts`.

### Image tools (6)

| Tool name | Description |
|---|---|
| `media_generate_image` | Text-to-image via Nano Banana Pro. Supports up to 14 reference images with role labels. |
| `media_generate_imagen` | Text-to-image via Imagen 4 Ultra. Use when seed / negative_prompt / multiple images needed. |
| `media_edit_image` | Semantic image editing: add, remove, or replace elements via natural language. |
| `media_compose_scene` | Multi-image scene composition with up to 14 role-labeled reference images. |
| `media_describe_image` | Gemini vision → text description of an image. |
| `media_extract_palette` | Extract dominant color palette from an image (local, node-vibrant, no API call). |

### Video tools (7)

| Tool name | Description |
|---|---|
| `media_generate_video_t2v` | Text-to-video via Veo 3.1 Pro. Returns an operation name for async polling. |
| `media_generate_video_i2v` | Image-to-video. Anchors the first frame to the provided image. |
| `media_generate_video_interpolate` | Frame interpolation: provide first and last frames, Veo fills the motion between them. |
| `media_generate_video_with_refs` | Video generation with up to 3 asset references (ASSET type). |
| `media_extend_video` | Extend an existing video by +7s via Veo 3.1 extension. Up to 20 hops. |
| `media_poll_video_operation` | Poll a long-running Veo operation by name. Returns status and videoUri on completion. |
| `media_download_video` | Download a completed video from a resolved HTTPS or GCS URI. |

### Pipeline / utility tools (8)

| Tool name | Description |
|---|---|
| `media_dry_run_payload` | Return the assembled API payload + cost estimate without calling the API. |
| `media_estimate_cost` | Batch cost estimation for a list of operations. Returns per-item and total USD. |
| `media_validate_environment` | Check API key availability and model accessibility. |
| `media_capability_matrix` | Return the full model × parameter capability table. Filter by model with `model` param. |
| `media_list_outputs` | List jobs in `.media-forge/jobs/`. (v0.1.0: returns empty list; full implementation in v0.2.0.) |
| `media_get_job_metadata` | Read a job's metadata.json, trace.jsonl, and lineage.jsonl by job ID. |
| `media_run_ocr` | Run OCR over an image using Cloud Vision (or paddleocr-wasm stub). |
| `media_check_brand_compliance` | Check brand guideline compliance: palette ΔE2000, logo presence, font keywords. |

### Help tool (1)

| Tool name | Description |
|---|---|
| `media_help` | List all tools or show detailed help for a specific tool by name. |

**Note on input schemas (DEBT-008):** Tools using `.superRefine()` for cross-field validation (approximately 10 of the 22) emit `inputSchema: {}` in `tools/list` responses. Runtime validation is unaffected. Client-side UI introspection (param hints, type completion) is degraded for those tools. See `docs/troubleshooting.md` for the workaround.

---

## 4. CLI Surface

All CLI subcommands are exposed via the `media-forge` binary (`bin/media-forge` → `dist/cli/cli.js`).

### Top-level commands

| Command | Purpose |
|---|---|
| `media-forge doctor` | Validate environment: API key presence, model reachability, output dir writable |
| `media-forge models` | List the three locked model IDs with capability summaries |
| `media-forge config <subcommand>` | Read and write `~/.media-forge/config.json` |
| `media-forge prompts list [--domain <name>]` | List prompt templates; optionally filter by domain |
| `media-forge prompts show <id>` | Display a template with rendered variable slots |
| `media-forge audit <job_id\|all> [--json]` | Display job lineage, trace, verdicts |
| `media-forge cost estimate --command "<cmd>"` | Dry-run cost estimate for any other CLI command |

### `media-forge image` subcommands

| Subcommand | Key flags | Notes |
|---|---|---|
| `image generate` | `<prompt>`, `--aspect-ratio`, `--image-size`, `--dry-run` | Nano Banana Pro path (positional prompt) |
| `image imagen` | `<prompt>`, `--aspect-ratio`, `--seed`, `--negative-prompt`, `--num-images` | Imagen 4 Ultra path (positional prompt) |
| `image edit` | `<inputPath>`, `<prompt>` | Semantic edit (both positional) |
| `image compose` | `<prompt>`, `--refs <paths>` | Multi-image composition (positional prompt) |
| `image describe` | `--input <path>` | Vision description |
| `image palette` | `--input <path>` | Color palette extraction |

### `media-forge video` subcommands

| Subcommand | Key flags | Notes |
|---|---|---|
| `video t2v` | `<prompt>`, `--duration-seconds`, `--resolution`, `--dry-run` | Text-to-video (positional prompt) |
| `video i2v` | `<prompt>`, `--image <path>`, `--duration-seconds` | Image-to-video (positional prompt) |
| `video interpolate` | `<prompt>`, `--first <path>`, `--last <path>`, `--duration-seconds` | Frame interpolation (positional prompt) |
| `video refs` | `<prompt>`, `--refs <paths>`, `--duration-seconds` | Video with asset references (positional prompt) |
| `video extend` | `<prompt>`, `--source-uri <uri>`, `--hop-index <n>` | +7s extension hop (positional extension directive prompt) |
| `video poll` | `--operation-id <opid>` | Poll operation status |
| `video download` | `--uri <https-uri>`, `--output-dir <dir>` | Download from resolved URI |
| `video wait` | `--operation-id <opid>` | Block until done; auto-downloads |

**Common flags (all commands):** `--dry-run`, `--json`, `--estimate-cost`, `--strict`, `--project <name>`, `--output-dir <path>`, `--bg` (background polling).

---

## 5. Agent Registry (10 agents)

Agents are defined as `.md` files in `agents/`. The plugin loader builds the fully-qualified name `media-forge:<name>` at runtime. All agents use `memory: project`.

| Agent file | FQ name | Model | Effort | Role |
|---|---|---|---|---|
| `cinematic-director.md` | `media-forge:cinematic-director` | sonnet | high | Cinematic shorts, ads, music videos via Veo 3.1 Pro + Nano Banana Pro |
| `product-photographer.md` | `media-forge:product-photographer` | sonnet | medium | E-commerce shots, packshots, lifestyle via Nano Banana Pro 4K + Imagen 4 Ultra |
| `ad-designer.md` | `media-forge:ad-designer` | sonnet | medium | Display ads, social creatives, banners with text rendering emphasis |
| `character-designer.md` | `media-forge:character-designer` | sonnet | high | Character sheets, expression sheets, identity-lock consistency |
| `hyperrealistic-artist.md` | `media-forge:hyperrealistic-artist` | sonnet | high | Photorealistic portraits and scenes via Nano Banana Pro 4K + Imagen 4 Ultra |
| `enterprise-corrector.md` | `media-forge:enterprise-corrector` | opus | high | Brand guideline enforcement: palette ΔE2000, logo zone, approved fonts |
| `prompt-engineer.md` | `media-forge:prompt-engineer` | sonnet | high | User intent → `refined_spec.json`; SCALIST framework + safety rephrasing |
| `scene-composer.md` | `media-forge:scene-composer` | sonnet | high | Multi-image composition up to 14 references; background removal + white-balance pre-clean |
| `video-editor.md` | `media-forge:video-editor` | sonnet | medium | Veo extension chains, frame interpolation, temporal-drift color anchoring |
| `quality-reviewer.md` | `media-forge:quality-reviewer` | opus | xhigh | READ-ONLY 3-stage reviewer: OCR → brand → LLM judge. Returns Verdict JSON. |

**10 additional domain agents** (illustration-artist, cartoon-animator, 3d-render-artist, social-content-creator, motion-graphics, comic-panel-artist, infographic-designer, architectural-viz, food-photography, fashion-photographer) are deferred to v0.2.0.

---

## 6. Skill Registry (11 skills)

Skills live in `skills/<name>/SKILL.md`. The plugin loader builds `media-forge:<name>` at runtime.

### Entry-point skills (user-invocable)

| Skill | FQ name | Description |
|---|---|---|
| `create` | `media-forge:create` | One-shot: any image or video. Auto-routes to the correct domain agent. |
| `campaign` | `media-forge:campaign` | Multi-asset campaign: hero + variations + sizes. Consistent character/style. |
| `character-sheet` | `media-forge:character-sheet` | Identity-lock portrait + turnaround + expression sheet from one reference. |
| `scene-compose` | `media-forge:scene-compose` | Multi-image scene assembly up to 14 references. |
| `cinematic-short` | `media-forge:cinematic-short` | Cinematic short video: storyboard → frame imagery → video chain. |
| `extend-video` | `media-forge:extend-video` | Veo +7s extension chain up to 20 hops. |
| `audit` | `media-forge:audit` | Audit a job: metadata, trace, lineage, verdict history. |
| `setup` | `media-forge:setup` | Onboarding wizard: env detection, API key prompts, first dry-run smoke. |
| `capability-matrix` | `media-forge:capability-matrix` | Model × params cheatsheet. Static reference read by all agents. |

### Internal skills (not user-invocable)

| Skill | FQ name | Description |
|---|---|---|
| `ocr-validate` | `media-forge:ocr-validate` | OCR text validation via Cloud Vision. Used by quality-reviewer. |
| `brand-check` | `media-forge:brand-check` | Brand compliance check (color ΔE2000 + logo + font). Used by quality-reviewer and enterprise-corrector. |

**Note:** `media-forge:campaign`, `media-forge:product-shoot`, `media-forge:ad-creative`, and `media-forge:cost-check` from the design spec were merged into the above 11 skills during P10 implementation.

---

## 7. Slash Command Index (10 commands)

Commands in `commands/` provide slash-command shims that invoke skills.

| Command file | Slash command | Invokes |
|---|---|---|
| `create.md` | `/media-forge:create <brief>` | `media-forge:create` skill |
| `campaign.md` | `/media-forge:campaign <brief>` | `media-forge:campaign` skill |
| `character.md` | `/media-forge:character <name> <description>` | `media-forge:character-sheet` skill |
| `cinematic.md` | `/media-forge:cinematic <brief>` | `media-forge:cinematic-short` skill |
| `extend.md` | `/media-forge:extend <job_id\|path> <brief>` | `media-forge:extend-video` skill |
| `audit.md` | `/media-forge:audit <job_id\|all>` | `media-forge:audit` skill |
| `cost.md` | `/media-forge:cost <brief>` | Dry-run cost estimate |
| `models.md` | `/media-forge:models` | Lists the three locked model IDs |
| `setup.md` | `/media-forge:setup` | `media-forge:setup` skill |
| `media-forge.md` | `/media-forge` | Zero-argument help: lists all commands |

---

## 8. Prompt Template Library

Templates are YAML files in `prompts/<domain>/`. The `_index.json` is built by `pnpm build:prompts`.

**v0.1.0 scope:** 30 templates across 10 active domains (3 per domain).

| Domain | Templates |
|---|---|
| `product` | e-commerce white-bg, lifestyle context, studio hero |
| `character` | identity-lock, turnaround sheet, expression sheet |
| `cinematic` | trailer teaser, product reveal, establishing shot |
| `ad-creative` | display banner, social vertical, brand awareness |
| `hyperrealistic` | portrait, urban scene, nature close-up |
| `enterprise` | brand-compliant product, corporate lifestyle, branded event |
| `food-product-crossover` | flatlay knolling, macro hero, splash slow-mo |
| `video-t2v` | cinematic pan, product hero reveal, abstract motion |
| `video-i2v` | product bring-to-life, portrait subtle motion, scene continuation |
| `video-extension` | scene continuation, character walk-away, ambient loop |

**120 additional templates** across 10 deferred domains are planned for v0.2.0.

Each template carries: `id`, `version`, `description`, `domain`, `recommended_model`, `recommended_aspect`, `recommended_size`, `variables` (with defaults), `template` (interpolation string), `expected_text_in_output`, and `attribution`.
