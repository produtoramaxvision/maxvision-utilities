---
name: media-forge:mf-antislop
description: "Use when a media-forge video prompt (Veo, Kling, Higgsfield, or Seedance) contains generic AI filler, hollow superlatives, vague cinematic language, bloated adjectives, weak verbs, or needs sharper production-specific wording."
triggers:
  - "prompt is too vague"
  - "remove filler"
  - "anti-slop"
  - "generic AI wording"
  - "tighten this prompt"
allowedTools: [Read, Grep]
---

# media-forge:mf-antislop

Remove filler that hides missing visual decisions. A strong video prompt uses observable nouns, verbs, camera moves, light sources, sound cues, and constraints. A weak prompt asks for excellence without saying what excellence looks or sounds like. This applies across every media-forge provider — Veo, Kling, Higgsfield, and Seedance all reward the same discipline; none of them can act on a word that has no visual referent.

## Intent

Users reach for giant empty words precisely because they care intensely and don't know where to put it. The soul of de-slopping is conservation: every deleted "epic" must come back as a visible choice that holds the same caring. Strip a prompt without honoring the feeling that bloated it, and the user hears that their excitement was wrong.

## Visibility Test

Every major phrase should be visible to a camera, measurable by a light meter, audible in the mix, or observable as motion. If a phrase cannot pass that test, replace it with production language.

| Filler | Ask what it means | Strong replacement pattern |
|---|---|---|
| cinematic | What camera and light make it cinematic? | `locked close-up, warm practical key, cool rim light` |
| epic | What is the scale or stake? | `wide low-angle shot, tiny figure against storm wall` |
| beautiful | What color, texture, or light behavior? | `pearl highlights on wet ceramic, soft window bounce` |
| dynamic | What moves, how fast, and where does it end? | `fast lateral track ending on the hero label` |
| professional | What production setup? | `clean commercial tabletop, controlled reflection, no clutter` |

## The Six Slop Classes

Classify before rewriting — each class has a different repair:

1. **Empty evaluators** (`cinematic, epic, stunning`) — convert each to the one observable detail that earns it.
2. **Borrowed image-model tokens** (`8K, masterpiece, trending on ArtStation`) — delete; quality and resolution are settings, not prose.
3. **Tag salad** (comma keyword dumps ported from image prompting) — rewrite as shooting-brief prose: one sentence per element, with an action and a time axis.
4. **Negation slop** (`no blur, no artifacts, no extra fingers`) — negation summons; describe what IS there instead, and keep negation only in the constraint slot.
5. **Adjective stacking** (three synonyms for one quality) — pick the single detail that matters.
6. **Feel-suffix words** (`电影感, 雰囲気のある, 감성적인, atmosférico, атмосферный, vibey`) — name the physical cause of the feeling; every language file under `skills/_shared/references/vocab/` has a Slop Traps table for its own community's empty words.

## Rewrite Pass

First, underline all superlatives and vague style labels and classify each by slop class. Second, decide whether each word should become camera, light, motion, material, sound, or constraint language. Third, reduce duplicates. Fourth, keep the prompt within the target provider's character/token budget and preserve reference tags.

Load `[ref:anti-slop-lexicon]` for the slop-class taxonomy and extended replacement table, and `[skill:mf-vocab-en]` with `skills/_shared/references/vocab/en.md` for the full function-organized English precision vocabulary. For non-English prompts, load the matching vocab file's Slop Traps table (`skills/_shared/references/vocab/zh.md`, `ja.md`, `ko.md`, `es.md`, `ru.md`) — each language community has its own empty-quality words and decompositions.

## Do Not Over-Correct

Do not remove useful genre language when it is paired with concrete direction. `Noir hallway with hard venetian-blind shadows` is useful; `dramatic cinematic noir vibes` is not. Keep terms that communicate medium, era, palette, or lens behavior.

**Seedance-specific:** the `@ImageN`/`@VideoN`/`@AudioN` reference-binding tokens mentioned in examples below are Seedance 2.0's reference-fusion syntax (see `[skill:mf-video-prompt]`). Kling, Higgsfield, and Veo bind references differently — see `kling-prompting` and `higgsfield-prompting` for their equivalent mechanisms.

## Output Contract

Return removed words, replacements grouped by camera/light/motion/sound/constraint, and the tightened prompt.
