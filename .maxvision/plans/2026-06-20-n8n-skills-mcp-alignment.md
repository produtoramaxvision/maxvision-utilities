# n8n-skills ↔ czlonkowski/n8n-mcp Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) or maxvision:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom n8n MCP server with `czlonkowski/n8n-mcp` (npx, online, pointed at the VPS), revive and complete the dead hooks enforcement layer, and add anti-drift guards — so the n8n-skills plugin runs at full quality with zero degradation.

**Architecture:** Repo-side work (Phases A–C) is fully testable in-session and committed incrementally. The MCP config swap (Phase D) edits `~/.claude.json`. Hook revival + live validation (Phase E) requires a Claude Code session restart (CC does not hot-reload MCP servers), so it is executed by the main thread / user, not a subagent. Optional destructive cleanup (Phase F) is gated on explicit confirmation.

**Tech Stack:** bash hooks (`_emit.sh` one-shot pattern), `jq`/`python3`, `gh` CLI, npx, Claude Code MCP config (`~/.claude.json`), n8n public REST API.

**Spec:** `.maxvision/specs/2026-06-20-n8n-skills-mcp-alignment-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `n8n-skills/.upstream-pin` | Single source of truth for the pinned upstream commit + version | Create |
| `n8n-skills/scripts/check-marketplace-sync.sh` | Assert `marketplace.json` skills[] == `skills/` dirs | Create |
| `n8n-skills/scripts/check-upstream-drift.sh` | Compare pinned upstream commit vs `czlonkowski/n8n-skills` HEAD | Create |
| `n8n-skills/scripts/test/test-marketplace-sync.sh` | Test harness for the sync checker (pass + deliberately-broken fixture) | Create |
| `n8n-skills/scripts/test/test-new-hooks.sh` | Test harness: feed mock JSON stdin, assert reminder emitted | Create |
| `n8n-skills/hooks/pre-tool-use/autofix-workflow.sh` | PreToolUse reminder for `n8n_autofix_workflow` | Create |
| `n8n-skills/hooks/pre-tool-use/deploy-template.sh` | PreToolUse reminder for `n8n_deploy_template` | Create |
| `n8n-skills/hooks/hooks.json` | Wire 2 new matchers; conditionally remove `n8n_instances` | Modify |
| `n8n-skills/.claude-plugin/plugin.json` | Version bump 0.2.0 → 0.3.0 | Modify |
| `n8n-skills/CHANGELOG.md` | 0.3.0 entry | Modify |
| `~/.claude.json` | Replace `n8n-mcp` server entry (custom → czlonkowski) | Modify (outside repo) |

**Convention note:** existing hook scripts carry the Apache-2.0 adaptation header (3 comment lines + `See /NOTICES.`). The 2 NEW hooks are original to this pack (not adapted from n8n-io/skills) — they get a plain authorship comment, NOT the Apache header. This keeps NOTICES-UPSTREAM accurate.

---

## Phase A — Setup

### Task 1: Working branch

**Files:** none (git only)

- [ ] **Step 1: Confirm clean tree on homolog and branch**

```bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
test "$(git branch --show-current)" = "homolog" || { echo "Not on homolog"; exit 1; }
git checkout -b feat/n8n-mcp-alignment
```

Expected: switched to new branch `feat/n8n-mcp-alignment`.

---

## Phase B — Anti-drift guards (pure, testable, no restart needed)

### Task 2: Upstream pin file

**Files:**
- Create: `n8n-skills/.upstream-pin`

- [ ] **Step 1: Create the pin file**

```
repo=czlonkowski/n8n-skills
commit=29d3c31
version=v1.21.0
```

Write exactly those 3 lines to `n8n-skills/.upstream-pin`.

- [ ] **Step 2: Commit**

```bash
set -euo pipefail
git add n8n-skills/.upstream-pin
git commit -m "chore(n8n-skills): pin upstream commit for drift detection"
```

### Task 3: Marketplace-sync checker

**Files:**
- Create: `n8n-skills/scripts/check-marketplace-sync.sh`
- Test: `n8n-skills/scripts/test/test-marketplace-sync.sh`

- [ ] **Step 1: Write the failing test**

Create `n8n-skills/scripts/test/test-marketplace-sync.sh`:

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash n8n-skills/scripts/test/test-marketplace-sync.sh`
Expected: FAIL — script does not exist yet (`No such file`).

- [ ] **Step 3: Write the checker**

Create `n8n-skills/scripts/check-marketplace-sync.sh`:

```bash
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
' "$MARKET" | sort)"

# Actual: directory names under skills/.
actual="$(find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)"

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash n8n-skills/scripts/test/test-marketplace-sync.sh`
Expected output (all PASS):
```
PASS: real repo in sync
PASS: broken fixture detected
```

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
chmod +x n8n-skills/scripts/check-marketplace-sync.sh n8n-skills/scripts/test/test-marketplace-sync.sh
git add n8n-skills/scripts/check-marketplace-sync.sh n8n-skills/scripts/test/test-marketplace-sync.sh
git commit -m "feat(n8n-skills): add marketplace-sync drift checker + test"
```

### Task 4: Upstream-drift checker

**Files:**
- Create: `n8n-skills/scripts/check-upstream-drift.sh`

- [ ] **Step 1: Write the checker**

Create `n8n-skills/scripts/check-upstream-drift.sh`:

```bash
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
```

- [ ] **Step 2: Run against current repo (should report parity)**

Run: `bash n8n-skills/scripts/check-upstream-drift.sh`
Expected: `[check-upstream-drift] OK — pinned 29d3c31 == czlonkowski/n8n-skills HEAD`
(If upstream has since advanced, expect exit 3 with the commit delta — that is correct behavior, not a failure of the script.)

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
chmod +x n8n-skills/scripts/check-upstream-drift.sh
git add n8n-skills/scripts/check-upstream-drift.sh
git commit -m "feat(n8n-skills): add upstream-drift checker against pinned commit"
```

---

## Phase C — Hook coverage gaps (new hooks, testable in-session)

### Task 5: autofix-workflow + deploy-template hooks

**Files:**
- Create: `n8n-skills/hooks/pre-tool-use/autofix-workflow.sh`
- Create: `n8n-skills/hooks/pre-tool-use/deploy-template.sh`
- Test: `n8n-skills/scripts/test/test-new-hooks.sh`

- [ ] **Step 1: Write the failing test**

Create `n8n-skills/scripts/test/test-new-hooks.sh`:

```bash
#!/usr/bin/env bash
# Feed mock hook JSON to each new hook; assert it emits additionalContext once,
# and stays silent on the second call (one-shot dedup).
set -uo pipefail
HOOKS="$(cd "$(dirname "$0")/../../hooks/pre-tool-use" && pwd)"
fail=0
SID="test-$$-$RANDOM"
mock="{\"session_id\":\"$SID\",\"tool_name\":\"mcp__n8n-mcp__x\"}"

check() {
  local script="$1" needle="$2"
  local out1 out2
  out1="$(printf '%s' "$mock" | bash "$HOOKS/$script" 2>/dev/null)"
  out2="$(printf '%s' "$mock" | bash "$HOOKS/$script" 2>/dev/null)"
  if echo "$out1" | grep -q "$needle"; then echo "PASS: $script fires"; else echo "FAIL: $script no reminder"; fail=1; fi
  if [ -z "$out2" ]; then echo "PASS: $script deduped"; else echo "FAIL: $script fired twice"; fail=1; fi
}

check autofix-workflow.sh "autofix"
check deploy-template.sh "template"
exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash n8n-skills/scripts/test/test-new-hooks.sh`
Expected: FAIL — hook scripts do not exist yet.

- [ ] **Step 3: Write `autofix-workflow.sh`**

Create `n8n-skills/hooks/pre-tool-use/autofix-workflow.sh`:

```bash
#!/usr/bin/env bash
# Original to this pack (not adapted from n8n-io/skills).
# Fires before n8n_autofix_workflow. Autofix mutates the live workflow; an
# applied fix can mask a real design problem or rewire a connection. One-shot.
exec "$(dirname "$0")/_emit.sh" "autofix" \
"Before autofixing: invoke n8n-validation-expert via the Skill tool. n8n_autofix_workflow rewrites node configs/connections to clear validation errors — do not trust it blindly. Prefer applyFixes=false first to preview the diff, fix the real cause when the error is a design mistake (wrong operation, missing field) rather than a mechanical one, then re-run validate_workflow AND n8n_get_workflow to inspect the connections object after applying. See also n8n-node-configuration."
```

- [ ] **Step 4: Write `deploy-template.sh`**

Create `n8n-skills/hooks/pre-tool-use/deploy-template.sh`:

```bash
#!/usr/bin/env bash
# Original to this pack (not adapted from n8n-io/skills).
# Fires before n8n_deploy_template. A template lands a whole workflow at once,
# including credential placeholders and possibly outdated node versions. One-shot.
exec "$(dirname "$0")/_emit.sh" "deploy-template" \
"Before deploying a template: invoke n8n-workflow-patterns and n8n-validation-expert via the Skill tool. Inspect get_template (mode:structure) first to understand what lands; confirm which credentials it expects and that they exist (n8n_manage_credentials list) — a template references credential TYPES, not your actual credentials. Keep autoFix and autoUpgradeVersions on unless you have a reason not to, then validate_workflow the deployed result before activating. Templates are starting points, not finished workflows."
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bash n8n-skills/scripts/test/test-new-hooks.sh`
Expected output:
```
PASS: autofix-workflow.sh fires
PASS: autofix-workflow.sh deduped
PASS: deploy-template.sh fires
PASS: deploy-template.sh deduped
```

- [ ] **Step 6: Commit**

```bash
set -euo pipefail
chmod +x n8n-skills/hooks/pre-tool-use/autofix-workflow.sh n8n-skills/hooks/pre-tool-use/deploy-template.sh n8n-skills/scripts/test/test-new-hooks.sh
git add n8n-skills/hooks/pre-tool-use/autofix-workflow.sh n8n-skills/hooks/pre-tool-use/deploy-template.sh n8n-skills/scripts/test/test-new-hooks.sh
git commit -m "feat(n8n-skills): add PreToolUse hooks for autofix + deploy-template"
```

### Task 6: Wire new matchers into hooks.json

**Files:**
- Modify: `n8n-skills/hooks/hooks.json`

- [ ] **Step 1: Add two PreToolUse matcher blocks**

In `n8n-skills/hooks/hooks.json`, inside `.hooks.PreToolUse[]`, add these two objects (after the existing `n8n_manage_credentials` block, before the array closes):

```json
{
  "matcher": "^mcp__.*__n8n_autofix_workflow$",
  "hooks": [
    {
      "type": "command",
      "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use/autofix-workflow.sh"
    }
  ]
},
{
  "matcher": "^mcp__.*__n8n_deploy_template$",
  "hooks": [
    {
      "type": "command",
      "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use/deploy-template.sh"
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run: `python3 -c "import json; json.load(open('n8n-skills/hooks/hooks.json')); print('valid json')"`
Expected: `valid json`

- [ ] **Step 3: Assert both new matchers present**

Run:
```bash
python3 -c "
import json
h=json.load(open('n8n-skills/hooks/hooks.json'))
ms=[b['matcher'] for b in h['hooks']['PreToolUse']]
assert any('n8n_autofix_workflow' in m for m in ms), 'autofix matcher missing'
assert any('n8n_deploy_template' in m for m in ms), 'deploy matcher missing'
print('both matchers wired')
"
```
Expected: `both matchers wired`

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
git add n8n-skills/hooks/hooks.json
git commit -m "feat(n8n-skills): wire autofix + deploy-template hook matchers"
```

### Task 7: Version bump + changelog

**Files:**
- Modify: `n8n-skills/.claude-plugin/plugin.json`
- Modify: `n8n-skills/CHANGELOG.md`

- [ ] **Step 1: Bump version**

In `n8n-skills/.claude-plugin/plugin.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 2: Add changelog entry**

In `n8n-skills/CHANGELOG.md`, insert directly below the `# Changelog` header block (above `## [0.2.0]`):

```markdown
## [0.3.0] - 2026-06-20

Plugin retargeted to its native MCP server (`czlonkowski/n8n-mcp`); enforcement layer completed.

### Added

- PreToolUse hooks `autofix-workflow.sh` and `deploy-template.sh` — close coverage gaps for `n8n_autofix_workflow` and `n8n_deploy_template` (original to this pack, not adapted from upstream).
- `scripts/check-marketplace-sync.sh` — asserts `marketplace.json` skills[] matches `skills/` dirs.
- `scripts/check-upstream-drift.sh` + `.upstream-pin` — detects when `czlonkowski/n8n-skills` advances past the pinned commit.

### Changed

- Hook matchers verified 1:1 against `czlonkowski/n8n-mcp` v2.59.2 tool names.

### Removed

- (Conditional) `pre-tool-use/instances.sh` + its matcher, if `n8n_instances` is confirmed absent from the live tool surface. See Phase E.
```

- [ ] **Step 3: Run sync check to confirm no regression**

Run: `bash n8n-skills/scripts/check-marketplace-sync.sh`
Expected: `[check-marketplace-sync] OK — 15 skills in sync`

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
git add n8n-skills/.claude-plugin/plugin.json n8n-skills/CHANGELOG.md
git commit -m "chore(n8n-skills): bump to 0.3.0 + changelog"
```

---

## Phase D — MCP config migration (`~/.claude.json`, outside repo)

> Editing `~/.claude.json` does not take effect until the Claude Code session restarts. Do Phase D, then restart, then Phase E.

### Task 8: Swap the n8n-mcp server entry

**Files:**
- Modify: `~/.claude.json` (`.mcpServers["n8n-mcp"]`)

- [ ] **Step 1: Back up the config**

```bash
set -euo pipefail
cp ~/.claude.json ~/.claude.json.bak-n8n-migration
echo "backup at ~/.claude.json.bak-n8n-migration"
```

- [ ] **Step 2: Capture the current API key from the custom server source**

```bash
set -euo pipefail
KEY="$(grep -oE "N8N_KEY = '[^']+'" "/c/Users/MaxVision/Desktop/cursor-oficial/agente-maxvision/mcp-servers/n8n/src/index.ts" | sed "s/N8N_KEY = '//; s/'//")"
test -n "$KEY" || { echo "key not found"; exit 1; }
echo "key captured (len ${#KEY})"
```

(Note: this JWT is already exposed — rotation is adjacent task A, deferred. Reusing it preserves current functionality.)

- [ ] **Step 3: Replace the server entry**

```bash
set -euo pipefail
python3 - "$KEY" <<'PY'
import json, sys, os
key = sys.argv[1]
p = os.path.expanduser("~/.claude.json")
d = json.load(open(p, encoding="utf-8"))
servers = d.get("mcpServers", d)
servers["n8n-mcp"] = {
    "command": "npx",
    "args": ["-y", "n8n-mcp"],
    "env": {
        "N8N_API_URL": "https://n8n.meuagente.api.br/api/v1",
        "N8N_API_KEY": key,
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "error",
        "DISABLE_CONSOLE_OUTPUT": "true"
    }
}
json.dump(d, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("n8n-mcp entry replaced (custom -> czlonkowski npx)")
PY
```

- [ ] **Step 4: Validate the edited config is still valid JSON and points to npx**

```bash
set -euo pipefail
python3 -c "
import json,os
d=json.load(open(os.path.expanduser('~/.claude.json'),encoding='utf-8'))
s=d.get('mcpServers',d)['n8n-mcp']
assert s['command']=='npx', s
assert 'n8n-mcp' in s['args'], s
assert s['env']['N8N_API_URL'].endswith('/api/v1'), s
assert 'dist/index.js' not in json.dumps(s), 'custom path residue!'
print('config valid, custom server fully removed from entry')
"
```
Expected: `config valid, custom server fully removed from entry`

- [ ] **Step 5: Smoke-test the package resolves (does not need restart)**

```bash
set -euo pipefail
npx -y n8n-mcp --version 2>&1 | head -3 || echo "npx will fetch on first session start"
```
Expected: a version string (e.g. `2.59.2`) or a benign fetch message. A non-zero here only means cold cache; it resolves at session start.

**No commit** — `~/.claude.json` is outside the repo.

### Task 9: RESTART CHECKPOINT

- [ ] **Step 1: Restart the Claude Code session**

This is a manual, main-thread action — a subagent cannot perform it. Fully quit and reopen the Claude Code session so `~/.claude.json` is re-read and `n8n-mcp` (czlonkowski) loads. Then continue at Phase E.

Expected after restart: the tool list shows English `mcp__n8n-mcp__*` tools (`get_node`, `search_nodes`, `validate_workflow`, `n8n_create_workflow`, ...) instead of the Portuguese custom ones.

---

## Phase E — Live validation + dead-hook cleanup (post-restart, main thread)

### Task 10: Confirm the 3 capability classes are live

**Files:** none (live MCP calls)

- [ ] **Step 1: Management half (VPS)**

Call `mcp__n8n-mcp__n8n_health_check` (or `n8n_list_workflows`).
Expected: healthy status / the VPS workflow list (same data the custom server returned).

- [ ] **Step 2: Discovery/docs half (embedded DB)**

Call `mcp__n8n-mcp__get_node` with `{"nodeType": "nodes-base.httpRequest"}`.
Expected: node schema returned from the bundled SQLite (operations, properties) — proves offline node-knowledge works without any local n8n.

- [ ] **Step 3: Validation half**

Pull one real workflow id from Step 1, then call `mcp__n8n-mcp__validate_workflow` against it.
Expected: a structured validation verdict (errors/warnings/valid).

### Task 11: Verify hooks fire + resolve n8n_instances

**Files:**
- Conditionally modify: `n8n-skills/hooks/hooks.json`, delete `n8n-skills/hooks/pre-tool-use/instances.sh`

- [ ] **Step 1: Confirm a PreToolUse hook fires**

Trigger a `get_node` call (Step 2 above already does). Confirm the injected reminder (n8n-node-configuration guidance) appears in context.
Expected: reminder text present → hooks are alive (they were 100% dead pre-migration).

- [ ] **Step 2: Check whether `n8n_instances` exists on the live surface**

Inspect the available `mcp__n8n-mcp__*` tools for `n8n_instances` (e.g. attempt `tools_documentation` with topic `n8n_instances`, or scan the tool list).
Record the result: PRESENT or ABSENT.

- [ ] **Step 3 (only if ABSENT): Remove the dead instances hook**

```bash
set -euo pipefail
rm n8n-skills/hooks/pre-tool-use/instances.sh
python3 - <<'PY'
import json
p="n8n-skills/hooks/hooks.json"
h=json.load(open(p,encoding="utf-8"))
before=len(h["hooks"]["PreToolUse"])
h["hooks"]["PreToolUse"]=[b for b in h["hooks"]["PreToolUse"] if "n8n_instances" not in b["matcher"]]
json.dump(h,open(p,"w",encoding="utf-8"),indent=2,ensure_ascii=False)
print(f"removed {before-len(h['hooks']['PreToolUse'])} matcher(s)")
PY
git add -A n8n-skills/hooks
git commit -m "fix(n8n-skills): remove dead n8n_instances hook (absent in n8n-mcp v2.59.2)"
```

- [ ] **Step 4 (only if PRESENT): Leave instances hook intact**

No action. Note in the PR description that `n8n_instances` was confirmed live and the hook was retained.

### Task 12: Final guard run + open PR

**Files:** none (CI/PR)

- [ ] **Step 1: Run both guards**

```bash
set -euo pipefail
bash n8n-skills/scripts/check-marketplace-sync.sh
bash n8n-skills/scripts/check-upstream-drift.sh || true   # exit 3 = upstream advanced, informational
```
Expected: sync check OK; drift check OK (or an informational exit 3 listing new upstream commits).

- [ ] **Step 2: Push and open PR**

```bash
set -euo pipefail
git push -u origin feat/n8n-mcp-alignment
gh pr create --base homolog --title "feat(n8n-skills): align plugin to czlonkowski/n8n-mcp + complete hooks layer" \
  --body "Migrates n8n MCP from the custom PT API-wrapper to czlonkowski/n8n-mcp (npx, VPS). Revives the dead hooks layer, adds autofix/deploy-template hooks, and adds marketplace-sync + upstream-drift guards. See .maxvision/specs/2026-06-20-n8n-skills-mcp-alignment-design.md."
```

---

## Phase F — Optional destructive cleanup (explicit confirmation required)

### Task 13: Delete the orphaned custom server directory

> Destructive. Do NOT run without the user explicitly confirming. The directory is a separate project, not part of this repo.

- [ ] **Step 1: Confirm intent with the user**

Ask: "Delete `C:/Users/MaxVision/Desktop/cursor-oficial/agente-maxvision/mcp-servers/n8n/` entirely? It is no longer referenced by any MCP config. (y/N)"

- [ ] **Step 2 (only on explicit yes): Remove the directory**

```bash
set -euo pipefail
TARGET="/c/Users/MaxVision/Desktop/cursor-oficial/agente-maxvision/mcp-servers/n8n"
test -d "$TARGET" || { echo "already gone"; exit 0; }
rm -rf "$TARGET"
echo "custom n8n MCP server directory removed"
```

(Reminder: the JWT that lived in that source is still valid and exposed — rotating it is adjacent task A.)

---

## Self-Review

**Spec coverage:**
- §4.1 migrate config → Task 8. ✓
- §4.2 remove custom (config) → Task 8 Step 4 asserts no `dist/index.js` residue; (dir) → Task 13 gated. ✓
- §4.3 revive + validate hooks; n8n_instances conditional → Task 11. ✓
- §4.4 hook coverage gaps (autofix, deploy_template) → Tasks 5–6. (audit_instance was marked optional/low-priority in spec → intentionally omitted; documented here.) ✓
- §4.5 anti-drift (marketplace-sync + upstream drift) → Tasks 3–4. ✓
- §5 final validation (3 classes + hooks + guards) → Tasks 10–12. ✓
- §6 restart risk → Task 9 checkpoint. ✓

**Placeholder scan:** No TBD/TODO. All hook reminder text, script bodies, and JSON blocks are complete. `<your JWT>` is replaced by the captured-key mechanism in Task 8 Step 2 (not a placeholder).

**Type/name consistency:** Script filenames, marker names (`autofix`, `deploy-template`), and matcher tool names (`n8n_autofix_workflow`, `n8n_deploy_template`) are consistent across Tasks 5/6/7 and the test harness needles (`autofix`, `template`). `.upstream-pin` field names (`repo`, `commit`, `version`) match between Task 2 and Task 4's parser.

**Note on audit_instance:** spec §4.4 marked an `n8n_audit_instance` hook as optional/low-priority (read-only tool). Omitted from this plan by design; can be added later with the same `_emit.sh` pattern if desired.
