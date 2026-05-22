---
name: media-forge:campaign
description: "Multi-asset campaign: generates a coordinated set (hero + variations + sizes). Triggers: campaign, ad campaign, multi-asset, batch."
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:campaign

Multi-asset campaign workflow. Generates a coordinated set of assets from a single brief: hero image, format variations, and size adaptations.

## Workflow

1. Dispatch `media-forge:prompt-engineer` with campaign brief. Receive `refined_spec.json`.
2. Generate hero asset via the appropriate domain agent.
3. Dispatch `media-forge:quality-reviewer` on hero. Gate on pass (≥7.5) before proceeding.
4. For each campaign size/format in spec: adapt aspect ratio and dispatch domain agent (reuse hero prompt base).
5. Collect all asset paths into a campaign manifest JSON.
6. Return campaign manifest with cost summary and quality verdicts.

## When to use

Invoke when user needs multiple coordinated assets from one brief: ad campaigns, social media sets, or multi-format launches.

## Outputs

- Hero asset path
- All variation asset paths keyed by size/format
- Campaign manifest JSON (`campaign-manifest.json`)
- Aggregate cost in USD
