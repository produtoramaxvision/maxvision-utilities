---
description: "First-time onboarding: API keys, output dir, webhook secret, smoke test"
argument-hint: ""
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:setup

Onboarding wizard. Run this once after installing media-forge to configure your API key, output directory, webhook router secret (optional for P13, required for P14+), and verify the installation.

## Instructions

1. Invoke the `media-forge:setup` skill with no arguments.
2. Guide the user through each configuration step interactively.
3. Webhook router setup (provider abstraction P13+):
   - Ask the user whether they plan to use non-Veo providers (Higgsfield, Kling, Seedance — P14+). If yes, walk them through generating a webhook secret and setting `MEDIA_FORGE_WEBHOOK_SECRET` + (optionally) `MEDIA_FORGE_WEBHOOK_PORT`.
   - Default port: `7733` (bind 127.0.0.1 only). Override with `MEDIA_FORGE_WEBHOOK_PORT`.
   - Generate a 32-byte hex secret with one of:
     - `openssl rand -hex 32`
     - `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
   - **Graceful degradation**: if `MEDIA_FORGE_WEBHOOK_SECRET` is unset, the router stays disabled and the `media_video_webhook_status` MCP tool reports `running: false`. P13 (Veo only) works fine without it — Veo polls GCS for completion. P14+ providers will fall back to polling when callbacks are unavailable.
   - **Never echo the generated secret back in full** — only show the last 4 chars when confirming the value was stored.
4. After configuration, display the doctor check results.
5. On success, suggest the first generation command as an example.
6. On failure, display the specific error and a troubleshooting tip.
