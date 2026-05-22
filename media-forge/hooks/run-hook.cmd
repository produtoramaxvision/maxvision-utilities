@echo off
REM Cross-platform hook entry. Detects available shell.
REM Usage: run-hook.cmd <hook-name>
setlocal
set HOOK_NAME=%~1
set HOOK_SH=%~dp0%HOOK_NAME%.sh

REM Prefer Git Bash on Windows
set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
if not exist "%BASH_EXE%" set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH_EXE%" set "BASH_EXE=bash"

"%BASH_EXE%" "%HOOK_SH%" %*
exit /b %ERRORLEVEL%
