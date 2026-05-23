#!/bin/sh
# SubagentStart hook — emits context envelope JSON for the subagent.
# Reads CLAUDE_PROJECT_DIR + MEDIA_FORGE_JOB_ID (if set) to scope.
# Output: single-line JSON object on stdout.
set -eu

CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
JOB_ID="${MEDIA_FORGE_JOB_ID:-}"
JOB_DIR=""
if [ -n "$JOB_ID" ]; then
  JOB_DIR="$CLAUDE_PROJECT_DIR/.media-forge/jobs/$JOB_ID"
fi

# stdout MUST be a single JSON line. Use python if available for safe JSON encoding.
if command -v python >/dev/null 2>&1; then
  python -c "
import json, sys
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SubagentStart', 'additionalContext': {'projectDir': '$CLAUDE_PROJECT_DIR', 'jobId': '$JOB_ID', 'jobDir': '$JOB_DIR'}}}))
"
else
  # Fallback: emit JSON literal (escaping not perfect — assumes paths are safe)
  printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":{"projectDir":"%s","jobId":"%s","jobDir":"%s"}}}\n' \
    "$CLAUDE_PROJECT_DIR" "$JOB_ID" "$JOB_DIR"
fi
