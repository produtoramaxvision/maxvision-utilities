# media-forge — Architecture

**Version:** 0.1.1

---

## 1. System Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Access Surfaces                                                             │
│                                                                             │
│  Claude Code plugin           MCP standalone         CLI (commander)        │
│  (skills + agents +           (.mcp.json +           (bin/media-forge       │
│   slash commands)              stdio transport)       → dist/cli/cli.js)    │
└────────────────┬──────────────────────┬──────────────────────┬─────────────┘
                 │                      │                      │
                 ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  src/mcp/server.ts   ←→   src/mcp/handlers.ts   ←→   src/mcp/schemas.ts   │
│  (MCP server,               (54 tool handlers,         (Zod schemas for     │
│   stdio transport,           wrap() + asResult())      all 54 tools)        │
│   tools/list,                                                               │
│   tools/call)                                                               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│  src/image/     │   │  src/video/      │   │  src/review/        │
│  image-service  │   │  video-service   │   │  review-service     │
│  (Nano Banana   │   │  (Veo 3.1 Pro:   │   │  (OCR validator,    │
│  Pro + Imagen   │   │  T2V/I2V/interp/ │   │  brand checker,     │
│  4 Ultra)       │   │  extend/poll/    │   │  LLM judge,         │
│                 │   │  download)       │   │  router, reviewer)  │
└────────┬────────┘   └────────┬─────────┘   └──────────┬──────────┘
         │                     │                         │
         └─────────────────────┼─────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  src/core/                                                                  │
│  client.ts      — @google/genai wrapper; Gemini API + Vertex AI mode        │
│  config.ts      — loadConfig(env): frozen config; reads from env + file     │
│  models.ts      — 3 locked model ID constants + enum casings                │
│  capabilities.ts — cross-validators for model × param compatibility         │
│  cost.ts        — estimateImageCost, estimateVideoCost, appendCostLogEntry  │
│  errors.ts      — error class hierarchy                                     │
│  logger.ts      — stderr-only JSON structured logger                        │
│  sanitize.ts    — 15 secret-key regex patterns; redacts before serialization│
│  zod-formatter.ts — prettyZodError, treeZodError                            │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  src/output/ + src/trace/                                                   │
│  output-manager.ts  — createJob, nextVersion, saveAsset/Metadata/Payload,  │
│                         writeSummary, markFinal, appendCostLog              │
│  trace-writer.ts    — atomic JSONL append with Zod-validated schema         │
│  lineage.ts         — read and sort attempt history by attempt index        │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  .media-forge/ (runtime output workspace — gitignored)                      │
│  jobs/<job_id>/  spec.json  trace.jsonl  lineage.json                      │
│                  v1/ … vN/  output.png|mp4  payload.json  verdict.json      │
│  cost-log.jsonl  (project-level cost aggregation)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Request Data Flow

```
User invokes skill or CLI command
           │
           ▼
Skill body reads $ARGUMENTS → spawns media-forge:prompt-engineer (Agent)
           │
           ▼
prompt-engineer → refined_spec.json
  { domain, style, params, required_text, enterprise_mode, ... }
           │
           ▼
Skill router (deterministic) reads refined_spec.domain → picks domain agent
           │
           ▼
Domain agent → calls MCP tools (media_generate_image / media_generate_video_t2v / ...)
           │
           ▼
MCP handler
  → Zod schema parse (runtime validation)
  → capabilities.ts cross-validators
  → cost guard check (Tier 0-3)
  → if dry_run: return payload + estimate (NO API call)
  → if real: call src/image/ or src/video/ service
           │
           ▼
Service layer
  → @google/genai client (Gemini API or Vertex AI)
  → output-manager: saveAsset, saveMetadata, savePayload (sanitized)
  → trace-writer: appendTrace (JSONL entry)
           │
           ▼
quality-reviewer agent (read-only, Opus)
  Stage 1: OCR text validation (if required_text declared)
  Stage 2: Brand compliance (if enterprise_mode: true)
  Stage 3: LLM-as-judge (4-dimension scoring, threshold 7.5)
           │
           ├── verdict = "pass"   → return asset(s) + lineage to user
           │
           └── verdict = "fail" and attempt_count < 3
                   │
                   ▼
               router.ts maps error class → fix_target_agent
               Re-spawn fix_target_agent with fix_directive
               Increment attempt_count; append to lineage
               Loop back to quality-reviewer
                   │
                   ▼
               attempt_count >= 3 or same root_cause twice in a row
               → Escalate to user with full lineage + all attempt verdicts
```

---

## 3. Layer Responsibilities

### `src/core/`

Foundation layer. No business logic — only primitives used by all other layers.

- `client.ts`: wraps `@google/genai` SDK; provides `generateContent` (Nano Banana Pro) and `generateImages` (Imagen 4 Ultra) and Veo video generation; supports dry-run proxy that returns the assembled payload without an API call; handles Gemini API vs Vertex AI mode via config flag.
- `config.ts`: reads `GOOGLE_API_KEY` (or `GEMINI_API_KEY`), `ANTHROPIC_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `~/.media-forge/config.json`; returns a frozen config object; never mutates after construction.
- `models.ts`: exports the three model ID string constants + enum casings for aspect ratios, image sizes, thinking levels, person-generation modes, video resolutions, and video duration options.
- `capabilities.ts`: exports cross-validators per model (e.g., Veo 4K requires duration 8s, extension hops force 720p, EU/UK/CH/MENA region coerces `person_generation`). Throws `CapabilityError` or `ApiFieldError` on violations.
- `cost.ts`: `estimateImageCost` and `estimateVideoCost` return `{ usd, breakdown }`. `appendCostLogEntry` writes to `.media-forge/cost-log.jsonl`.
- `errors.ts`: error class hierarchy (see §6).
- `sanitize.ts`: redacts 15 secret-key patterns (API keys, tokens, credentials) from any object before serialization to `payload.json` or trace files.
- `db.ts` + `cost-tracker.ts`: SQLite-backed (Node built-in `node:sqlite`) video-job + cost ledger; schema in `migrations/sqlite/`.
- `pricing.ts`: `normalizeCostUSD` cross-unit helper (`per-second`, `usd-per-credit`, …) + `loadPricingOverridesFromEnv`.
- `provider-request-map.ts` + `soul-id-cache.ts`: provider `request_id` ↔ `jobId` reconciliation, and Higgsfield Soul ID lifecycle cache.
- `feature-flags.ts`: runtime flags such as `isSeedanceEnabled()`.

### `src/image/`

Image generation and editing. Each file maps to one service function:

- `nano-banana-pro.ts`: `generateImageNanoBananaPro` — calls `generateContent` with image-generation modality; handles reference images as inline data parts.
- `imagen-4-ultra.ts`: `generateImageImagen4Ultra` — calls `generateImages`; logs a warning if `imageSize` is non-default (DEBT-006: SDK lacks `imageSize` in `GenerateImagesConfig`).
- `edit-image.ts`: `editImage` — semantic edits using Nano Banana Pro's multimodal input.
- `compose-scene.ts`: `composeScene` — multi-image composition; lazy `sharp` preprocessing for background removal hint.
- `describe-image.ts`: `describeImage` — Gemini vision description.
- `extract-palette.ts`: `extractPalette` — `node-vibrant` extraction; no API call.
- `safety-rephrase.ts`: strategies for rephrasing prompts that trigger safety blocks.

### `src/video/`

Veo 3.1 Pro generation and lifecycle management:

- `veo-t2v.ts`, `veo-i2v.ts`, `veo-interpolate.ts`, `veo-with-refs.ts`: generation entry points; all return an operation name for async polling.
- `veo-extend.ts`: extension hop (+7s, internal 720p, max 20 hops); takes `sourceVideoUri`, `originalPrompt`, `extensionDirective`, `hopIndex`.
- `polling.ts`: 15-minute cap, configurable interval, abortable via `AbortSignal`.
- `download.ts`: fetches video from resolved HTTPS/GCS URI; computes SHA-256; records 2-day TTL warning.

### `src/video/providers/` — multi-provider abstraction (P13–P16)

Unified `VideoProvider` interface so the router targets any backend:

- `base.ts`: `VideoProvider` interface + `DownloadedAsset` + typed `ProviderExtras` discriminated union (Higgsfield/Kling/Seedance arms).
- `google-veo.ts`: Veo adapter wrapping the `src/video/` entry points above.
- `higgsfield.ts` (+ `higgsfield-webhook-handler.ts`, `auth/higgsfield-headers.ts`): full Higgsfield surface (Soul / Soul ID / DoP / Cinema Studio / Speak / Marketing Studio / Recast / Virality).
- `kling.ts` (+ `kling-elements.ts`, `kling-webhook-handler.ts`, `auth/kling-jwt.ts`): Kling 3.0 modes; hand-rolled HS256 JWT auth (no new deps).
- `bytedance-seedance.ts` (+ `byteplus-ark.ts`, `bytedance-webhook-handler.ts`, `auth/fal-key.ts`, `auth/fal-ed25519.ts`): Seedance 2.0 via fal.ai primary + BytePlus ARK fallback; feature-flagged.
- `webhook-router.ts`: HMAC + replay-protection + origin-guard + body-cap + rate-limit; binds 127.0.0.1 by default; maps provider task IDs → internal `jobId`.

### `src/refs/` — reference library (refs-integration)

> Requires operator-provisioned infra: a MinIO bucket, a pgvector-enabled Postgres instance, and (optionally) an AWS Bedrock endpoint for the Marengo backend. These are not bundled — the refs tools are inert until configured.

- `indexer.ts`, `marengo-embed.ts`, `audit-gallery.ts`, `index.ts`: MinIO-backed curated reference library; pgvector semantic search (Voyage Multimodal-3) with Marengo 3.0 (AWS Bedrock) alt backend; Nano Banana Pro moodboard fusion bridge.

### `src/review/`

3-stage quality review pipeline:

- `ocr-validator.ts`: `OcrValidator.validateText` — Cloud Vision (default) or paddleocr-wasm stub (DEBT-007); fuzzy match ≤2 edits.
- `brand-checker.ts`: `checkBrand` — CIEDE2000 palette comparison, Cloud Vision logo detection (optional), font keyword scan.
- `llm-judge.ts`: `judgeAsset` — **hybrid runtime**: inside Claude Code, emits a subagent directive (no direct SDK call needed); outside Claude Code, calls `@anthropic-ai/sdk` directly with `claude-opus-4-7` and attaches the image as a vision block. Returns `JudgeVerdict` with 4 dimension scores.
- `router.ts`: maps 10 error classes to `fix_target_agent` + `fix_directive`; computes `estimateRetryBudget`.
- `reviewer.ts`: 3-stage orchestrator; reads `ReviewOpts`; runs stages 1–3; persists `verdict.json`; appends trace + lineage.

### `src/mcp/`

MCP server and tool registration:

- `server.ts`: creates an `McpServer` with stdio transport; logs only to stderr; calls `registerAllTools`.
- `handlers.ts`: registers all 54 tools via `looseRegister` (a typed escape hatch to avoid SDK generic coupling); every handler is wrapped in `wrap()` which catches all exceptions and returns `{isError: true}`. Seedance tools are skipped when `MEDIA_FORGE_SEEDANCE_ENABLED` is disabled (→ 50 tools).
- `schemas.ts`: the `MCP_TOOLS` registry (54 tools) + Zod schemas; also re-exports image and video schemas for use by other layers.

### `src/cli/`

Commander-based CLI, entry point at `src/cli/cli.ts`:

- `CliExit extends Error` is thrown instead of `process.exit()` so Vitest can intercept exits in tests. The top-level `runCli` catches it and calls `process.exit`.
- Each subcommand group (`image.ts`, `video.ts`, `cost.ts`, `audit.ts`, `prompts.ts`, `models.ts`, `config.ts`, `doctor.ts`) is registered as a subcommand of the root program.
- `--dry-run` and `--json` flags are available on all generation commands.

### `src/output/` + `src/trace/`

Persistence layer:

- `output-manager.ts`: `createJob` generates a monotonically-named job directory under `.media-forge/jobs/`; `nextVersion` handles EEXIST retry; `saveAsset/Metadata/Payload/Prompt` write to the versioned directory; `markFinal` cross-platform-copies the final asset; `appendCostLog` writes to `cost-log.jsonl`.
- `trace-writer.ts`: appends one JSONL entry atomically; validated against a Zod trace-entry schema before write.
- `lineage.ts`: reads and sorts attempt history by attempt index for the reviewer and audit commands.

### `src/prompts/`

Template engine:

- `template-loader.ts`: YAML parse + Zod validation + index builder (`writeIndex`); `tryTemplate` resolves a template from the `_index.json`; `searchTemplates` filters by domain.
- `template-renderer.ts`: `${var}` interpolation with strict mode (throws on missing required variables); returns the rendered prompt string.

---

## 4. Hybrid LLM Judge Runtime

The `quality-reviewer` agent uses Claude Opus (`claude-opus-4-7`) as judge. Two execution paths exist:

**Path A — Inside Claude Code (plugin/subagent context):**
`llm-judge.ts` detects that it is running inside a Claude Code subagent context and emits a structured directive that the parent orchestrator can relay to a `quality-reviewer` Agent dispatch. No `@anthropic-ai/sdk` HTTP call is made. This avoids redundant API charges when the orchestrator already has an Anthropic session.

**Path B — Outside Claude Code (standalone MCP server or CLI):**
`llm-judge.ts` calls `@anthropic-ai/sdk` directly, constructing a `messages.create` request with `claude-opus-4-7`, attaching the asset as a base64-encoded image vision block, and structured JSON output. `ANTHROPIC_API_KEY` must be set for this path. Falls back to a conservative "pass with warning" if the key is absent and `strict` mode is off.

---

## 5. Cross-Platform Considerations

### Windows path encoding (U+F03A — RESOLVED in P10)

Claude Code on Windows Git Bash was encoding colons in directory names as U+F03A (private use area), corrupting paths like `skills/media-forge:create/`. Resolution: all skill and agent directories were renamed to short names without the `media-forge:` prefix (e.g., `skills/create/`, `agents/cinematic-director.md`). The plugin loader constructs the fully-qualified name `media-forge:<name>` at runtime from the plugin manifest.

### ESM `.js` import suffix

The package uses `"type": "module"` and TypeScript `NodeNext` module resolution. All internal imports must use `.js` extensions (e.g., `import { foo } from './foo.js'`) even though the source files are `.ts`. tsup handles this correctly in the build output.

### Path utilities

`src/utils/paths.ts` exports `safeJoin` (prevents directory traversal), `slug` (safe filename component), and `jobId` (timestamp-based monotonic ID). All service files use `safeJoin` instead of `path.join` for output paths to prevent path injection.

---

## 6. Error Class Hierarchy

```
Error (built-in)
└── MediaForgeError (base; adds: code: ErrorCode, context: Record)
    ├── ConfigError          (code: 'CONFIG')
    ├── ValidationError      (code: 'VALIDATION')
    ├── CapabilityError      (code: 'CAPABILITY')
    │   └── ApiFieldError    (adds: field: string)
    ├── ApiError             (code: 'API' | 'RATE_LIMIT' | 'AUTH')
    ├── PollingError         (code: 'POLLING')
    ├── OutputError          (code: 'OUTPUT')
    ├── FileSystemError      (code: 'FILESYSTEM')
    └── SafetyBlockError     (code: 'SAFETY_BLOCK'; adds: SafetyBlockContext)
```

All MCP tool handlers catch `Error` broadly via `wrap()` and return `{isError: true, content: [{type:'text', text: err.message}]}`. The error type is preserved in the `text` field via `${err.name}: ${err.message}`.

---

## 7. Plugin Hooks

`hooks/hooks.json` defines plugin-level hooks (subagent-level `hooks` fields are silently ignored by Claude Code):

- `SubagentStart`: injects a chain-of-trace header into every subagent invocation, recording `job_id`, `stage`, `model`, and timestamp into `.media-forge/jobs/<job_id>/trace.jsonl`.
- `SessionEnd`: cleans up any orphaned temporary files in `.media-forge/tmp/` that were not finalized before the session ended.

Shell scripts in `hooks/` have both `.sh` (Unix/macOS/Linux) and `.cmd` (Windows) variants. The Git Bash colon-encoding issue (U+F03A) was fixed in P10 by removing colons from all hook script names.

---

## 8. Build Pipeline

Three tsup entry points (defined in `tsup.config.ts`):

| Entry | Output | Purpose |
|---|---|---|
| `src/index.ts` | `dist/index.js` | Plugin/library API surface |
| `src/mcp/server.ts` | `dist/mcp/server.js` | MCP server standalone binary |
| `src/cli/cli.ts` | `dist/cli/cli.js` | CLI binary target |

`pnpm build` runs `pnpm build:prompts` first (generates `prompts/_index.json`), then tsup. `pnpm dev:claude` runs a one-shot build then launches `claude --plugin-dir .` for local plugin testing.
