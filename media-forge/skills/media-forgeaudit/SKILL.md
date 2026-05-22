---
name: media-forge:audit
description: "Audit a job's lineage: read metadata, trace, lineage, verdicts. Triggers: audit, lineage, verdict, history."
allowed-tools: Read, Write, Bash, Grep, Glob
preamble-tier: 1
user-invocable: true
---

# media-forge:audit

Job audit and lineage skill. Reads all metadata for a given job ID: trace entries, lineage chain, quality verdicts, cost breakdown, and model call log.

## Workflow

1. Receive job ID from $ARGUMENTS.
2. Locate job dir at `$CLAUDE_PROJECT_DIR/.media-forge/jobs/<jobId>/`.
3. Read `trace.jsonl`, `lineage.json`, `refined_spec.json`, and all verdict JSONs.
4. Summarize: agent chain, model calls, retry count, final verdict, total cost.
5. Display structured audit report to user.

## When to use

Invoke when user wants to inspect what happened in a previous generation job: which agents ran, what the quality scores were, how many retries occurred, and the total cost.

## Outputs

- Agent chain (ordered list of agents dispatched)
- Prompt evolution (initial brief → refined spec)
- Quality verdicts per attempt
- Retry count and root causes
- Total cost in USD
- Asset paths
