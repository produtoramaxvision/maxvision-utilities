---
name: media-forge:ocr-validate
description: INTERNAL - OCR text validation via Cloud Vision. Used by quality-reviewer.
allowed-tools: Read, Bash, Grep, Glob
preamble-tier: 1
user-invocable: false
---

# media-forge:ocr-validate

INTERNAL skill. Validates rendered text accuracy in a generated image using Google Cloud Vision OCR. Called exclusively by `media-forge:quality-reviewer`.

## Workflow

1. Receive image path and `expected_text` from caller context.
2. Call Cloud Vision API `annotateImage` with `TEXT_DETECTION` feature on the image.
3. Extract all detected text blocks from the response.
4. Compare detected text against `expected_text` using normalized string comparison (trim, lowercase, collapse whitespace).
5. Return structured result: `{ "pass": boolean, "detected_text": string, "expected_text": string, "mismatch_details": [] }`.

## When to use

Called internally by `quality-reviewer` in Stage 1 of the 3-stage review pipeline. Not for direct user invocation.

## Outputs

- `pass`: boolean — true if all expected text was detected accurately
- `detected_text`: full text extracted by OCR
- `mismatch_details`: list of `{ expected, detected, position }` for each discrepancy
- Error class on failure: `OCR_MISMATCH`
