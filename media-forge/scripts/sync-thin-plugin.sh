#!/usr/bin/env bash
# sync-thin-plugin.sh
# Syncs declarative surface from plugin pesado -> plugin fino (media-forge-hosted).
# Usage: bash scripts/sync-thin-plugin.sh
# Run from: media-forge/
set -euo pipefail

SRC="."
DST="./plugins/media-forge-hosted"

sync_dir() {
  local src="$1" dst="$2" ext="${3:-*.md}"
  mkdir -p "$dst"
  for f in "$src"/$ext; do
    [ -f "$f" ] || continue
    cp -f "$f" "$dst/$(basename "$f")"
    echo "  synced: $(basename "$f")"
  done
}

echo "Syncing agents..."
sync_dir "$SRC/agents" "$DST/agents"

echo "Syncing commands..."
sync_dir "$SRC/commands" "$DST/commands"

echo "Syncing skills..."
for skill_dir in "$SRC/skills"/*/; do
  name=$(basename "$skill_dir")
  [[ "$name" == .* ]] && continue
  mkdir -p "$DST/skills/$name"
  if [ -f "$skill_dir/SKILL.md" ]; then
    cp -f "$skill_dir/SKILL.md" "$DST/skills/$name/SKILL.md"
    echo "  synced: $name/SKILL.md"
  fi
done

agents=$(find "$DST/agents" -name "*.md" | wc -l | tr -d ' ')
commands=$(find "$DST/commands" -name "*.md" | wc -l | tr -d ' ')
skills=$(find "$DST/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
echo "Done: $agents agents, $commands commands, $skills skills"
