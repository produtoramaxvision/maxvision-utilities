---
description: Show media-forge command catalog + quick start
argument-hint: ""
allowed-tools: Read, Write, Bash, Grep, Glob
---

# media-forge — Command Catalog

Display the full list of available `/media-forge:*` commands and quick-start instructions.

## Instructions

Print the following help text to the user exactly as formatted:

---

## media-forge Plugin — Command Reference

### Quick Start

1. Run `/media-forge:setup` once to configure your API key and output directory.
2. Set environment variable: `GOOGLE_AI_API_KEY=your-key`
3. Optional dry-run mode: `MEDIA_FORGE_DRY_RUN=true`

### Commands

| Command | Args | Description |
|---------|------|-------------|
| `/media-forge:setup` | — | First-time onboarding: API keys, output dir, smoke test |
| `/media-forge:create` | `<brief>` | Generate image/video from a brief — end-to-end with quality review |
| `/media-forge:campaign` | `<brief>` | Multi-asset campaign: hero + variations + sizes |
| `/media-forge:character` | `<name> <description>` | Full character sheet: portrait + turnaround + expressions |
| `/media-forge:cinematic` | `<brief>` | Cinematic short: storyboard → frames → video chain |
| `/media-forge:extend` | `<jobId\|videoPath> <directive>` | Extend existing video via Veo 3.1 +7s hops |
| `/media-forge:audit` | `<jobId>` | Audit job lineage: trace, verdicts, cost |
| `/media-forge:cost` | `<brief>` | Estimate cost before generating (retry-aware) |
| `/media-forge:models` | — | List the 3 LOCKED model IDs with capabilities |

### Models (LOCKED — never substitute)

- `gemini-3-pro-image-preview` — Nano Banana Pro (images, up to 14 refs, 4K)
- `imagen-4.0-ultra-generate-001` — Imagen 4 Ultra (seed-reproducible images)
- `veo-3.1-generate-preview` — Veo 3.1 Pro (video, extension chains)

---
