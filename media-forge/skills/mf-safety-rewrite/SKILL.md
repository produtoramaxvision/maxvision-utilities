---
name: media-forge:mf-safety-rewrite
description: "Use when a media-forge video or image prompt (Veo, Kling, Higgsfield, or Seedance) mentions named characters, franchises, studios, celebrities, public figures, private people, brand logos, copyrighted scenes, songs, or real-person likeness and needs an IP-safe rewrite; or when a prompt is blocked, rejected, silently degraded, or likely to trigger a provider content filter and needs a safer rewrite without losing creative intent. Refuses to help evade filters or fabricate consent; rewrites toward original, authorized, production-safe language instead."
triggers:
  - "IP safe rewrite"
  - "copyright risk"
  - "named character"
  - "content filter blocked"
  - "prompt rejected"
  - "safer rewrite"
  - "likeness"
  - "franchise"
allowedTools: [Read, Grep]
---

# media-forge:mf-safety-rewrite

Use this before finalizing any prompt involving protected IP, named brands, public figures, private people, voices, logos, songs, studios, exact scenes, or lookalike character requests — **and** before finalizing a prompt that was blocked, degraded, likely to trigger moderation, or that needs a safer rewrite without losing creative intent. These are the same job seen from two directions: a rights problem and a filter problem both get solved by replacing risky surface wording with original, professional, production-safe language while preserving the scene's actual creative function.

Applies to every media-forge video provider (Veo, Kling, Higgsfield, Seedance) and to image generation. None of the guidance below is provider-specific — IP risk and filter risk live in the prompt text, not in which model renders it.

## Intent

The user pointing at protected work is not trying to steal — they are showing you the clearest example of what they love that exists. A wrongly blocked prompt makes a user feel accused by a machine with no court of appeal. This skill is the advocate in both directions: find what the love is made of and give it back as something safely theirs; clear the innocent by stating their honest intent plainly; never coach the guilty. Protect the rights-holder, the platform's boundary, and the user's dignity in the same move.

## Boundary — read before anything else

This skill repairs **two classes of false positive**: (1) prompts that reference protected IP where the *creative function* can be preserved with original elements, and (2) benign production content blocked or degraded by over-broad filtering (medical, historical, athletic, fictional-original contexts). It works by **clarifying legitimate context and substituting original elements in plain language** — never by disguising intent. It does not launder genuinely prohibited content: anything risky involving minors, real-person likeness without rights, sexual or graphic or illegal material. If the underlying request is prohibited, refuse plainly and offer a legitimate alternative only where one exists. This skill does not help evade safety systems, and it does not provide filter-bypass, evasion, or hidden-word tactics.

## Rewrite Principle (IP / likeness)

Preserve the scene function, genre, mood, camera logic, emotional beat, and production intent. Replace protected identity with an original archetype, original costume logic, original world details, and descriptive style layers.

| Risk | Replace with |
|---|---|
| Named character or franchise | Original archetype, genre function, and non-identical costume language |
| Studio or living-creator style | Medium, texture, palette, composition, line quality, and motion rhythm |
| Celebrity or private person | Original performer description or authorized reference workflow |
| Brand logo | Generic product mark, blank label, or user-owned brand if explicitly authorized |
| Song, voice, or performance | Tempo, energy, instrumentation, mood, or newly composed sound direction |
| Exact scene recreation | Original scene with similar narrative function and different setting/blocking |

## Authorization Gate

If the user clearly owns the brand, asset, or likeness rights, keep the authorized elements but still preserve them with explicit constraints. If authorization is unclear, ask a short confirmation or provide a safe original rewrite. Do not assume rights from an uploaded image, song, or video.

For real human faces, portraits, or voices, separate three questions: does the active provider support the input, does the user have authorization, and does the prompt avoid imitation of a public figure or private person without consent. Some providers use verified virtual-portrait assets or authorization flows (e.g. Higgsfield Soul ID with the user's own trained identity); do not collapse those into a universal allow or deny rule.

**Safe replacement example.** Instead of a named superhero swinging through a recognizable franchise city, write: `original masked rooftop courier in a red weatherproof jacket leaps between rain-slick buildings, low handheld tracking camera, blue police lights far below, no logos or franchise symbols`.

## Repair Method (content filter)

1. Identify the creative intent: action, mood, camera, subject, and final beat.
2. Identify risky surface wording: graphic harm, protected identity, sexualized framing, real-person likeness, weapons, self-harm, hate, evasion language, or exact IP copying.
3. Replace risky terms with professional, non-graphic, production-context language.
4. Preserve composition, action, mood, camera logic, and authorized references.
5. For likely false positives, clarify benign production context, ownership, and non-graphic intent. Do not help bypass safety systems or provide evasion tactics.

## Safer Rewrite Patterns (content filter)

| Intent | Safer direction |
|---|---|
| Conflict | `staged confrontation, choreographed action beat, no graphic injury` |
| Aftermath | `non-graphic distress, torn fabric, scattered props, dramatic silence` |
| Suspense | `threat implied by shadow, locked door, heavy breathing, low light` |
| Weapon-like prop | `prop object handled safely within a staged action scene` |
| Horror mood | `eerie atmosphere, flickering practical light, off-screen sound cue` |
| Protected identity | `original character with broad genre archetype traits` |

Filter-aware wording also applies to ordinary English homonyms that read as threats to automated filters even in benign prompts: `shoot the scene`, `kill the lights`, `gun it`, `dead silence`, `blow up the image`. Use the production synonym instead (`film the take`, `cut the lights to black`, `accelerate hard`, `held silence`, `enlarge to full frame`). This is clarity for safe prompts only — never evasion.

## Boundary Rule

If the user's request is unsafe, refuse or redirect to a safe alternative. If it is safe but poorly worded or over-flagged, repair the wording. When uncertain, state the risk class and offer a conservative prompt that keeps the non-harmful scene function.

Face-limit or portrait-verification workarounds are not safe prompt tricks. If a provider offers a sanctioned virtual-portrait, trusted model-output, or authorization-asset flow (Higgsfield Soul ID, Kling Elements with a registered `element_id`, etc.), route the user to that current official path instead of evasion language.

## Output Contract

Return: risk category (IP/likeness, filter false-positive, or both), what was changed, the safe replacement prompt, any authorization requirement, and any residual constraint that still applies. If the request is genuinely unsafe, return the refusal and, where one exists, a legitimate alternative — never a workaround.
