---
name: media-forge:seedance-prompting
description: "Seedance 2.0 prompt engineering: tier selection (Fast 720p / Standard 1080p — no Pro tier), multi-shot timestamp markers, @-mention reference syntax for reference-to-video, audio+video joint generation, image-to-video end-frame transitions. Use BEFORE invoking media_seedance_* tools or seedance-director."
triggers:
  - "seedance prompt"
  - "multi-shot timestamp"
  - "omni-reference"
  - "@Image1"
  - "@Video1"
  - "@Audio1"
  - "audio+video joint"
  - "reference fusion"
  - "frame transition"
allowedTools: [Read, Grep]
---

# Seedance 2.0 Prompt Engineering

## When to load this skill

Load this skill before invoking any `media_seedance_*` MCP tool or before dispatching to the `seedance-director` subagent. The default video-router uses this skill's tier-selection guidance to decide which Seedance endpoint to use.

## Tier selection

Seedance 2.0 ships exactly **two tiers** via fal.ai: **Fast** and **Standard**.

> **There is no Pro tier in Seedance 2.0.** Any prompt or tool call referencing a Pro tier will fail at the provider level. Do not request it.

| Tier | Resolution cap | Best for | Rate (fal.ai) |
|---|---|---|---|
| Fast | 720p max (480p also available) | Drafts, A/B variants, iteration cycles, batch volume | ~$0.2419/s |
| Standard | 1080p (480p/720p also available) | Production deliverables, hero shots, final renders | ~$0.3024/s |

**Decision rule:**

1. Start every new concept with **Fast** — iterate until prompt + reference set are locked.
2. Promote to **Standard** only when ready for a production output or when the scene requires 1080p resolution.
3. Native audio is included at both tiers — no surcharge, no separate call.

Cost example: a 10-second 720p clip costs ~$2.42 (Fast) or ~$3.03 (Standard). Always run `media_video_cost_estimate` before generating to surface actual cost before spending.

**Billing note:** fal.ai charges per-second of output. For 1080p clips at long durations (Standard tier, ≥10s), a token formula may apply: `(height × width × duration × 24) / 1024 × $0.014/1k tokens`. fal.ai bills whichever is higher. For 720p clips ≤15s, per-second dominates.

## Mode selection — which MCP tool to invoke

Seedance 2.0 exposes three endpoint families (no extend, no lip-sync in v2):

| User intent | MCP tool | fal.ai endpoint |
|---|---|---|
| Generate video from text only | `media_seedance_text_to_video` | `text-to-video` |
| Animate a start image, optional end frame | `media_seedance_image_to_video` | `image-to-video` |
| Anchor both start AND end frame (frame-morph transition) | `media_seedance_image_to_video` with `endImageUrl` | `image-to-video` |
| Multi-shot sequence (up to 4 cuts in one clip) | `media_seedance_multishot` | `text-to-video` (prompt-structured) |
| Fuse character/style/motion/audio references | `media_seedance_reference_fusion` | `reference-to-video` |

> **extend and lip-sync do not exist as Seedance 2.0 fal.ai endpoints.** If a user requests these, surface the gap: for extension, chain multiple t2v/i2v calls; for lip-sync, route to `kling-director` (Kling V3 Pro has a dedicated lip-sync endpoint).

## Prompt structure — 5-part spine (all modes)

Every Seedance prompt benefits from these five ordered layers:

1. **Camera** — lens height, angle, motion verb. Example: "85mm, eye-level, slow dolly-in". Be specific — Seedance responds to explicit camera verbs, not vague "movement".
2. **Scene** — location, time-of-day, light source, weather. Example: "rain-slicked Tokyo alley, 2am, sodium vapor pools".
3. **Action** — subject + verb + object, present tense, no hedging. Example: "woman in white parka crosses a pedestrian bridge".
4. **Vibe** — mood, film stock, color grade. Example: "contemplative, Kodak Vision3 500T, teal-shifted shadows".
5. **Audio** — ambient, score, or dialogue cue. Example: "distant train horn, rain on concrete, no music". For reference-to-video with `@Audio1`, describe what the audio does in the scene.

Compose as a single comma-joined sentence of 30-100 tokens. Do NOT use bullet lists inside the prompt string — the model parses flat prose better.

### Worked example (Standard tier, text-to-video)

Spine:
- Camera: "50mm, chest-height, slow truck-left"
- Scene: "neon-lit Hong Kong alley, midnight rain, magenta and cyan signage backlight"
- Action: "delivery courier on bicycle weaves past a fruit stall"
- Vibe: "Wong Kar-wai homage, Fuji 400H push, dreamy halation"
- Audio: "rain on asphalt, distant bicycle bell, no music"

Final prompt:
> "50mm chest-height slow truck-left, neon-lit Hong Kong alley at midnight rain with magenta and cyan signage backlight, delivery courier on bicycle weaves past a fruit stall, Wong Kar-wai homage on Fuji 400H push with dreamy halation, rain on asphalt with distant bicycle bell."

## Multi-shot syntax (text-to-video, up to 4 cuts, max 15s total)

Multi-shot is achieved via prompt structuring — there is no separate multi-shot endpoint. Use `media_seedance_multishot`, which builds the structured prompt from a `shots[]` array.

The timestamp-cut format the model parses:

```
<global scene direction — style, color, recurring visual anchors, no longer than 80 tokens>

[00:00-00:05] Shot 1: <shot 1 content — camera, action, subject specifics>
[00:05-00:10] Shot 2: <shot 2 content — progression, establish change>
[00:10-00:15] Shot 3: <shot 3 content — payoff or punctuation>
```

Constraints enforced by `media_seedance_multishot`:

- Total duration ≤ 15s (Seedance hard limit — any tier).
- Each shot minimum 2s, recommended 3-8s. Shots under 2s produce incoherent motion.
- Up to 4 shots per call. More than 4 produces cut-coherence degradation.
- Global direction ≤ 80 tokens; each shot description ≤ 120 tokens.
- Shots render in array order with zero-frame hard cuts (no crossfade, no dissolve).

Best practice for shot arc:

- Shot 1: wide establishing, slow camera — sets the world.
- Middle shots: subject-focused medium/close — escalate action.
- Final shot: punctuation — hold on detail, pull back to reveal, or hard cut to black.

## @-mention reference syntax (reference-to-video)

When using `media_seedance_reference_fusion`, supply arrays of image, video, and/or audio URLs. fal.ai binds them to placeholder tokens in order:

| Array field | Prompt token | Notes |
|---|---|---|
| `imageUrls[0]` | `@Image1` | |
| `imageUrls[1]` | `@Image2` | |
| `imageUrls[N-1]` | `@ImageN` | |
| `videoUrls[0]` | `@Video1` | |
| `videoUrls[N-1]` | `@VideoN` | |
| `audioUrls[0]` | `@Audio1` | |
| `audioUrls[N-1]` | `@AudioN` | |

**Mention rules:**

- ALWAYS @-mention every uploaded reference in the prompt. Unmentioned references are silently ignored by the model.
- Order by narrative importance: identity references first (character face), then style references (environment, material), then motion references (video), then audio last.
- Use natural language — describe what the reference contributes, not just its index: "A woman with the appearance of @Image1, wearing the outfit shown in @Image2, moving with the energy of @Video1, set in the environment from @Image3."

Worked example prompt (3 images, 1 video, 1 audio):

```
A woman with the appearance of @Image1, wearing the coat from @Image2, moving through
the location shown in @Image3 with the energy from @Video1. Ambient sound from @Audio1.
Slow dolly-in, golden hour side-light, contemplative mood, Kodak Portra 400 grade.
```

## Image-to-video: start frame + end frame transitions

`media_seedance_image_to_video` accepts:
- `imageUrl` (required) — the starting frame.
- `endImageUrl` (optional) — the ending frame.

When `endImageUrl` is provided, Seedance generates a morph/transition between the two frames. This is the correct way to produce a **frame-anchored targeted transition** — there is no separate "targeted edit" endpoint in Seedance 2.0. The model interpolates motion, camera, and lighting between the two frames.

Prompt guidance for start→end transitions:

- Describe the motion/transformation you expect between the frames, not the frames themselves (the model sees the images directly).
- Example: "smooth morphing transition, subject turns to face camera, warm interior lighting shifts to cool evening blue".
- Keep prompts under 60 tokens for i2v — the image dominates; the prompt steers motion quality.

## Native audio: generation and prompt cues

Both tiers generate audio in the same pass as video (`generate_audio: true` is the default). The output is a single MP4 with an embedded audio track — no separate ffmpeg merge.

To write prompts that benefit from audio:

| Goal | Prompt pattern |
|---|---|
| Ambient environment | "with the ambient sound of [location]" — e.g. "with ambient forest birdsong" |
| Cinematic score | "with a slow cinematic strings score" / "with a tense low drone" |
| Diegetic SFX | Name the sound-producing action: "footsteps on wet gravel", "glass shatters on tile" |
| Dialogue / voice | For reference-to-video with `@Audio1`: "voice-over narration from @Audio1 describing the scene" |
| Silence | "no music, no ambient sound, only the hum of fluorescent lights" |

Do NOT include explicit mixing instructions (dB levels, EQ targets) — the model ignores them. Keep audio description to one clause at the end of the prompt.

## Director-level camera control vocabulary

| Term | Effect |
|---|---|
| dolly in / dolly out | Smooth depth change — use over "zoom" |
| tracking shot | Camera follows subject laterally |
| POV shot | First-person subjective view |
| rack focus | Shifts focal plane from foreground to background (or reverse) |
| push-in / pull-out | Aggressive dolly (faster than standard dolly) |
| pan left / pan right | Horizontal sweep from fixed position |
| tilt up / tilt down | Vertical reveal from fixed position |
| crane shot | Rising or falling reveal — wide spatial sweep |
| handheld | Naturalistic wobble — use for documentary/vérité feel |
| locked-off | Completely static — composition is the statement |
| orbit | 360 arc around subject — showcase all angles |
| whip pan | Rapid horizontal sweep — transition energy |

Combine at most 2 camera verbs per shot. Three or more collapses into incoherent motion.

**Avoid:** "zoom" (use "dolly in/out"), "follow" (use "tracking shot"), "move" without direction (always specify axis and direction).

## Realistic physics cues

Physics language improves motion coherence:

| Domain | Effective cues |
|---|---|
| Weight | "heavy footfall", "the bag drops with impact", "concrete blocks tumble and slide" |
| Collision | "billiard balls scatter on impact", "glass fractures from center outward" |
| Cloth / fabric | "silk dress billows in wind", "leather jacket creases at the elbow", "flags ripple in gust" |
| Fluid | "liquid pours in a slow arc", "water splashes and beads on surface" |
| Motion blur | "motion-blurred background, sharp subject", "frozen-moment freeze with trailing blur" |

Add one physics clause per shot for any scene with significant physical interaction. Omitting physics cues for contact scenes leads to floaty/weightless motion.

## Resolution and duration reference

| Parameter | Valid values | Notes |
|---|---|---|
| `resolution` | `"480p"`, `"720p"`, `"1080p"` | 1080p is Standard tier only |
| `duration` | `"auto"`, `"4"`, `"5"`, ..., `"15"` | String enum, max 15s |
| `aspectRatio` | `"auto"`, `"21:9"`, `"16:9"`, `"4:3"`, `"1:1"`, `"3:4"`, `"9:16"` | Default `"auto"` |

Default: `resolution="720p"`, `duration="auto"`, `aspectRatio="auto"`, `generateAudio=true`.

Use `"9:16"` for vertical social (Reels, TikTok, Shorts). Use `"21:9"` for cinematic widescreen. Use `"1:1"` for square format social.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| References silently ignored | Missing @-mention in prompt | @-mention every uploaded ref by its token (`@Image1`, `@Video1`, etc.) |
| Multi-shot shots blend together | Timestamp markers malformed | Use exact `[MM:SS-MM:SS] Shot N:` format; no variation |
| Motion crawls / floaty | No physics cues, generic verbs | Add specific camera verb + physics clause for contact scenes |
| Audio mismatched to visuals | Audio description placed mid-prompt | Move audio cue to the last clause in the prompt |
| Face drifts across multi-shot | No persistent identity ref | Use reference-to-video with `@Image1` for character identity across shots |
| i2v output ignores end frame | `endImageUrl` not semantically described in prompt | Add a transition description clause: "morphing into", "shifting to" |
| Cost overrun at 1080p long clip | Token billing kicks in | Recompute: `(1080×1920×duration×24)/1024 × $0.014` and compare to `rate × duration` |

## When NOT to use Seedance

- User needs lip-sync to audio → route to `kling-director` (Kling V3 Pro, dedicated lip-sync endpoint)
- User needs video extension beyond 15s → chain multiple Seedance calls or route to `kling-director` (video-extend)
- User wants Higgsfield Soul ID persistent character identity → route to `higgsfield-director`
- User needs sub-second or real-time preview → Seedance is async queue-based; use a synchronous provider

## Legal note — IP risk

Seedance 2.0 is classified `ipRiskLevel: high` in the media-forge model registry (Disney/Paramount C&D context). The operator running media-forge assumes full responsibility for compliance with applicable IP law. Do NOT include recognizable IP-protected characters by name or likeness in prompts (e.g. Disney characters, Marvel heroes, Paramount franchises). Do NOT generate content featuring real persons without explicit consent context. This is the only surface in media-forge that mentions IP risk — there is no runtime gate.
