---
name: media-forge:setup
description: Onboarding wizard: env detection, API key prompts, output dir setup, first dry-run smoke. Run on first install.
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:setup

First-time onboarding wizard. Detects environment, prompts for missing API keys, configures output directories, and runs a dry-run smoke test.

## Workflow

1. Run `media-forge config get apiKey`. If key is present, skip to step 4.
2. Prompt user for Google AI API key (never echo back in full — show only last 4 chars).
3. Write key to `~/.media-forge/config.json` via `media-forge config set apiKey <value>`.
4. Prompt user for output directory (default: `./outputs`). Write to config.
5. Run `media-forge doctor --skip-network` to validate installation.
6. If doctor passes: suggest first example: `/media-forge:create a cinematic sunset over mountains`.
7. If doctor fails: show structured error and troubleshooting steps.

## When to use

Run once after installing the media-forge plugin, or any time configuration is lost or needs reset.

## Outputs

- Configuration status report
- Doctor check results
- First example command suggestion
