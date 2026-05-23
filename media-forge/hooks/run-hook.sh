#!/bin/sh
# POSIX entry — used when invoked from .sh hosts.
# Usage: run-hook.sh <hook-name>
HOOK_NAME="$1"
HOOK_DIR="$(dirname "$0")"
exec sh "$HOOK_DIR/$HOOK_NAME.sh" "$@"
