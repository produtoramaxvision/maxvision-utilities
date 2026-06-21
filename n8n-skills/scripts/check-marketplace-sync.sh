#!/usr/bin/env bash
# Assert the n8n-skills marketplace skills[] array exactly matches skills/ dirs.
# Usage: check-marketplace-sync.sh [marketplace.json] [skills_dir]
# Exit 0 = in sync, 1 = drift (prints the diff), 2 = bad input.
set -uo pipefail

MARKET="${1:-$(cd "$(dirname "$0")/../.." && pwd)/.claude-plugin/marketplace.json}"
# Default skills dir = sibling of this script's plugin root.
SKILLS_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)/skills}"

[ -f "$MARKET" ] || { echo "marketplace.json not found: $MARKET" >&2; exit 2; }
[ -d "$SKILLS_DIR" ] || { echo "skills dir not found: $SKILLS_DIR" >&2; exit 2; }

# Declared: skills[] basenames for the n8n-skills plugin.
declared="$(python3 -c '
import json,sys,os
d=json.load(open(sys.argv[1],encoding="utf-8"))
for p in d.get("plugins",[]):
    if p.get("name")=="n8n-skills":
        for s in p.get("skills",[]):
            print(os.path.basename(s.rstrip("/")))
' "$MARKET" | tr -d '\r' | sort)"

# Actual: directory names under skills/.
actual="$(find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | tr -d '\r' | sort)"

if [ "$declared" = "$actual" ]; then
  echo "[check-marketplace-sync] OK — $(echo "$actual" | grep -c .) skills in sync"
  exit 0
fi

echo "[check-marketplace-sync] DRIFT detected:" >&2
echo "--- only in marketplace.json ---" >&2
comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$actual") >&2
echo "--- only in skills/ dir ---" >&2
comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$actual") >&2
exit 1
