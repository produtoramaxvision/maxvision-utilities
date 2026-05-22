@echo off
:: scripts/dev-launch.cmd — Windows variant of dev-launch.sh
:: Usage: scripts\dev-launch.cmd
cd /d "%~dp0\.."
echo [media-forge dev] Building plugin...
call pnpm exec tsup
if errorlevel 1 exit /b %errorlevel%
echo [media-forge dev] Launching Claude Code with --plugin-dir %CD%
claude --plugin-dir "%CD%"
