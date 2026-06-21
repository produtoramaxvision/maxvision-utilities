---
description: "Audit a job's lineage: agents, prompts, verdicts, cost"
argument-hint: "<jobId>"
allowed-tools: Read, Write, Bash, Grep, Glob
---

# /media-forge:audit

Job audit and lineage inspection. Takes a job ID and displays the complete history: agent chain, prompt evolution, quality verdicts, retry count, and cost breakdown.

## Instructions

1. Take the job ID from $ARGUMENTS.
2. Invoke the `media-forge:audit` skill with the job ID.
3. Display the structured audit report:
   - Agent chain (in execution order)
   - Prompt: initial brief → refined spec
   - Quality verdicts per attempt (scores + error classes)
   - Retry count and root causes
   - Total cost in USD
   - Final asset paths
4. If job ID is not found, explain the expected job directory location.
