# media-forge

Production-grade Claude Code plugin for image and video generation using Google's top-tier generative AI models exclusively.

![version](https://img.shields.io/badge/version-0.1.0-blue)
![node](https://img.shields.io/badge/node-%3E%3D20-green)
![license](https://img.shields.io/badge/license-MIT-green)

---

## Top-Tier Model Lock (LOCKED — not configurable)

media-forge exposes **only** the three highest-tier Google AI models available as of v0.1.0. No mid-tier or budget alternatives are offered.

| Model ID | Role | Default resolution |
|---|---|---|
| `gemini-3-pro-image-preview` | Image generation, editing, composition, description | 4K |
| `imagen-4.0-ultra-generate-001` | Image generation with seed / negative-prompt / multi-image batches | 2K |
| `veo-3.1-generate-preview` | Video generation (text-to-video, image-to-video, interpolation, extension) | 720p (1080p/4K available with `durationSeconds=8`) |

Cost guards (dry-run default, confirmation prompt above $0.50, hard block above $2.00, daily cap at $25) mitigate budget exposure from this quality-first policy.

---

## Quick Start

### Install path A — Claude Code plugin (recommended)

```bash
# From the plugin directory
claude plugin install ./media-forge

# Or from npm (once published)
claude plugin install @produtoramaxvision/media-forge
```

After installation, all 14 agents, 14 skills, and 10 slash commands become available inside your Claude Code session.

### Install path B — MCP standalone (any MCP-compatible client)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "media-forge": {
      "command": "node",
      "args": ["/path/to/media-forge/dist/mcp/server.js"],
      "env": {
        "GOOGLE_API_KEY": "${GOOGLE_API_KEY}"
      }
    }
  }
}
```

Then start the server manually with `pnpm mcp:start` or let your client manage the lifecycle.

### Install path C — CLI (power users)

```bash
# Install globally
npm install -g @produtoramaxvision/media-forge

# Or use directly from the repo
pnpm install
pnpm build
node bin/media-forge doctor
```

---

## Required API Keys

| Variable | Required | Purpose | Where to get it |
|---|---|---|---|
| `GOOGLE_API_KEY` | Yes (or Vertex AI) | All image and video generation | [AI Studio](https://aistudio.google.com/app/apikey) |
| `ANTHROPIC_API_KEY` | Optional | Standalone MCP LLM judge (fallback when not inside Claude Code) | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | Cloud Vision OCR for text validation in reviewer Stage 1 | [GCP IAM](https://console.cloud.google.com/iam-admin/serviceaccounts) |

Alternative to `GOOGLE_API_KEY`: set `GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` for Vertex AI mode.

Set keys in one of three ways:

1. Shell environment: `export GOOGLE_API_KEY=AIza...`
2. Config file: `media-forge config set apiKey=AIza...` (writes `~/.media-forge/config.json`)
3. `.mcp.json` env interpolation: `"GOOGLE_API_KEY": "${GOOGLE_API_KEY}"`

> SynthID watermarks are applied by Google to all generated outputs. This cannot be disabled and is not controlled by the plugin.

---

## Feature Matrix

| Capability | Model | Notes |
|---|---|---|
| Text-to-image | Nano Banana Pro | Up to 4K, 10 aspect ratios, up to 14 reference images |
| Text-to-image (Imagen path) | Imagen 4 Ultra | Adds seed, negative prompt, up to 4 images per call |
| Image editing | Nano Banana Pro | Semantic add/remove/replace via natural-language instruction |
| Scene composition | Nano Banana Pro | Multi-image assembly up to 14 references with role labels |
| Image description | Nano Banana Pro | Gemini vision → text description |
| Color palette extraction | (local) | node-vibrant; no API call |
| Text-to-video | Veo 3.1 Pro | 4–8s, 720p default (1080p/4K require 8s), 16:9 or 9:16 |
| Image-to-video | Veo 3.1 Pro | First-frame anchor |
| Frame interpolation | Veo 3.1 Pro | First + last frames → filled video |
| Video with references | Veo 3.1 Pro | Up to 3 asset references |
| Video extension | Veo 3.1 Pro | +7s per hop, up to 20 hops (max ~148s); internal resolution 720p |
| OCR text validation | Cloud Vision / PaddleOCR stub | Reviewer Stage 1; validates required text in output |
| Brand compliance check | node-vibrant + Cloud Vision | CIEDE2000 color delta, logo presence, font keyword scan |
| LLM-as-judge review | Claude Opus (subagent or direct SDK) | 3-stage review with bounded retries (max 3) |
| Chain-of-trace logging | (local) | Per-job trace.jsonl, lineage.json, cost-log.jsonl |
| Dry-run / cost estimate | (local) | Returns assembled payload + USD estimate; no API call |

---

## 5-Minute Walkthrough

### Image dry-run

```bash
# See what would be sent to the API and how much it would cost — no charge
media-forge image generate \
  "professional product photo of a coffee mug on white background, 4K" \
  --aspect-ratio 1:1 \
  --image-size 4K \
  --dry-run \
  --json
```

Expected output: a JSON payload with the full request parameters and a `costEstimate` field showing the USD amount.

### Video dry-run

```bash
media-forge video t2v \
  "a slow-motion espresso shot being poured into a ceramic cup, cinematic, 4K" \
  --duration-seconds 8 \
  --resolution 4k \
  --dry-run \
  --json
```

Expected output: assembled Veo 3.1 Pro payload with resolution, duration, and `costEstimate`.

### Cost log inspection

After any real (non-dry-run) job:

```bash
media-forge audit all --json
```

This reads `.media-forge/cost-log.jsonl` and aggregates per-job and per-day spending. Each job also has a `trace.jsonl` with per-stage timing and cost.

---

## Cost Guard

media-forge applies a four-tier guard to every generation call:

| Tier | Threshold | Behavior |
|---|---|---|
| Silent | < $0.10 per job | Proceed without interruption |
| Notice | $0.10 – $0.50 per job | Log estimated cost to console |
| Confirm | $0.50 – $2.00 per job | Prompt user to confirm before calling the API |
| Block | > $2.00 per job | Hard block; requires `--force` flag |
| Daily cap | $25 / day (configurable) | Blocks all spending past the cap; requires `--override-daily-cap` |

The `--dry-run` flag returns the assembled payload and cost estimate without calling any API. Skills include a "Confirm cost" step for production runs.

---

## Smart-Routing Reviewer (3-Stage)

Every generation result passes through the quality-reviewer agent before being returned to the user. The reviewer is read-only and never modifies assets directly — it classifies root cause and routes back to the appropriate pipeline stage for a fix attempt.

**Stage 1 — OCR text validation:** when the refined spec declares `required_text`, the reviewer runs OCR on the output image and compares to the expected string (fuzzy match, ≤2 edits). Failure routes back to the generator with a stronger text-anchoring directive.

**Stage 2 — Brand compliance:** when `enterprise_mode: true`, the reviewer checks dominant palette (CIEDE2000 ΔE ≤ 5 against brand colors), logo presence, and font keywords. Failure routes to the `enterprise-corrector` agent.

**Stage 3 — LLM-as-judge:** the reviewer scores four dimensions (adherence, composition, domain alignment, safety) on a 0–10 scale, threshold 7.5. Failure routes to either `prompt-engineer` (semantic error) or the original generator (parameter error).

Retry budget: max 3 attempts. On third failure or repeated same root cause, the plugin escalates to the user with full lineage (all attempts + verdicts).

---

## Webhook callbacks (Kling + Higgsfield + Seedance)

The plugin's webhook router (`startWebhookRouter`) verifies every callback with an HMAC SHA-256 over `timestamp + "." + body`, anchored by `MEDIA_FORGE_WEBHOOK_SECRET`. Providers that don't sign requests (Kling, fal.ai-hosted Seedance) cannot satisfy this contract — they would always receive `401` and the callback URL we advertise to them becomes useless.

To prevent silently-orphaned jobs, callback emission is **off by default** for those providers. Each opt-in flag is independent.

### Kling — `MEDIA_FORGE_KLING_WEBHOOK_INSECURE`

| Setting | Default | Behaviour |
|---|---|---|
| unset / `false` | ✅ default | `callback_url` is NOT sent in Kling submit bodies. Use `media_kling_poll` + `media_kling_download` to drive completion manually. The router's `/webhooks/kling/{jobId}` endpoint stays HMAC-protected and would 401 any unsigned hit. |
| `true` | opt-in | Kling submit bodies advertise `${MEDIA_FORGE_WEBHOOK_PUBLIC_URL}/webhooks/kling/{jobId}`. **Operator owns the auth path** — typically used with a stub diagnostic handler in dev only. The HMAC guard still rejects unsigned production callbacks. |

`extras.callbackUrl` (caller-provided per-request) is honored unconditionally regardless of the flag — the caller owns its own auth path.

**Recommended path:** leave the flag unset and rely on `media_kling_poll` / `media_kling_download` for completion. Both tools hydrate the job mapping from `video_jobs.native_task_id` via `KlingProvider.hydrateFromDb()`, so a fresh handler invocation can complete a job submitted by a prior process.

### Higgsfield — `MEDIA_FORGE_HF_WEBHOOK_ENABLE`

P14 ships polling-only. Setting this flag advertises a Higgsfield callback URL; a minimal logging-stub handler is registered when `MEDIA_FORGE_WEBHOOK_SECRET` is set so the URL does not 404, but full cost reconciliation is deferred to P14.1.

### Seedance — `MEDIA_FORGE_SEEDANCE_WEBHOOK_INSECURE`

Same shape as the Kling flag. Off by default; opt-in only for dev. fal.ai cannot sign the HMAC.

---

## Documentation

- [Specification](docs/specification.md) — model lock policy, capability matrix, tool registry, agent and skill registry
- [Architecture](docs/architecture.md) — system diagram, data flow, layer responsibilities, error hierarchy
- [Roadmap](docs/roadmap.md) — v0.1.0 scope, v0.2.0 candidates, known debts
- [Usage](docs/usage.md) — cookbook: core MCP tools + CLI subcommands + 5 real-world recipes (54-tool registry summary)
- [Troubleshooting](docs/troubleshooting.md) — failure mode table and resolution steps
- [Contributing](CONTRIBUTING.md) — add new agents, prompt templates, or MCP tools
- [Dev Loop](docs/devloop.md) — hot-reload workflow for development

---

## Legal Note on Seedance 2.0

media-forge v0.5.0+ integrates ByteDance **Seedance 2.0** as one of four
first-class video providers (alongside Google Veo 3.1, Higgsfield, and Kling
3.0). Seedance 2.0 is the subject of active cease-and-desist / IP litigation
from **Disney + Paramount** over training-data sourcing as of 2026-05-27.
This litigation is ongoing; the legal status of generated assets may vary
by jurisdiction and intended use.

**No runtime IP gating.** media-forge ships zero brand-detection, prompt-
filtering, or output-watermarking enforcement around Seedance 2.0. The
operator (person or organization running media-forge) assumes **full
responsibility for compliance with applicable IP law** in their jurisdiction
and for the intended use of generated assets. This is a deliberate design
decision recorded against operator-control principles — neither this plugin
nor its maintainers warrant the legal status of Seedance 2.0 outputs.

**Emergency removal.** If your jurisdiction issues an injunction, you can
disable all Seedance tools and provider routing with a single env-var flip:

```bash
export MEDIA_FORGE_SEEDANCE_ENABLED=false
```

When this flag is set to `false` (or `0`, `no`, `off` — case-insensitive):

- All 4 Seedance MCP tools (`media_seedance_text_to_video`,
  `media_seedance_image_to_video`, `media_seedance_multishot`,
  `media_seedance_reference_fusion`) are skipped from tool registration
  (`MCP_TOOLS` drops from 49 to 45).
- `bytedance` is removed from `ADAPTED_PROVIDERS`, so the video-router
  cannot select a Seedance model even if its cost or capability heuristic
  would otherwise prefer one.
- All four other providers (Veo 3.1, Higgsfield, Kling 3.0) continue
  unaffected.

Default value is `true` (Seedance enabled). The flag is checked at MCP server
startup and is not hot-reloaded — restart the server after flipping it.

**Operator-side mitigations to consider (not enforced by media-forge):**

- Brand-keyword pre-filter on prompts before invoking any Seedance tool
- Manual review queue for high-risk content categories
- C2PA / output watermarking via post-processing pipeline (out of scope here)
- Per-jurisdiction routing logic at the operator's orchestration layer

This Legal Note exists so future operators can locate the emergency-removal
mechanism without source-diving and so the IP context is preserved alongside
the integration's documentation.
