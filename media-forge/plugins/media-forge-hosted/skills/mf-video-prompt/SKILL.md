---
name: media-forge:mf-video-prompt
description: "Use when the user asks to write, improve, translate, compress, or debug a media-forge video prompt; mentions T2V, I2V, V2V, R2V, camera direction, prompt quality, or provides reference assets for a production-ready prompt. Covers the shared prompt-craft that applies before routing to a specific provider (Veo, Kling, Higgsfield, Seedance), plus Seedance's own reference-fusion mode in full detail."
triggers:
  - "write a video prompt"
  - "improve this prompt"
  - "T2V"
  - "I2V"
  - "V2V"
  - "R2V"
  - "reference fusion"
allowedTools: [Read, Grep]
---

# media-forge:mf-video-prompt

Build production-ready video prompts from clear concepts or supplied reference assets. Treat the prompt as a short shooting brief: it must say what changes on screen, what the camera does, what the light and sound contribute, and what must stay stable. Keep final prompts under the target provider's prompt budget and remove filler before delivery.

This skill supersedes media-forge's earlier single-file `seedance-prompting` skill: the mode gate, director formula, and compression rules below are provider-agnostic craft that applies whichever of Veo, Kling, Higgsfield, or Seedance ends up rendering the clip. Where a section is Seedance's own mechanism (the `@ImageN`/`@VideoN`/`@AudioN` reference-fusion syntax, its tier names, its duration caps), it is marked **Seedance-specific** — for Kling's or Higgsfield's equivalent mechanisms and tier cookbooks, see `kling-prompting` and `higgsfield-prompting`.

Load `[ref:quick-ref]` for the checklist, `[ref:reference-workflow]` for multimodal references, `[ref:i2v-guide]` for image-to-video, `[ref:first-last-frame-guide]` for first/last-frame work, `[ref:examples-by-mode]` when examples are useful, `[ref:shot-list-continuity]` for multi-shot professional plans, `[ref:multishot-grammar]` for shot-label grammar, the shots-times-seconds budget, and cut placement inside one generation, and `[ref:multilingual-community-examples]` for Chinese/Russian/Japanese/Korean/Spanish or mixed-language prompts. When sequence state is present, load `[ref:prompt-compiler]` and compile only the current clip contract.

## Intent

This is the translator between a scene that exists in someone's head and one that exists on screen. The user has already imagined it; the job is to lose as little as possible in transit. Success is a first generation close enough that they can react instead of explain. Each revision inherits everything the story has already decided and changes only what the reaction asked for — a draft is a conversation, not a restart.

## Director Formula

Before filling slots, decide the one thing the shot is doing. Load `[ref:directing-engine]`, read the scene, name a single intention, and let that intention choose the camera, lighting, blocking, performance, and sound together so they reinforce instead of compete. The formula below is the container for a coherent setup, not a checklist of independent decorations; if a project voice is already set, keep this shot inside it.

Use `Subject + Action + Scene + Camera + Lighting/Style + Audio + Constraints`. Put the subject and primary action first because early clauses set the shot hierarchy. Do not force every slot if a reference asset already shows the information; for I2V, describe only the motion, camera, timing, transformation, audio, and preservation constraints that the still image cannot show.

| Slot | Use for | Prompt-ready pattern |
|---|---|---|
| Subject | The anchor the model must track. | `Original ceramic perfume bottle on black acrylic, label preserved exactly` |
| Action | The visible change. | `condensation beads form and slide down the glass over five seconds` |
| Scene | Only what is not already in references. | `quiet rain-lit kitchen counter, shallow depth of field` |
| Camera | One primary move with endpoint. | `slow dolly-in from medium product shot to macro label detail` |
| Light and style | Physical light plus safe visual language. | `warm practical key from frame left, cool blue rim, clean commercial realism` |
| Audio | Ambient bed, SFX, dialogue, or silence. | `Sound: low room tone, soft glass chime on final frame` |
| Constraints | Preservation and exclusions. | `do not alter logo, shape, label, or cap geometry` |

## Mode Gate

Choose the mode before drafting. **T2V** needs subject, action, scene, camera, light, style, and constraints because nothing is visible yet. **I2V** starts from a reference image and adds only motion, time, camera, lighting transition, audio, and preservation. **V2V** should map a video reference to source clip, camera move, action rhythm, blocking, edit target, or extension anchor rather than accidentally transferring identity. **R2V** must list every reference role and state what must not transfer. **FLF2V** (**Seedance-specific** naming; Seedance uses `@Image1` as first frame and `@Image2` as last frame) describes only the continuous transition between two supplied frames.

| Mode | Drafting priority | Common mistake | Repair |
|---|---|---|---|
| T2V | Build the whole shot in compact layers. | Too many events in one clip. | Keep one visible beat and one endpoint. |
| I2V | Preserve visible identity; add motion. | Re-describing the image until the product or face drifts. | Say `preserve the reference image exactly`; add only dynamic changes. |
| V2V | Transfer motion, camera, or timing. | Copying unauthorized likeness or scene details. | Use owned/licensed/authorized references and restrict transfer role. |
| R2V | Assign separate roles to each asset. | One reference asked to control identity, pose, scene, and style. | Split roles or prioritize the most important role. |
| FLF2V | Move from first frame to last frame. | Treating the last frame as vague mood instead of endpoint. | State the last-frame image is the final visual target. |
| Edit | Preserve the source clip while changing one layer. | Rewriting the whole scene and losing continuity. | Say `source clip stays as-is; change only...` |
| Extend | Continue from accepted source footage only. | Starting from a planned ending or inventing the clip state. | Route to `[skill:mf-continuation]` and use the observed end state. |

**Seedance-specific reference-fusion syntax:** when the target provider is Seedance, references bind to `@Image1`/`@Image2`/.../`@Video1`/.../`@Audio1`/... tokens in prompt order (see `[ref:reference-workflow]`); every uploaded reference must be @-mentioned or it is silently ignored. Kling (Elements, `element_id`) and Higgsfield (Soul ID, MCSLA formula) bind references through their own mechanisms — see `kling-prompting` and `higgsfield-prompting`.

## Sequence Boundary

The generic prompt skill must not independently invent continuation state. If the user asks to continue, extend, make part two, or use a previous clip, route to `[skill:mf-continuation]` unless the accepted clip/final frame and observed end state are already present in the sequence state.

For sequence prompts, preserve `project_id`, `clip_id`, `parent_clip_id`, continuity locks, exact reference tags, the actual opening state, completed beat exclusions, and reserved future beats. The final prompt remains natural language and covers only the current clip.

## Prompt Build Process

First, identify the single visible beat: reveal, arrival, decision, transformation, contact, pursuit, or disappearance, and name the one intention it serves. Next, assign reference roles before adding adjectives. Then write a compact first draft in the director formula order, keeping camera, light, performance, and sound aimed at that intention. Finally, run a self-check and the directing coherence test from `[ref:directing-engine]`: one main subject, one main action, one motivated main camera move, physically motivated lighting, performance written as a visible gesture rather than an emotion word, assigned character tags, sound intent, and no hollow boosters.

## Compression Rules

When the prompt is too long, cut in this order: duplicate style adjectives, generic quality words, background details visible in references, secondary camera moves, secondary actions, and speculative emotional labels. Keep preservation constraints, action timing, and role maps. If a user requests a bilingual or mixed-language prompt, use language mixing only for clarity: reference roles, dialogue language, technical camera terms, and safe production constraints. Do not use another language to hide unsafe intent.

## Output Contract

Return:

1. Mode: T2V, I2V, V2V, R2V, FLF2V, edit, or extend.
2. Reference role map, if any.
3. Final prompt under the verified active-provider prompt budget.
4. Optional Chinese compressed version when useful.
5. Shot-list or delivery note when the prompt belongs to a professional sequence.
6. Safety or copyright note when relevant.

Before finalizing, run an anti-slop pass (`[skill:mf-antislop]`) and remove vague quality boosters.
