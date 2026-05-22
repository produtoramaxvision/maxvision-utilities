# media-forge

Production-grade Claude Code plugin for image and video generation using top-tier Google AI models:

- **Nano Banana Pro** (`gemini-3-pro-image-preview`) — premium image generation, up to 4K
- **Imagen 4 Ultra** (`imagen-4.0-ultra-generate-001`) — when `seed` / `negativePrompt` / multi-image batches needed
- **Veo 3.1 Pro** (`veo-3.1-generate-preview`) — premium video generation, up to 4K

## Architecture (v0.1.0)

- 10 domain-specialized subagents + smart-routing quality reviewer (Opus)
- MCP server (22 tools) + Claude Code skills/commands + CLI (3 surfaces)
- 30 curated prompt templates across 10 domains
- Cost-guarded with daily cap, retry-budget visibility, and dry-run default

## Status: v0.1.0 (in development)

Full documentation arrives in P13 of the implementation plan.

See `.maxvision/plans/2026-05-21-media-forge-plan/PLAN.md` for the full execution plan.
