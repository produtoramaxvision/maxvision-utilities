---
name: media-forge:mf-vfx
description: "Use when the user asks for VFX, particles, energy, destruction, transformation, weather effects, magical effects, explosions, smoke, fire, water, or physically plausible effects, on any media-forge video provider (Veo, Kling, Higgsfield, Seedance)."
triggers:
  - "VFX"
  - "particles"
  - "explosion effect"
  - "transformation effect"
  - "weather effect"
allowedTools: [Read, Grep]
---

# media-forge:mf-vfx

VFX prompts need material behavior, source, timing, and consequence. Treat every effect as physical: it starts somewhere, interacts with light and objects, changes over time, and ends in a visible state. Avoid generic words such as magical, explosive, or cinematic unless they are translated into particles, fluids, smoke, light, debris, deformation, or energy behavior. This applies across every provider.

## Intent

The user wants wonder, and wonder dies the moment it stops obeying physics. This skill's purpose is magic with a budget of cause and effect: every effect has a source, a journey, and an ending, so the impossible reads as witnessed rather than rendered.

## Effects Contract

State: effect source, material, motion path, interaction with light, interaction with objects, dissipation, and endpoint.

| Effect | Prompt-ready phrase | Stability note |
|---|---|---|
| Product particles | `gold dust particles spiral from behind the logo, catch the backlight, then settle on the table` | Keep logo and bottle rigid. |
| Energy | `thin blue electrical arcs crawl along the cable, briefly illuminating fingerprints on the plug` | Keep arcs attached to source. |
| Smoke | `cold white vapor rolls over the rim, sinks down the glass, and thins near the tabletop` | Describe density and direction. |
| Transformation | `paper edge chars inward from the corner, flakes curl and fall, final logo remains untouched` | Protect identity anchor. |
| Weather | `wind pushes rain diagonally across the frame, puddles ripple outward from each step` | Tie weather to surfaces. |

## VFX Integration Rules

Use one hero effect per clip. Anchor the source to a clear object or body part. Make the effect respect gravity, wind, collision, reflection, and occlusion. For VFX near faces, hands, logos, or text, keep the core identity stable and place the effect around it rather than through it.

## Timing and Dissipation

Effects need an endpoint: settle, fade, evaporate, freeze, collapse, glow out, or leave residue. If the effect is complex, use a three-step timing phrase: `forms -> travels -> dissipates`. Avoid perpetual effects with no consequence because they often become noisy overlays.

## Output Contract

Return the VFX contract, stability constraints, and a compact prompt-ready phrase.
