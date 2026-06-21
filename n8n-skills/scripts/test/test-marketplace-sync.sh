#!/usr/bin/env bash
# Test harness for check-marketplace-sync.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/n8n-skills/scripts/check-marketplace-sync.sh"
fail=0

# Case 1: real repo must pass (exit 0)
if "$SCRIPT" "$ROOT/.claude-plugin/marketplace.json" "$ROOT/n8n-skills/skills"; then
  echo "PASS: real repo in sync"
else
  echo "FAIL: real repo reported out of sync"; fail=1
fi

# Case 2: broken fixture must fail (exit 1)
tmp="$(mktemp -d)"
python3 -c '
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
for p in d.get("plugins",[]):
    if p.get("name")=="n8n-skills":
        p["skills"]=p["skills"][:-1]  # drop one entry -> out of sync
json.dump(d,open(sys.argv[2],"w",encoding="utf-8"))
' "$ROOT/.claude-plugin/marketplace.json" "$tmp/marketplace.json"
if "$SCRIPT" "$tmp/marketplace.json" "$ROOT/n8n-skills/skills"; then
  echo "FAIL: broken fixture reported in sync"; fail=1
else
  echo "PASS: broken fixture detected"
fi
rm -rf "$tmp"
exit $fail
