---
name: media-forge:mf-ugc-hooks
description: "Use when the user needs an opening that stops the scroll — a hook for a UGC ad, reel, short or TikTok. Covers Higgsfield's nine built-in hook presets and how to write one when none of them fits."
triggers:
  - "hook for my ad"
  - "opening that stops the scroll"
  - "first 3 seconds"
  - "viral hook"
  - "which hook should I use"
allowedTools: [Read, Grep]
---

# media-forge:mf-ugc-hooks

The first three seconds decide whether the rest exists. This covers picking one
of Higgsfield's built-in hooks, and writing one when none of them fits.

## Intent

A hook works by leaving something unresolved — an interrupted action, an object
that should not be there, a claim without its evidence yet. It does not work by
being loud. Most bad hooks are loud and complete: they show the whole idea in
second one, and there is nothing left to stay for.

Do not promise engagement numbers. Multipliers attached to hook formulas
circulate widely and none of them are measured on the user's account; quoting
them in a product that bills is a liability, and the user will find out.

## The nine that already exist

`media_higgsfield_ms_assets { kind: "hooks" }` returns these from the signed-in
account, with the full prompt text and a `hook_id` that
`media_higgsfield_marketing_studio` takes directly. Read them before writing one
by hand — a preset carries a motion the model already renders well.

| Hook | The unresolved thing | Fits |
|---|---|---|
| **Product Hit** | Object flies in and strikes the subject; brief reaction, then pivot to product | Impact demos, durability, "you need this" |
| **Product Dodge** | Product flies at the face, subject ducks | Speed, reflex, playful physicality |
| **Product Crash** | The product falls and is destroyed; chaos resolves into a pitch | Toughness, replacement, before/after |
| **Camera Bump** | Operator collides with someone, brief reaction, continue | Accidental-footage credibility |
| **Random Object Mic** | An absurd object drops into their hand mid-vlog | Surreal, comedic, meme-native |
| **Epic Fail** | A backflip goes wrong; recovery without a cut | Self-deprecating, high-retention |
| **Interview** | A stranger answers based on a previous stranger's answer | Man-on-street, opinion products |
| **Blizzard** | An impossible blizzard hits an indoor scene | Cold products, contrast, spectacle |
| **Spicy** | Extreme close-up tilting up to reveal | Beauty, apparel, sensory products |

Pick by the **tension**, not the vibe. The hook has to end pointing at the
product, and a hook whose motion has nothing to do with the pitch reads as two
videos stapled together.

## Writing one when none fits

Four shapes that hold up, all built on the same mechanic:

- **Interrupted action** — start mid-motion, resolve after the product appears.
- **Wrong object** — something present that does not belong; the product
  explains it.
- **Claim without evidence** — say the outcome first, prove it in beat two.
- **Visible mess** — a problem on screen before anything is said about it.

Constraints that make a hook renderable rather than just clever:

- **Under 3 seconds, and one beat.** Two beats is not a hook, it is the video.
- **Visually verifiable.** If the hook is a feeling, the model cannot render it.
  "Frustrated" is not a shot; "shoves the drawer shut twice" is.
- **No greeting.** "Hey guys", "in this video", "let me show you" — the scroll
  already left.
- **Ends pointing at the product**, not at a topic.

## Then

- The hook belongs in the HOOK line of `[skill:mf-ugc-brief]`.
- `[skill:mf-ugc-script]` writes the beats that follow it.
- Run `[skill:mf-antislop]` over any hook copy — hook writing is where generic
  phrasing concentrates.
