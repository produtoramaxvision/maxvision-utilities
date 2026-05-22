---
description: First-time onboarding: API keys, output dir, smoke test
argument-hint: ""
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:setup

Onboarding wizard. Run this once after installing media-forge to configure your API key, output directory, and verify the installation.

## Instructions

1. Invoke the `media-forge:setup` skill with no arguments.
2. Guide the user through each configuration step interactively.
3. After configuration, display the doctor check results.
4. On success, suggest the first generation command as an example.
5. On failure, display the specific error and a troubleshooting tip.
