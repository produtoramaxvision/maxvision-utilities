# media-forge

Production-grade Claude Code plugin for image and video generation using Google's top-tier generative AI models exclusively.

![version](https://img.shields.io/badge/version-0.1.1-blue)
![node](https://img.shields.io/badge/node-%3E%3D20-green)
![license](https://img.shields.io/badge/license-MIT-green)

---

## Top-Tier Model Lock (LOCKED — not configurable)

media-forge exposes **only** the three highest-tier Google AI models available as of v0.1.1. No mid-tier or budget alternatives are offered.

| Model ID | Role | Default resolution |
|---|---|---|
| `gemini-3-pro-image-preview` | Image generation, editing, composition, description | 4K |
| `imagen-4.0-ultra-generate-001` | Image generation with seed / negative-prompt / multi-image batches | 2K |
| `veo-3.1-generate-preview` | Video generation (text-to-video, image-to-video, interpolation, extension) | 720p (1080p/4K available with `durationSeconds=8`) |

Cost guards (dry-run default, warning above $0.50, hard block above $2.00, daily cap at $25) mitigate budget exposure from this quality-first policy.

---

## Quick Start

### Install path A — Claude Code plugin (recommended)

```bash
# From the plugin directory
claude plugin install ./media-forge

# Or from npm (once published)
claude plugin install @produtoramaxvision/media-forge
```

After installation, all 14 agents, 40 skills, and 10 slash commands become available inside your Claude Code session.

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
| `GOOGLE_API_KEY` | Yes (or Vertex AI) | Google Veo image and video generation | [AI Studio](https://aistudio.google.com/app/apikey) |
| `ANTHROPIC_API_KEY` | Optional | Standalone MCP LLM judge (fallback when not inside Claude Code) | [Anthropic Console](https://console.anthropic.com/settings/keys) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | Cloud Vision OCR for text validation in reviewer Stage 1 | [GCP IAM](https://console.cloud.google.com/iam-admin/serviceaccounts) |
| `KLING_API_KEY` | Optional | Kling video generation, **API 2.0 auth (preferred)**. Sent as `Bearer <key>` | [Kling dev console](https://app.klingai.com/global/dev/) |
| `KLING_ACCESS_KEY` + `KLING_SECRET_KEY` | Optional | Kling **legacy** auth. Signs a short-lived JWT. Only consulted when `KLING_API_KEY` is empty | same console |
| `HF_API_KEY` + `HF_API_SECRET` | Optional | Higgsfield generation (Soul, DoP, Speak, Recast) | [Higgsfield platform](https://platform.higgsfield.ai/) |
| `FAL_KEY` | Optional | Seedance 2.0 via fal.ai | [fal.ai keys](https://fal.ai/dashboard/keys) |
| `BYTEPLUS_ARK_API_KEY` | Optional | Seedance 2.0 via BytePlus Ark (alternative route) | BytePlus console |

Each provider is optional and independent: the plugin only registers the models
whose credentials are present. Setting none of the optional keys leaves a
working Google-only install.

**Kling auth precedence is not a fallback chain.** When `KLING_API_KEY` is set it
wins outright and no JWT is ever signed, even if the access/secret pair is also
present ([`kling-jwt.ts:93`](src/video/providers/auth/kling-jwt.ts)). Set one
scheme or the other, not both, or the one you think is active may not be.

Alternative to `GOOGLE_API_KEY`: set `GOOGLE_GENAI_USE_VERTEXAI=true` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` for Vertex AI mode.

Set keys in one of three ways:

1. Shell environment: `export GOOGLE_API_KEY=AIza...`
2. Config file: `media-forge config set apiKey=AIza...` (writes `~/.media-forge/config.json`)
3. `.mcp.json` env interpolation: `"GOOGLE_API_KEY": "${GOOGLE_API_KEY}"`

> SynthID watermarks are applied by Google to all generated outputs. This cannot be disabled and is not controlled by the plugin.

---

## Higgsfield remote MCP — manual probe, not a production path

Higgsfield publishes its own remote MCP server. media-forge **deliberately does
not ship it** in `.mcp.json`, and that omission is the design, not an oversight.

The reason is governance. Everything media-forge routes through its own
Higgsfield provider is metered: it is priced before submit, reserved against the
credit ledger, captured on completion and swept if abandoned. A second, direct
MCP surface to the same account bypasses all of it. Generations would land on
your Higgsfield bill with no corresponding row in the local ledger, so the daily
cap and the block threshold would both be computing against an incomplete
picture of what you actually spent.

Add it only as a temporary probe — to inspect Higgsfield's own parameter surface
or confirm an account state — and remove it afterwards:

```jsonc
{
  "mcpServers": {
    "higgsfield": {
      "type": "http",
      "url": "https://mcp.higgsfield.ai/mcp"
    }
  }
}
```

Authentication is OAuth in the client; there is no secret to place in the config.

**Plan credits do not carry over.** Unlimited and free-tier generations included
with a Higgsfield subscription apply to the web app. Work dispatched through the
API or the remote MCP is billed against your credit balance at standard rates.
Budget for API work as a separate line from the subscription.

<sub>Source: footnote on higgsfield.ai/pricing, read 2026-07-29. Verify before
relying on it for a budget — provider pricing terms change without notice.</sub>

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

The MCP image tools (`media_generate_image`, `media_generate_imagen`, `media_edit_image`) and the five Kling video submit tools (`media_kling_motion_brush`, `media_kling_elements`, `media_kling_lip_sync`, `media_kling_omni_multishot`, `media_kling_video_extend`) are gated by a three-tier guard, evaluated against a real per-tenant SQLite ledger before every call:

| Tier | Threshold | Behavior |
|---|---|---|
| Warn | above $0.50 per call | Non-blocking — the call proceeds, and a `costWarning` string is returned in the tool's `structuredContent` |
| Block | above $2.00 per call | Hard block — the call is refused before the provider is ever invoked |
| Daily cap | $25/day (configurable), UTC calendar day | Hard block once today's recorded spend + this call's estimate would exceed the cap |

The daily cap counts **both image and video generations** for the current UTC day, and counts **pending (not-yet-settled) jobs at their estimated cost** — a job that is submitted but never completes still counts against the cap, so an unbounded number of in-flight generations cannot slip past it. There is no `--override-daily-cap` flag; raise `MEDIA_FORGE_DAILY_CAP_USD` (or the sibling `MEDIA_FORGE_CONFIRM_THRESHOLD_USD` / `MEDIA_FORGE_BLOCK_THRESHOLD_USD`) instead.

The Veo (`media_generate_video_*`), Higgsfield, and Seedance MCP tools, and all CLI generation commands, are **not** currently wired to this guard — their billing is separately deferred (see the `TODO(F-E ...-billing): DEFERRED` comments in `src/mcp/handlers/register.ts`).

The `--dry-run` flag returns the assembled payload and cost estimate without calling any API, and is exempt from the guard and the ledger (a dry run never reaches the provider and costs $0).

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
- [Roadmap](docs/roadmap.md) — v0.1.1 scope, v0.2.0 candidates, known debts
- [Usage](docs/usage.md) — cookbook: core MCP tools + CLI subcommands + 5 real-world recipes (54-tool registry summary)
- [Troubleshooting](docs/troubleshooting.md) — failure mode table and resolution steps
- [Contributing](CONTRIBUTING.md) — add new agents, prompt templates, or MCP tools
- [Dev Loop](docs/devloop.md) — hot-reload workflow for development

---

## Legal Note on Seedance 2.0

media-forge v0.1.1 integrates ByteDance **Seedance 2.0** as one of four
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
  (`MCP_TOOLS` drops from 54 to 50).
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
