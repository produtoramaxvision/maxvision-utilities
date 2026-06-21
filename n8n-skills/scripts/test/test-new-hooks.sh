#!/usr/bin/env bash
# Feed mock hook JSON to each new hook; assert it emits additionalContext once,
# and stays silent on the second call (one-shot dedup).
set -uo pipefail
HOOKS="$(cd "$(dirname "$0")/../../hooks/pre-tool-use" && pwd)"
fail=0
SID="test-$$-$RANDOM"
mock="{\"session_id\":\"$SID\",\"tool_name\":\"mcp__n8n-mcp__x\"}"

check() {
  local script="$1" needle="$2"
  local out1 out2
  out1="$(printf '%s' "$mock" | bash "$HOOKS/$script" 2>/dev/null)"
  out2="$(printf '%s' "$mock" | bash "$HOOKS/$script" 2>/dev/null)"
  if echo "$out1" | grep -q "$needle"; then echo "PASS: $script fires"; else echo "FAIL: $script no reminder"; fail=1; fi
  if [ -z "$out2" ]; then echo "PASS: $script deduped"; else echo "FAIL: $script fired twice"; fail=1; fi
}

check autofix-workflow.sh "autofix"
check deploy-template.sh "template"
exit $fail
