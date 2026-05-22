---
name: character-sheet
description: "Character consistency: identity-lock portrait + turnaround + expression sheet from one reference. Triggers: character sheet, turnaround, consistency."
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:character-sheet

Character consistency workflow. Produces a complete character sheet (identity-locked hero portrait, turnaround grid, expression sheet) from a single reference image or description.

## Workflow

1. Dispatch `media-forge:prompt-engineer` with character brief. Receive `refined_spec.json`.
2. Dispatch `media-forge:character-designer` for hero portrait (front-facing, 4K).
3. Dispatch `media-forge:quality-reviewer` on hero. Gate on pass before turnaround.
4. Dispatch `media-forge:character-designer` for turnaround grid (front / 3/4 left / side / rear) — 4 calls with hero as identity reference.
5. Dispatch `media-forge:character-designer` for expression sheet (neutral / happy / angry / sad / surprised) — 5 calls.
6. Return all asset paths and `character-sheet-manifest.json`.

## When to use

Invoke when user needs a consistent character across multiple angles and expressions for animation, game design, or storyboards.

## Outputs

- Hero portrait (4K)
- Turnaround grid (4 views)
- Expression sheet (5 expressions)
- `character-sheet-manifest.json` with all paths and identity-lock descriptors
