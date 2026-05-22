---
name: media-forge:create
description: "Main orchestrator. Refines user brief, routes to domain agent, runs reviewer, surfaces verdict. Triggers: create, generate, make, produce."
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:create

Main orchestration skill. Accepts a user brief and manages the full pipeline: refinement, domain routing, generation, quality review, and retry.

## Workflow

1. Dispatch `media-forge:prompt-engineer` with user brief. Receive `refined_spec.json`.
2. Read `refined_spec.domain` to select the target domain agent.
3. Dispatch the domain agent with `refined_spec.json` path. Receive asset paths.
4. Dispatch `media-forge:quality-reviewer` with asset paths. Receive verdict JSON.
5. If `verdict.pass === false` and retry count < 3: dispatch `verdict.fix_target_agent` with `verdict.fix_directive`. Go to step 4.
6. Return final asset paths, lineage, and verdict to user.

## When to use

Invoke when the user wants to generate any image or video. This is the primary entry point. It handles all routing internally.

## Outputs

- Final asset file paths
- `lineage.json`: chain of agents, prompts, model calls, and verdicts
- Cost summary in USD
- Quality verdict (pass/fail + scores)
