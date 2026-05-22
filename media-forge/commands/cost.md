---
description: "Estimate cost of a planned generation (retry-aware)"
argument-hint: "<brief>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:cost

Cost estimation. Takes a brief and estimates the generation cost before any paid API calls, accounting for likely retries based on complexity.

## Instructions

1. Take the brief from $ARGUMENTS.
2. Dispatch `media-forge:prompt-engineer` in dry-run mode to classify domain and model without generating.
3. Read the capability matrix (`media-forge:capability-matrix`) for the classified model's pricing.
4. Calculate base cost: model price x number of assets x expected resolution.
5. Apply retry multiplier: simple prompts = 1.0x, complex/multi-asset = 1.3x, character sheets = 1.5x.
6. Display itemized cost estimate:
   - Domain and model selected
   - Number of API calls planned
   - Base cost
   - Estimated cost with retries
   - Recommendation to run with `MEDIA_FORGE_DRY_RUN=true` first
