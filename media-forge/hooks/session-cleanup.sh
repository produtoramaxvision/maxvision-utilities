#!/bin/sh
# SessionEnd hook — removes stale tmp files under .media-forge/tmp/.
set -eu
TMP_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.media-forge/tmp"
if [ -d "$TMP_DIR" ]; then
  find "$TMP_DIR" -type f -mmin +60 -delete 2>/dev/null || true
fi
echo '{"continue":true}'
