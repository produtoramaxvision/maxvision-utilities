# Media Forge — Pending Technical Debts

## DEBT-006: Imagen 4 Ultra imageSize SDK drop

**Date:** 2026-05-22
**Phase:** P5.3
**File:** `src/image/imagen-4-ultra.ts`

**Description:** The `GenerateImagesConfig` type from `@google/genai` 2.6.0 does NOT include
an `imageSize` field. The `Imagen4UltraInput` schema (P3.1) accepts `imageSize: '1K'|'2K'`
because end users configure it via input, but the value is silently dropped when calling
`client.ai.models.generateImages()`. A `logger.warn` fires when a non-default imageSize is
requested (anything other than `'2K'`).

**Resolution path:** When the SDK adds `imageSize` to `GenerateImagesConfig`, wire
`input.imageSize` directly into the config object and remove the warn.

**Impact:** Low — Imagen 4 Ultra currently defaults to its own resolution; user setting is
ignored without error.
