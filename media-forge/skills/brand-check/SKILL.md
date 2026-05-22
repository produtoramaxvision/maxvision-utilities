---
name: brand-check
description: "INTERNAL - brand compliance check (color deltaE2000 + logo + font). Used by enterprise-corrector and quality-reviewer."
allowed-tools: Read, Bash, Grep, Glob
preamble-tier: 1
user-invocable: false
---

# media-forge:brand-check

INTERNAL skill. Performs brand compliance checks on a generated asset: palette ΔE2000, logo presence/position, and font keyword scan. Called by `enterprise-corrector` and `quality-reviewer`.

## Workflow

1. Receive image path and `brand-guidelines.yml` path from caller context.
2. Palette check: use node-vibrant to extract dominant colors from the image. Compute ΔE2000 against each brand palette color. Flag any color where ΔE2000 > 5.
3. Logo check: if guidelines specify logo requirement, use pixel-pattern scan to detect logo region. Validate position against allowed zones.
4. Font check: if guidelines specify disallowed fonts, scan OCR text output for font name keywords.
5. Return structured result: `{ "pass": boolean, "violations": [] }`.

## When to use

Called internally by `enterprise-corrector` during correction pass and by `quality-reviewer` in Stage 2 of the review pipeline. Not for direct user invocation.

## Outputs

- `pass`: boolean — true if all brand checks pass
- `violations`: list of `{ check, field, value, expected, fix }` for each failure
- Error classes on failure: `BRAND_COLOR`, `BRAND_LOGO`, `BRAND_FONT`
- ΔE2000 scores per color pair
