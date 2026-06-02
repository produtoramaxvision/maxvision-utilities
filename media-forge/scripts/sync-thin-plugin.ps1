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

Write-Output "Syncing skills..."
Get-ChildItem "$SrcRoot/skills" -Directory | Where-Object { $_.Name -notlike '.*' } | ForEach-Object {
  $skillDst = "$DstRoot/skills/$($_.Name)"
  New-Item -ItemType Directory -Force -Path $skillDst | Out-Null
  if (Test-Path "$($_.FullName)/SKILL.md") {
    Copy-Item "$($_.FullName)/SKILL.md" -Destination "$skillDst/SKILL.md" -Force
    Write-Output "  synced: $($_.Name)/SKILL.md"
  }
}

$agents = (Get-ChildItem "$DstRoot/agents/*.md").Count
$commands = (Get-ChildItem "$DstRoot/commands/*.md").Count
$skills = (Get-ChildItem "$DstRoot/skills" -Directory).Count
Write-Output "Done: $agents agents, $commands commands, $skills skills"
