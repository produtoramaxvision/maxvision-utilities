# sync-thin-plugin.ps1
# Syncs declarative surface from plugin pesado -> plugin fino (media-forge-hosted).
# Usage: powershell -File scripts/sync-thin-plugin.ps1
# Run from: media-forge/

param(
  [string]$SrcRoot = ".",
  [string]$DstRoot = "./plugins/media-forge-hosted"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Sync-Dir {
  param([string]$Src, [string]$Dst, [string]$Filter = "*.md")
  New-Item -ItemType Directory -Force -Path $Dst | Out-Null
  Get-ChildItem "$Src/$Filter" | ForEach-Object {
    Copy-Item $_.FullName -Destination "$Dst/$($_.Name)" -Force
    Write-Output "  synced: $($_.Name)"
  }
}

Write-Output "Syncing agents..."
Sync-Dir -Src "$SrcRoot/agents" -Dst "$DstRoot/agents"

Write-Output "Syncing commands..."
Sync-Dir -Src "$SrcRoot/commands" -Dst "$DstRoot/commands"

# Prune first. This script only ever copied, so a skill deleted or renamed at the
# source survived forever in the mirror - the hosted plugin kept advertising
# seedance-prompting after it became mf-video-prompt. Delete-then-copy keeps the
# mirror an actual mirror.
Write-Output "Pruning skills removed from source..."
if (Test-Path "$DstRoot/skills") {
  Get-ChildItem "$DstRoot/skills" -Directory | ForEach-Object {
    if (-not (Test-Path "$SrcRoot/skills/$($_.Name)")) {
      Remove-Item $_.FullName -Recurse -Force
      Write-Output "  pruned: $($_.Name)"
    }
  }
}

Write-Output "Syncing skills..."
Get-ChildItem "$SrcRoot/skills" -Directory |
  Where-Object { $_.Name -notlike '.*' -and $_.Name -ne '_shared' } |
  ForEach-Object {
    $skillDst = "$DstRoot/skills/$($_.Name)"
    New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
    if (Test-Path "$($_.FullName)/SKILL.md") {
      Copy-Item "$($_.FullName)/SKILL.md" -Destination "$skillDst/SKILL.md" -Force
      Write-Output "  synced: $($_.Name)/SKILL.md"
    }
  }

# Shared assets the absorbed skills point at through [ref:...]. Without them the
# hosted plugin ships SKILL.md files whose references resolve to nothing.
# Recursive: carries references/, references/vocab/ and schemas/.
if (Test-Path "$SrcRoot/skills/_shared") {
  Write-Output "Syncing shared skill assets (_shared)..."
  if (Test-Path "$DstRoot/skills/_shared") { Remove-Item "$DstRoot/skills/_shared" -Recurse -Force }
  New-Item -ItemType Directory -Force -Path "$DstRoot/skills/_shared" | Out-Null
  Copy-Item "$SrcRoot/skills/_shared/*" -Destination "$DstRoot/skills/_shared" -Recurse -Force
  $sharedFiles = (Get-ChildItem "$DstRoot/skills/_shared" -Recurse -File).Count
  Write-Output "  synced: _shared ($sharedFiles files)"
}

$agents = (Get-ChildItem "$DstRoot/agents/*.md").Count
$commands = (Get-ChildItem "$DstRoot/commands/*.md").Count
$skills = (Get-ChildItem "$DstRoot/skills" -Directory | Where-Object { $_.Name -ne '_shared' }).Count
Write-Output "Done: $agents agents, $commands commands, $skills skills"
