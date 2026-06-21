#!/usr/bin/env bash
# Original to this pack (not adapted from n8n-io/skills).
# Fires before n8n_autofix_workflow. Autofix mutates the live workflow; an
# applied fix can mask a real design problem or rewire a connection. One-shot.
exec "$(dirname "$0")/_emit.sh" "autofix" \
"Before autofixing: invoke n8n-validation-expert via the Skill tool. n8n_autofix_workflow rewrites node configs/connections to clear validation errors — do not trust it blindly. Prefer applyFixes=false first to preview the diff, fix the real cause when the error is a design mistake (wrong operation, missing field) rather than a mechanical one, then re-run validate_workflow AND n8n_get_workflow to inspect the connections object after applying. See also n8n-node-configuration."
