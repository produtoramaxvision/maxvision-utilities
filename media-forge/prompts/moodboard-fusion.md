---
template: moodboard-fusion
version: 1
inputs: [effect_tags, ref_count, style_hint]
---
Fuse the {{ref_count}} reference images into a single cohesive moodboard keyframe.

PRIMARY EFFECT(S): {{effect_tags}}
{{#if style_hint}}STYLE HINT: {{style_hint}}{{/if}}

Composition rules:
- Capture the dominant lighting, palette, lens character, and framing across the references.
- Treat references as inspiration for atmosphere — do NOT copy any specific subject, face, or branded element.
- If subject reference images are provided, place the subject naturally inside the scene; preserve identity.
- Output a single still image at the requested resolution suitable as an `image-to-video` seed for Veo 3.1.

Forbidden: text overlays, watermarks, frames, borders, multi-panel layouts, captions.
