#!/usr/bin/env bash
# scripts/dev-launch.sh — dev workflow for media-forge plugin iteration
# Usage: ./scripts/dev-launch.sh
# Effect: rebuilds the plugin then launches Claude Code with --plugin-dir pointing here.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "[media-forge dev] Building plugin..."
pnpm exec tsup
echo "[media-forge dev] Launching Claude Code with --plugin-dir $(pwd)"
exec claude --plugin-dir "$(pwd)"
