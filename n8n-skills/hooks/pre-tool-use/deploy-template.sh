#!/usr/bin/env bash
# Original to this pack (not adapted from n8n-io/skills).
# Fires before n8n_deploy_template. A template lands a whole workflow at once,
# including credential placeholders and possibly outdated node versions. One-shot.
exec "$(dirname "$0")/_emit.sh" "deploy-template" \
"Before deploying a template: invoke n8n-workflow-patterns and n8n-validation-expert via the Skill tool. Inspect get_template (mode:structure) first to understand what lands; confirm which credentials it expects and that they exist (n8n_manage_credentials list) — a template references credential TYPES, not your actual credentials. Keep autoFix and autoUpgradeVersions on unless you have a reason not to, then validate_workflow the deployed result before activating. Templates are starting points, not finished workflows."
