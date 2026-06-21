#!/usr/bin/env bash
# Compare the pinned upstream commit (.upstream-pin) against czlonkowski/n8n-skills HEAD.
# Exit 0 = in parity, 3 = upstream advanced (prints delta), 2 = bad input/network.
# Requires: gh (authenticated).
set -uo pipefail

PIN_FILE="${1:-$(cd "$(dirname "$0")/.." && pwd)/.upstream-pin}"
[ -f "$PIN_FILE" ] || { echo ".upstream-pin not found: $PIN_FILE" >&2; exit 2; }

repo="$(grep -E '^repo=' "$PIN_FILE" | cut -d= -f2)"
pinned="$(grep -E '^commit=' "$PIN_FILE" | cut -d= -f2)"
[ -n "$repo" ] && [ -n "$pinned" ] || { echo "malformed .upstream-pin" >&2; exit 2; }

command -v gh >/dev/null 2>&1 || { echo "gh CLI required" >&2; exit 2; }

head_sha="$(gh api "repos/$repo/commits/main" --jq '.sha' 2>/dev/null | cut -c1-7)" || {
  echo "failed to query $repo HEAD (network/auth?)" >&2; exit 2; }

if [ "$head_sha" = "$pinned" ]; then
  echo "[check-upstream-drift] OK — pinned $pinned == $repo HEAD"
  exit 0
fi

echo "[check-upstream-drift] UPSTREAM ADVANCED: pinned=$pinned HEAD=$head_sha" >&2
echo "--- commits since pin ---" >&2
gh api "repos/$repo/compare/$pinned...$head_sha" --jq '.commits[].commit.message' 2>/dev/null | sed 's/^/  /' | head -40 >&2
echo "Review changes, sync skills verbatim, then bump .upstream-pin." >&2
exit 3
