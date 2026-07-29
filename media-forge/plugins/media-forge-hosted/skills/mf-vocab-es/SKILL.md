---
name: media-forge:mf-vocab-es
description: "Use when the user asks for Spanish media-forge video-prompt wording, Spanish cinematic vocabulary, or translation of camera, lighting, action, VFX, audio, and production terms into Spanish, for any provider (Veo, Kling, Higgsfield, Seedance)."
triggers:
  - "Spanish prompt vocabulary"
  - "vocabulario en español"
allowedTools: [Read, Grep]
---

# media-forge:mf-vocab-es

Use Spanish cinematic vocabulary when the user asks for Spanish prompts, bilingual delivery, or compact translation of camera, lighting, action, VFX, audio, and production constraints. This vocabulary applies across providers; reference tags such as `@Image1`/`@Video1`/`@Audio1` are **Seedance-specific** reference-binding syntax and must never be translated.

## Intent

Spanish carries rhythm even in technical direction. Serve users who think in Spanish with vocabulary that keeps its musicality while staying camera-precise — they should never feel that directing in their language is a downgrade.

## Usage Rule

Translate production meaning, not word-for-word English. Keep the prompt concrete and concise: subject, visible action, camera, light, sound, and constraint.

| Function | Spanish wording |
|---|---|
| Camera | `travelling de acercamiento`, `plano medio`, `primer plano`, `seguimiento lateral`, `cámara fija` |
| Lighting | `contraluz`, `luz suave de ventana`, `luz práctica cálida`, `sombra marcada`, `luz de contorno fría de luna` |
| Motion | `gira lentamente`, `cruza rápido el encuadre`, `avanza con estabilidad`, `las gotas se deslizan` |
| Audio | `sonido ambiente`, `diálogo claro`, `golpe metálico suave`, `sin música` |
| Constraints | `mantener el logotipo, la etiqueta y la forma sin cambios` |

## Compact Pattern

`[Referencia] es la referencia; mantener identidad, color y forma sin cambios. Solo cambia [movimiento/luz/cámara]. Cámara: [un movimiento]. Sonido: [señal].`

## De-Slop Rule

When the prompt leans on `cinematográfico`, `épico`, `impresionante`, `mágico`, or `de alta calidad`, load the Slop Traps table in `skills/_shared/references/vocab/es.md` and decompose each into the physical elements that produce it — movimiento de cámara, fuente de luz, material, sonido.

## Output Contract

Return Spanish prompt wording, optional English gloss when useful, and unchanged reference tags.
