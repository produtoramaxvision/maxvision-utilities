---
name: media-forge:higgsfield-prompting
description: Higgsfield prompting playbook — MCSLA formula, DoP camera verbs, Cinema Studio lens dictionary, Soul ID lifecycle, Marketing Studio templates. Trigger when caller plans a Higgsfield generation.
when_to_invoke: video-router or higgsfield-director needs structural guidance on prompt composition
inputs:
  - mode: t2v | i2v | lip-sync | targeted-edit | with-refs
  - intent: cinematic | character-consistent | marketing | recast | predict
outputs:
  - structured prompt
  - extras object (HiggsfieldExtras shape)
---

# Higgsfield Prompting Playbook

## 1. MCSLA Formula (universal)

Every Higgsfield prompt benefits from these five concentric layers, in order:

| Layer | Question | Example |
|---|---|---|
| **M** Motion | What moves? | "the bartender slides a glass across the counter" |
| **C** Camera | How does the lens move? | "crane_up + dolly_in" (DoP verbs) |
| **S** Subject | Who/what is the focal point? | "a noir-era bartender in mid-thirties, scar under left eye" |
| **L** Lighting | What kind of light, from where? | "single tungsten bulb above, hard rim from window left" |
| **A** Aesthetic | What is the emotional / style register? | "1940s Hollywood noir, high contrast, slight bloom" |

Compose in this order; the platform's Soul models tokenise Motion + Camera first, then resolve Subject inside the implied Lighting + Aesthetic frame.

## 2. DoP Camera Verb Cheatsheet (22 verbs)

| Verb | Use when |
|---|---|
| `dolly_in` | Push closer to subject (heighten intimacy / suspense) |
| `dolly_out` | Pull back to reveal context |
| `crane_up` | Rise above scene (god-view, reveal) |
| `crane_down` | Descend onto subject (introduce / land into action) |
| `orbit` | Circle subject (showcase 360°, build awe) |
| `crash_zoom` | Snap zoom-in (reactive, comedic, jolt) |
| `bullet_time` | Frozen-orbit (Matrix; iconic) |
| `fpv_drone` | First-person drone weave (action / sports) |
| `handheld` | Naturalistic, slight wobble (documentary / vérité) |
| `whip_pan` | Fast horizontal sweep (energy transition) |
| `tilt_up` / `tilt_down` | Vertical reveal |
| `pan_left` / `pan_right` | Horizontal reveal |
| `arc` | Arc move (parallax + reveal) |
| `truck` | Sideways tracking (parallel to action) |
| `pedestal` | Vertical lift without tilt (architectural) |
| `rack_focus` | Shift focal plane between foreground / background |
| `vertigo_effect` | Dolly-zoom (Hitchcock — anxiety / dread) |
| `static` | No camera motion (composition is the statement) |
| `low_angle` / `high_angle` | Static angle modifiers |

**Best practice**: combine ≤2 verbs per shot. More than 2 collapses into incoherent motion.

## 3. Cinema Studio 3.5 Lens Dictionary

| Field | Typical Values | Effect |
|---|---|---|
| `focalLengthMm` | 14, 24, 35, 50, 85, 135 | Wide → tele (compression) |
| `apertureFStop` | 1.4, 1.8, 2.0, 2.8, 5.6, 8 | Shallow → deep DOF |
| `sensorSize` | full-frame, super35, apsc, m43, imax | Sensor crop + look |
| `colorGrading` | teal-orange, bleach-bypass, noir, pastel, vibrant, plus free-form | Era / mood |
| `lensId` | e.g. `arri-master-prime-35mm`, `cooke-s4-50mm`, `zeiss-master-anamorphic-50mm` | Specific lens character |

**Recipe for "Sundance indie drama":**
```json
{ "focalLengthMm": 35, "apertureFStop": 2.0, "sensorSize": "super35", "colorGrading": "bleach-bypass" }
```

**Recipe for "Wes Anderson symmetry":**
```json
{ "focalLengthMm": 35, "apertureFStop": 8, "sensorSize": "full-frame", "colorGrading": "pastel", "lensId": "cooke-s4-35mm" }
```

## 4. Soul ID Lifecycle Best Practices

1. **Train once per character** — pick 3-7 source images covering frontal, 3/4, profile, varied expression. Training is ~250 credits (~$9.75 on Plus).
2. **Name aggressively** — character name is the lookup key. Use unique distinguishing names: not "Sarah" but "Sarah Nguyen, lead reporter".
3. **Mark used after every successful generation** — `media_higgsfield_soul_id markUsed` updates the LRU.
4. **Audit periodically** — `media_higgsfield_soul_id list` shows training cost + last_used; archive IDs unused >90 days.
5. **One Soul ID per project character** — do NOT train multiple IDs for the same character; consistency degrades.

## 5. Marketing Studio Template Decision Tree

| Caller intent | Template | Best for |
|---|---|---|
| Show product in use | `lifestyle` | Casual / aspirational |
| Open the box, reveal item | `unboxing` | E-commerce, hype |
| Hard-sell with VO | `tv-spot` | DTC brand launches |
| Showcase texture/material | `asmr` | Beauty, food, fabric |
| Lateral motion + product flips | `hyper-motion` | Sneakers, gadgets, drinks |
| Customer talks to camera | `testimonial` | Trust building |
| Influencer-style POV | `ugc` | Social commerce |
| Pros vs cons walkthrough | `product-review` | Tech, comparison |
| Short looped beats | `reel` | Reels, TikTok, Shorts |

Always include a clean `productUrl` — the platform crawls product imagery from it.

## 6. Mode → Tool Map

| Mode requested | Use tool |
|---|---|
| Pure t2v with aesthetic preset | `media_higgsfield_soul_id` (to fetch ID) + provider generate |
| i2v with camera motion | `media_higgsfield_dop` |
| Cinematic lens control | `media_higgsfield_cinema_studio` |
| Talking head (photo + audio) | `media_higgsfield_speak` |
| Product UGC | `media_higgsfield_marketing_studio` |
| Swap character in existing video | `media_higgsfield_recast` |
| Score a candidate | `media_higgsfield_virality_predictor` |
