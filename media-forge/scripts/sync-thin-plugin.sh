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

# Prune first. This script only ever copied, so a skill deleted or renamed at the
# source survived forever in the mirror — the hosted plugin kept advertising
# seedance-prompting after it became mf-video-prompt. Delete-then-copy keeps the
# mirror an actual mirror.
echo "Pruning skills removed from source..."
if [ -d "$DST/skills" ]; then
  for dst_skill in "$DST/skills"/*/; do
    [ -d "$dst_skill" ] || continue
    name=$(basename "$dst_skill")
    if [ ! -d "$SRC/skills/$name" ]; then
      rm -rf "$dst_skill"
      echo "  pruned: $name"
    fi
  done
fi

echo "Syncing skills..."
for skill_dir in "$SRC/skills"/*/; do
  name=$(basename "$skill_dir")
  [[ "$name" == .* ]] && continue
  # _shared carries references/ and schemas/, not a SKILL.md. Handled below as a
  # recursive copy; creating an empty dir for it here would litter the mirror.
  [[ "$name" == "_shared" ]] && continue
  mkdir -p "$DST/skills/$name"
  if [ -f "$skill_dir/SKILL.md" ]; then
    cp -f "$skill_dir/SKILL.md" "$DST/skills/$name/SKILL.md"
    echo "  synced: $name/SKILL.md"
  fi
done

# Shared assets the absorbed skills point at through [ref:...]. Without them the
# hosted plugin ships SKILL.md files whose references resolve to nothing.
# Recursive: carries references/, references/vocab/ and schemas/.
if [ -d "$SRC/skills/_shared" ]; then
  echo "Syncing shared skill assets (_shared)..."
  rm -rf "$DST/skills/_shared"
  mkdir -p "$DST/skills/_shared"
  cp -R "$SRC/skills/_shared/." "$DST/skills/_shared/"
  shared_files=$(find "$DST/skills/_shared" -type f | wc -l | tr -d ' ')
  echo "  synced: _shared ($shared_files files)"
fi

agents=$(find "$DST/agents" -name "*.md" | wc -l | tr -d ' ')
commands=$(find "$DST/commands" -name "*.md" | wc -l | tr -d ' ')
skills=$(find "$DST/skills" -mindepth 1 -maxdepth 1 -type d -not -name '_shared' | wc -l | tr -d ' ')
echo "Done: $agents agents, $commands commands, $skills skills"
