---
name: media-forge:mf-cinematic-studio
description: "Use when the user wants a crafted cinematic shot rather than a creator-style ad — camera style, lighting scheme, colour grade and genre as named presets. Higgsfield Cinematic Studio 3.5."
triggers:
  - "cinematic shot"
  - "camera style"
  - "colour grade"
  - "lighting scheme"
  - "cinema studio"
allowedTools: [Read, Grep, Bash]
---

# media-forge:mf-cinematic-studio

Four preset axes — camera, light, grade, genre — that compose into a look. This
is the counterpart to `[skill:mf-ugc-produce]`: same price, same duration
ceiling, opposite intent.

## Intent

The presets are not a shortcut around cinematography vocabulary; they are a
vocabulary the model renders reliably. A free-text prompt asking for
"cinematic lighting" gets an average of everything that word has ever labelled.
`light_scheme: contre_jour` gets backlight.

Compose deliberately: each axis is orthogonal, and setting all four is usually
one too many. Pick the two the shot is actually about.

## Camera style

| Value | Behaviour |
|---|---|
| `classic_static` | Locked off. Composition does the work |
| `one_take` | Continuous move, no implied cut |
| `epic_scale` | Wide, slow, subject small in frame |
| `intimate_observer` | Close, patient, slightly off-axis |
| `impossible_camera` | Moves no rig could make |
| `documentary_snap` | Reactive, finds the subject late |
| `raw_chaos` | Handheld, unstable, urgent |
| `dreamy_flow` | Floating, unmotivated drift |
| `silent_machine` | Mechanical, precise, unhurried |

## Light scheme

| Value | Behaviour |
|---|---|
| `soft_cross` | Two soft sources, gentle modelling |
| `contre_jour` | Backlit, subject toward silhouette |
| `overhead_fall` | Top light, shadowed eyes |
| `window` | Single directional daylight |
| `practicals` | Lamps and screens inside the frame |
| `silhouette` | Shape only, no detail |

## Colour grading

| Value | Behaviour |
|---|---|
| `naturalistic_clean` | Neutral, minimal treatment |
| `bleached_warm` | Lifted blacks, warm cast |
| `hyper_neon` | Saturated, magenta/cyan |
| `teal_orange_epic` | The blockbuster split |
| `sodium_decay` | Amber street light, degraded |
| `cold_steel` | Desaturated blue |
| `bleach_bypass` | High contrast, retained silver |
| `classic_bw` | Monochrome |

## Genre

`auto` · `action` · `horror` · `comedy` · `noir` · `drama` · `epic`

Genre biases pacing and blocking, not just look. `noir` is not a colour grade —
`classic_bw` and `cold_steel` are. Setting `genre: noir` with
`color_grading: hyper_neon` is a legitimate combination, not a mistake.

## Submitting

```
media_higgsfield_cinema_studio {
  prompt, durationSec, resolution,
  cameraStyle, lightScheme, colorGrading, genre,
  stylePrompt, generateAudio, multiShots,
  startImagePath, endImagePath, imageReferencePaths
}
```

- **5 credits per second** at 720p; 480p 0.7x, 1080p 2.0x. 15s/720p = 75 credits.
- `startImagePath` makes it i2v; `endImagePath` sets the frame it lands on.
- `stylePrompt` is free text layered over the presets — use it for what the
  presets cannot name, not to restate them.
- `generateAudio` adds a track; `multiShots` allows internal cuts.

The exact price comes from `higgsfield generate cost` before submit, so the
figure the guard enforces is the platform's own.

## Choosing against the alternatives

- A person selling something → `[skill:mf-ugc-produce]`. Cinematic Studio has no
  avatars, and a testimonial rendered with `epic_scale` stops being a testimonial.
- Prompt craft on another provider → `[skill:mf-video-prompt]`,
  `[skill:mf-camera]`, `[skill:mf-lighting]`. Those write prose for models with
  no preset vocabulary; this one selects from a menu the platform publishes.
- A named genre pattern rather than a look → `[skill:mf-recipes]`.
