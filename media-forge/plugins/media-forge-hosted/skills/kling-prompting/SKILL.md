---
name: kling-prompting
description: "Kling V3 (Standard / Pro / Master 4K / Omni multi-shot) prompt engineering. 5-part spine (Camera-Scene-Action-Vibe-Time), per-mode cookbook, model-tier selection. Use BEFORE invoking media_kling_* tools or kling-director."
allowed-tools: [Read, Grep]
---

# Kling Prompting Skill

## When to load this skill

Load this skill before invoking any `media_kling_*` MCP tool or before dispatching to the `kling-director` subagent. The default video-router uses this skill's tier-selection guidance to decide which Kling model to use.

## 5-part prompt spine (use for t2v, i2v, motion-brush, lip-sync, extend)

Every Kling prompt should answer five questions in order:

1. **Camera** — lens, height, angle, motion verb. Examples: "85mm portrait, eye-level, slow dolly-in" / "wide 24mm, low-angle, static" / "handheld shoulder-cam, tracking right".
2. **Scene** — location, time-of-day, weather, light direction. Examples: "rooftop bar at golden hour, west-facing sun, scattered clouds" / "abandoned warehouse, blue hour, lone overhead practical light".
3. **Action** — subject + verb + object. Singular, present-tense, no hedge words. Examples: "woman in red coat lights a cigarette" / "crow lands on the rusted hood".
4. **Vibe** — adjectives for mood + film stock + grade. Examples: "melancholic, Kodak Portra 400, desaturated cyan-orange" / "tense, anamorphic flares, high-contrast green grade".
5. **Time** — duration + pace + rhythm. Examples: "5s, deliberate, single beat" / "10s, two-beat: setup then reveal".

Concatenate with commas. Do NOT use bullet lists in the prompt itself — Kling parses better with a single descriptive sentence stream of 30-80 tokens.

### Worked example

Spine:
- Camera: "50mm, chest-height, slow truck-left"
- Scene: "neon-lit Hong Kong alley, midnight rain, magenta + cyan signage backlight"
- Action: "delivery courier on bicycle weaves past a fruit stall"
- Vibe: "Wong Kar-wai homage, Fuji 400H push, dreamy halation"
- Time: "5s, languid"

Final prompt:
> "50mm chest-height slow truck-left, neon-lit Hong Kong alley at midnight rain with magenta and cyan signage backlight, delivery courier on bicycle weaves past a fruit stall, Wong Kar-wai homage on Fuji 400H push with dreamy halation, 5 seconds, languid pace."

## Model tier selection cookbook

| Use case | Pick |
|---|---|
| Quick draft / pre-viz / volume work | `kling-v3-standard` ($0.126/s — cheapest with audio) |
| Production-quality narrative shot | `kling-v3-pro` ($0.168/s, supports motion-brush + elements + lip-sync) |
| Hero shot / theatrical pitch reel | `kling-v3-master` (4K native 60fps, $0.18/s placeholder) |
| 2-6 cut sequence in one call | `kling-v3-omni` (multi-shot orchestration, $0.168/s placeholder) |

If the user asks for "4K", route to `kling-v3-master`. If the user asks for "multi-shot" or "sequence" or "3 cuts", route to `kling-v3-omni`. Otherwise default to `kling-v3-pro` unless cost-sensitive (then `kling-v3-standard`).

## Capability cookbook — when to use each MCP tool

### `media_kling_motion_brush` (V3 Pro)
Paint regions of a still image with motion vectors. Use when:
- Single image needs animated subregion (flag waving, hair blowing, single character gesture)
- Background should stay locked while one region animates
- Cinema-grade region control is needed (vs full-frame i2v)

Limits: 1+ regions per call, each region is a polygon (3+ points) with a 2D motion vector. 5s baseline duration, 10s max.

### `media_kling_elements` (V3 Pro)
Up to 4 frame-locked reference identities composed into one shot. Use when:
- Multi-character scene needs consistent identities (4 friends in a desert)
- Object identity must be preserved across the shot (specific sneaker, hero car)
- Background can be generated but characters must match references

Limits: 4 elements max (hard Kling cap). Each element must have been registered with Kling beforehand (returns an element_id).

### Elements lifecycle (full CRUD via new tools - Tasks 6.5/6.6/6.7)

- **Create** - `media_kling_element_create` uploads an image (URL or base64), creates an `element_id` at Kling, caches metadata in local `kling_elements` SQLite table with category (`character` | `product` | `location`) for filtering.
- **List** - `media_kling_element_list` returns local cache by default; `syncWithBackend:true` refreshes against Kling API and merges.
- **Delete** - `media_kling_element_delete` requires `confirm:true` (irreversible at backend), soft-deletes locally for audit.

**Scope & retention notes:**
- **Scope:** element_ids are per-Kling-account (tied to the `KLING_ACCESS_KEY`). Different access keys = different element pools.
- **Retention:** Kling auto-purges unused elements after ~30 days idle (verify via Kling Console). `last_used_at` in local cache helps predict purges.
- **GC strategy:** Cron a monthly `media_kling_element_list --syncWithBackend` and reconcile against local cache. Backend-missing = soft-delete locally. Local-only (cache row but backend 404) = re-create or purge.
- **Audit trail:** `kling_elements.deleted_at` retains soft-deleted rows for traceability - never `DELETE FROM`; only `UPDATE SET deleted_at`.

## Watermark policy

Default: `watermarkEnabled=false` on all paid keys (enforced by KlingProvider). Override only if:
- Free-tier key (watermark is forced)
- Compliance reason requires visible AI-source marking

`KlingProvider.generate` logs a warning on explicit `watermarkEnabled=true` because it's almost always a misconfig.

### Watermark dual-path (paid vs free key behavior)

- **Paid key + `watermarkEnabled:false`** -> asset delivered without watermark. Expected default.
- **Paid key + `watermarkEnabled:true`** -> asset delivered WITH watermark (Kling honors explicit opt-in). Warning logged.
- **Free key + `watermarkEnabled:false`** -> Kling MAY return one of two behaviors:
  1. **Silent fallback**: asset still delivered with forced watermark (free-tier policy overrides). Our handler accepts this - watermark is visible but the call succeeds.
  2. **Hard rejection**: Kling returns 4xx with a free-tier limit error. `KlingProvider.generate` surfaces the error verbatim.

  The exact behavior depends on Kling account tier. Tested both paths in `tests/video/providers/kling.test.ts` (paid-key opt-out succeeds; free-key opt-out either succeeds-with-watermark OR rejects with specific error). The graceful fallback rule: do NOT retry with `watermarkEnabled:true` on a free-key rejection - surface the error and let the caller upgrade the account.
- **Free key + `watermarkEnabled:true`** -> asset delivered with watermark (no behavioral change).

### `media_kling_lip_sync` (V3 Pro)
Drive a source video clip with speech. Two modes:
- **Text-driven**: provide text + optional emotion (happy/angry/sad/neutral). Kling generates speech + lip-syncs.
- **Audio-driven**: provide audio URL. Kling lip-syncs to the audio.

Exactly one of `text` or `audioUrl` required (Zod validator enforces). Use for:
- Localizing a video to a new language
- Adding emotional inflection (Higgsfield does NOT have an emotion picker — this is Kling's edge)
- Quick voiceover prototyping

### `media_kling_omni_multishot` (V3 Omni — Kling's DIFFERENTIATOR)
Up to 6 contiguous cuts in a single API call, sharing visual identity via image refs. Use for:
- Music-video sequences (verse / chorus / bridge edit)
- Narrative beats (establishing → action → reaction → reveal)
- Storyboard execution in one shot

Per-shot duration is independent (each up to 10s); total <= 30s (Zod refine enforces via VIDEO_MODELS['kling-v3-omni'].limits.maxDurationSec). Image refs anchor visual style across cuts. Indices MUST be contiguous 1..N starting at 1 (Zod refine enforces).

### `media_kling_video_extend` (V3 Pro)
Adds ~4.5s of continuation per hop to a source video. Up to 4 hops chained (~18s extension total). Use for:
- Extending a single shot beyond Kling's 10s native max
- Continuing a Veo/Higgsfield clip with Kling's motion model (cross-provider chaining)

Returns first hop jobId + `hopsRemaining`. Caller MUST re-invoke after webhook fires to chain further hops (this prevents runaway cost from a single command).

## 4K Master discipline

`kling-v3-master` is 4K native + 60fps. Treat it as theatrical-pitch budget:
- Reserve for hero shots, not entire sequences
- Match the prompt's specificity to the resolution — vague prompts at 4K waste budget
- Sound mix: Kling audio at 4K is louder/wider stereo; mention sound design in the prompt's Vibe section

Pricing flag: rate `$0.18/s` is a placeholder. Verify on first live invocation and surface a `pricing.notes` update if drift > 10%.

## Omni multi-shot structure (Kling-specific grammar)

Each shot in `multi_prompt` array carries `index` (0-based, contiguous), `prompt` (full 5-part spine), `duration` (seconds). Image refs in `image_list` provide visual anchors that Kling uses to maintain identity across cuts.

Best practice:
- First shot: establish the world (wide, slow). Heaviest use of image refs.
- Middle shots: subject-focused (medium / close). Lean on identity carryover.
- Final shot: punctuation (cut to reveal / pull back / hold on detail).
- Per-shot duration: keep most at 4-5s; reserve 7-10s for emotional beats.

## Elements coordination across up to 4 references

When using `media_kling_elements`:
- Order the elementIds by visual prominence (most prominent first)
- The base imageUrl sets composition + background; elements are inserted/blended in
- The prompt should reference each element naturally (don't say "element 1, element 2" — use roles: "the chef, the diner, the waiter, the dog")

## Common pitfalls

- **Don't** ask for "30 seconds" — Kling max is 10s per shot (omni: 10s per shot, 6 shots = 60s total). Single-shot requests > 10s will fail at the API.
- **Don't** mix text + audio in lip-sync — Zod will reject. Pick one.
- **Don't** use V3 Master for batch/volume work — cost explodes. Use V3 Standard.
- **Don't** assume video extension is free chaining — each hop is a separate billed call. `hopsRemaining` in the response forces the caller to re-invoke (intentional friction).
- **Don't** invoke Omni for single-cut work — overhead is real; just use `media_kling_t2v` (via media_generate_video) or `media_video_route`.

## When NOT to use Kling

- User explicitly wants Veo's audio coherence → route to `veo-director`
- User wants Higgsfield's Soul ID character identity at full strength → route to `higgsfield-director`
- Real-time / sub-second latency → Kling is async (webhook-driven); use Veo polling if latency-sensitive

## How this skill interacts with kling-director

The `kling-director` subagent loads this skill on entry. The subagent's job is to take a refined spec and pick the right Kling tool (motion-brush vs elements vs omni etc.). This skill provides the rules; the subagent applies them.
