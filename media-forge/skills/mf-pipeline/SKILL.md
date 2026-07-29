---
name: media-forge:mf-pipeline
description: "Use when the user asks about workflow operations, API planning, provider/router surfaces, China-facing surfaces, post-production, stitching, batch workflow, or integration planning around media-forge's video providers — with deep, Seedance-specific coverage of BytePlus ModelArk, Dreamina/Jimeng, and China-facing surfaces."
triggers:
  - "API workflow"
  - "batch pipeline"
  - "post-production stitching"
  - "provider integration"
  - "BytePlus"
  - "Dreamina"
allowedTools: [Read, Grep]
---

# media-forge:mf-pipeline

Use this for operational workflows, APIs, web surfaces, post-production, and integration planning. The workflow split, status discipline, and post-production items below are provider-agnostic; the platform-specific rows (Dreamina/Jimeng, Volcengine/BytePlus, Runway's `seedance2` model, China-facing surfaces) are **Seedance-specific** — media-forge's own Kling and Higgsfield integration paths are covered by `kling-prompting` and `higgsfield-prompting`, and Veo by the `veo-director` subagent.

## Intent

Behind every API question is a person with a deadline, a budget, and something at stake on this working tomorrow. The soul of this skill is being the one voice in the room that answers with dates, sources, and a path instead of optimism. Reliability is the kindness this user needs.

## Status Rule

Always load `[ref:api-status]` for current API and platform claims. Load `[ref:model-name-map]` when a user says Pro, Fast, V2, or a wrapper model ID. Do not rely on old release-status memory.
Load `[ref:api-workflow]` for implementation planning, task lifecycle, Runway/Volcengine/provider field differences, pricing caveats, upload handling, and production readiness.
Load `[ref:pro-filmmaking-standards]` for professional film, commercial, agency, localization, post, and delivery workflows. Load `[ref:delivery-qc]` before saying an asset is delivery-ready.

## Workflow Split

1. Web workflow (**Seedance-specific**): Dreamina/Jimeng surface, references, prompt, output review.
2. API workflow (**Seedance-specific**): Volcengine, BytePlus, Runway, fal, or provider/router docs, model ID, auth, file handling, task creation, polling/querying, cancellation/deletion, task ledger, and retrieval.
3. Professional production workflow (provider-agnostic): treatment, shot list, continuity ledger, reference rights map, review loop, post handoff, and delivery/QC.
4. Post workflow (provider-agnostic): edit, conform, stitching, stabilization, audio cleanup, captions/subtitles, color, localization, versioning, textless, and delivery.
5. First/last-frame workflow (provider-agnostic, mechanism varies): map first frame, last frame, transition action, identity locks, and ending target.
6. Runway workflow (**Seedance-specific**): model `seedance2`, `runway://` uploads, audio-reference combination rules, plan/region caveats, and SDK type lag.
7. Provider/router workflow (**Seedance-specific**): EvoLink, OpenRouter, Kie.ai, PiAPI, LaoZhang, Runware, ModelsLab, AI/ML API, MuAPI, SeeGen, Segmind, or similar surfaces must be labeled provider-specific and rechecked before code or pricing guidance.
8. China-facing workflow (**Seedance-specific**): prefer official ByteDance/Volcengine/BytePlus/Doubao/Jimeng/Jianying sources; workflow hosts, Chinese-language blogs, and business-partner news are not public API providers without provider-owned docs.
9. Community workflow (provider-agnostic): ComfyUI or unofficial nodes must be labeled community/unverified unless sourced.
10. Corpus-mining workflow (provider-agnostic): classify sources before reuse; extract structure and vocabulary, not unsafe raw prompts.

## Output Contract

Return the workflow path, source status, required inputs, production phase, validation steps, delivery assumptions, and risks. For professional jobs, include the next artifact to create: brief, shot list, continuity ledger, prompt batch, review packet, localization matrix, or QC preflight.
