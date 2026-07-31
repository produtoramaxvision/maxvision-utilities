# Surface Prompt Profiles

Use this reference to keep platform behavior surface-specific. Do not hardcode duration, prompt length, reference counts, tag syntax, edit support, extension support, audio behavior, regions, pricing, or authorization requirements as universal facts about any one provider.

media-forge routes four providers, so the profiles below are **filled**, not left as a template. Every number carries its source and verification date. Where a provider does not publish a value, the row says so explicitly and the conservative profile applies — an unverified number is worse than an admitted gap, because the model will trust it.

Enforced in code by `src/core/prompt-budget.ts`. The table below and that module must agree; `tests/unit/core/prompt-budget.test.ts` is the gate.

## Profile Fields

For the active surface, resolve:

- exact reference-tag convention;
- verified duration range;
- prompt budget;
- supported reference roles;
- timeline syntax;
- edit or extension availability;
- audio behavior;
- known constraints;
- source and verification date.

If the surface is unknown, state that the profile is conservative and avoid unsupported numbers.

---

## Kling (direct API) — verified 2026-07-30

Source: `kling.ai/document-api` via `context7-mcp` (`/websites/kling_ai_document-api`), pages `api/video/2-6`, `api/video/3-0-omni`, `api/video/o1`, `api/get-started/authentication`.

| Field | Value |
|---|---|
| Prompt budget | **2,500 characters** |
| Negative prompt | **2,500 characters**. Official advice: supplement negatives by writing negative sentences inside the positive prompt |
| Multi-shot | `multi_prompt`, **up to 6 storyboards**, **512 characters each**, durations must sum to the task total |
| Reference binding | `element_list` with `element_id`, **up to 3 elements**; `image_list` entries typed `first_frame` or `end_frame` |
| Voices | `voice_list`, **up to 2**. Mutually exclusive with `element_list` — they cannot coexist |
| Mode to resolution | `std` = 720P, `pro` = 1080P, `4k` = 4K |
| Domain | `https://api-singapore.klingai.com`. The old `api.klingai.com` was retired |
| Auth | `Authorization: Bearer <api-key>`, valid for all models. AccessKey/SecretKey + HS256 JWT is the legacy scheme, scoped by Kling to models 3.0 and earlier |

**Prompt shape — read this before trusting older guidance.** Kling publishes no
prescribed slot order. Its own documented examples lead with subject and action,
then mood, written as **multiple sentences separated by periods**:

> `"Two friends talking under a streetlight at night. Warm glow, casual poses, no dialogue."`
> `"A runner sprinting through a forest, leaves flying. Low-angle shot, focus on movement."`

`[skill:kling-prompting]` prescribes a camera-first comma stream instead. That is
field-derived craft, not a documented requirement — it is marked as such in that
skill. Either shape is within the 2,500-character budget.

## Higgsfield — verified 2026-07-30

Source: `docs.higgsfield.ai` via `context7-mcp` (`/llmstxt/higgsfield_ai_llms_txt`), pages `guides/video`, `guides/images`, `how-to/introduction`.

| Field | Value |
|---|---|
| Prompt budget | **not published**. Conservative profile applies |
| Negative prompt | **not published** |
| Reference binding | Soul ID for character identity; see `[skill:higgsfield-prompting]` |
| Endpoints | `POST /{model_id}` against `https://platform.higgsfield.ai`, e.g. `/higgsfield-ai/soul/standard` |
| Status | `GET /requests/{request_id}/status` |
| Auth | `Authorization: Key {api_key}:{api_secret}`, or the SDK's `hf-api-key` + `hf-secret` header pair. media-forge sends the SDK pair first and retries once with the REST form on 401/403 |

**Prompt shape is documented, and it leads with motion.** Higgsfield's "Writing
Effective Motion Prompts" says: describe the movement specifically, set the pace
("slowly", "smoothly"), specify camera movement explicitly, then add atmospheric
detail. Their own better-example is comma-separated and camera-first:

> `"Smooth cinematic camera pan from left to right, golden hour lighting, gentle wind rustling through leaves, shallow depth of field"`

This is why `[skill:higgsfield-prompting]`'s MCSLA order (Motion, Camera,
Subject, Lighting, Aesthetic) is grounded rather than invented.

**Latent conflict, guarded — not an active bug.** For *images*, Higgsfield's
"Writing Effective Prompts" recommends quality modifiers such as
`"highly detailed"` or `"8k"`. Slop class 2 in `[skill:mf-antislop]` deletes
exactly those as "borrowed image-model tokens".

They do not collide today: `mf-antislop` scopes itself to video prompts, and its
only invokers are `[skill:mf-video-prompt]` and `[skill:mf-troubleshoot]`, both
video. No image skill invokes it. So nothing currently strips a word Higgsfield
asks for.

Recorded because the obvious future consistency change — run anti-slop over image
prompts as well — would contradict one provider's published guidance. Do not
generalise anti-slop into a universal cross-provider rule.

**Higgsfield is also an aggregator.** It exposes other vendors' models under its
own paths — `/kling-video/v2.1/pro/image-to-video`,
`/bytedance/seedance/v1/pro/image-to-video`. So the same underlying model can be
reached either through media-forge's direct provider or through Higgsfield, at a
different price and against a different prompt contract. When the caller asked
for Kling specifically, use the direct Kling profile above, not this one.

## Google Veo — verified 2026-07-30

Source: `@google/genai` SDK reference via `context7-mcp` (`/websites/googleapis_github_io_js-genai`), `GenerateVideosConfig` and `GenerateVideosParameters`.

| Field | Value |
|---|---|
| Prompt budget | **not published** in the SDK reference. `prompt` is typed `string` with no stated bound. Conservative profile applies |
| Negative prompt | `negativePrompt`, supported, no published bound |
| Reference binding | `referenceImages`, each typed. **Veo 2: up to 3 asset images OR 1 style image** — not both. Incompatible with `image`, `video` and `lastFrame` |
| Resolution | `720p`, `1080p` |
| Aspect ratio | `16:9`, `9:16` |
| Person generation | `dont_allow`, `allow_adult` |
| Prompt rewriting | `enhancePrompt` exists and toggles Google's own prompt-rewriting logic |

**`enhancePrompt` is the field that matters for prompt craft.** When it is on,
Google rewrites the prompt before generating, which can undo a deliberate
Director Formula ordering. media-forge sets it explicitly — see
`src/core/prompt-budget.ts` — rather than inheriting an undocumented default.

## Seedance 2.0 (ByteDance) — default route verified 2026-07-31

| Field | Value |
|---|---|
| Prompt budget | **no published bound** on the fal.ai route. `ARK`-direct still unverified |
| Reference binding | `@Image1` / `@Video1` / `@Audio1` tokens in prompt order. Every uploaded reference must be @-mentioned or it is silently ignored |
| Multi-shot | supported |

fal.ai publishes an OpenAPI document per endpoint. For
`bytedance/seedance-2.0/text-to-video` — the slug the adapter actually submits to
— `prompt` is a plain `string` with no `maxLength` and no `minLength`, and no
other input string carries a length constraint. A generated schema beats a prose
page here: it is what the endpoint validates against.

So `promptMaxChars: null` no longer means "nobody checked". It means the surface
publishes no bound.

**Still open:** the `ARK`-direct route (`ark.ap-southeast.bytepluses.com`). Its
API reference could not be reached on 2026-07-31, so that surface is not covered
by the check above. Two platforms serve this model and they are not the same
publisher — one's schema does not speak for the other.

Do not copy Kling's 2,500 onto Seedance; they are unrelated platforms that
media-forge merely routes side by side.

---

## Conservative Generic Profile

Use when the surface is unknown, or when the profile above says a value is not
published or not verified:

- plan one compact generation-sized clip at a time;
- keep prompt concise;
- preserve exact user-supplied tags;
- avoid asserting native extend, prompt limits, or reference counts;
- ask for the actual clip or final frame before continuation;
- prefer role-bound references over unsupported feature claims.

## Volatile Claim Rule

For current model names, pricing, upload limits, reference counts, regions,
endpoint names, or authorization requirements, load source-gated references and
verify with dated primary sources before making operational claims.

Every filled row above records its source and date for exactly this reason. When
a row ages past usefulness, re-verify it rather than trusting it.
