// tests/unit/utils/cli-binary.test.ts
//
// Gate for src/utils/cli-binary.ts — the resolver that lets the Codex/
// Higgsfield adapters spawn with shell:false on Windows, where npm/pnpm
// install CLIs as shims (.cmd/.sh) rather than native binaries. Node throws
// ENOENT on the bare name and EINVAL on the .cmd (CVE-2024-27980), so the
// resolver has to find a native .exe or unwrap the shim to its .js entry.
//
// Everything here runs against a FAKE filesystem/PATH built in temp dirs —
// never against a real codex/higgsfield install — so the suite passes on any
// machine and in CI regardless of what's actually installed.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { resolveCliBinary, extractShimJsEntry } from '../../../src/utils/cli-binary.js';
import { ApiError } from '../../../src/core/errors.js';

const isWin32 = process.platform === 'win32';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cli-binary-'));
  tmpDirs.push(dir);
  return dir;
}

function writeFile(filePath: string, contents: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // EPERM on Windows — a handle from this run may still be closing; the
      // OS reclaims the temp dir on its own.
    }
  }
});

// ---------------------------------------------------------------------------
// Override env var — checked before the platform branch, so it holds on any OS.
// ---------------------------------------------------------------------------
describe('resolveCliBinary — override env var', () => {
  it('override set -> returned verbatim, via override, empty prefixArgs', () => {
    // An operator pointing this at a specific binary knows more about their
    // machine than any PATH heuristic below — it must win outright.
    const result = resolveCliBinary('codex', {
      env: { MY_CODEX_BIN: 'C:\\tools\\codex-real.exe' },
      overrideEnvVar: 'MY_CODEX_BIN',
    });
    expect(result).toEqual({
      command: 'C:\\tools\\codex-real.exe',
      prefixArgs: [],
      via: 'override',
    });
  });
});

// ---------------------------------------------------------------------------
// Windows PATH discovery — the module short-circuits to `via: 'path'` on any
// non-win32 platform, so these cases only exercise the real logic here.
// ---------------------------------------------------------------------------
describe.skipIf(!isWin32)('resolveCliBinary — Windows PATH discovery (win32 only)', () => {
  it('override set but EMPTY string -> ignored, discovery proceeds', () => {
    const dir = makeTmpDir();
    writeFile(path.join(dir, 'codex.exe'), 'fake-binary');
    // An empty env var is how a shell exports "unset" — treating it as set
    // would silently disable discovery for anyone who does `export X=`.
    const result = resolveCliBinary('codex', {
      env: { PATH: dir, MY_CODEX_BIN: '' },
      overrideEnvVar: 'MY_CODEX_BIN',
    });
    expect(result.via).toBe('native-exe');
    expect(result.command).toBe(path.join(dir, 'codex.exe'));
  });

  it('a .exe on PATH wins over a .cmd shim in the SAME directory', () => {
    const dir = makeTmpDir();
    writeFile(path.join(dir, 'codex.exe'), 'fake-binary');
    // The shim must be VIABLE (resolvable to a real .js), not a decoy — a
    // decoy shim would make this pass even if precedence were inverted,
    // because the resolver would just throw instead of picking a wrong
    // answer. With a working shim present, inverted precedence would
    // succeed via 'node-shim', so asserting 'native-exe' here actually
    // pins the .exe-first ordering that avoids the EINVAL bug.
    const jsEntry = path.join(dir, 'global', '5', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    writeFile(jsEntry, '// fake entry point');
    writeFile(
      path.join(dir, 'codex.cmd'),
      '"%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    );
    const result = resolveCliBinary('codex', { env: { PATH: dir } });
    expect(result.via).toBe('native-exe');
    expect(result.command).toBe(path.join(dir, 'codex.exe'));
    expect(result.prefixArgs).toEqual([]);
  });

  it('only a shim present -> node-shim via injected node + the shim .js entry', () => {
    const dir = makeTmpDir();
    const jsEntry = path.join(
      dir,
      'global',
      '5',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    writeFile(jsEntry, '// fake entry point');
    writeFile(
      path.join(dir, 'codex.CMD'),
      '"%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    );
    const fakeNode = 'C:\\fake\\node.exe';
    const result = resolveCliBinary('codex', { env: { PATH: dir }, nodeExecPath: fakeNode });
    expect(result.via).toBe('node-shim');
    expect(result.command).toBe(fakeNode);
    expect(result.prefixArgs).toEqual([jsEntry]);
  });

  it('an earlier PATH entry wins over a later one', () => {
    const earlyDir = makeTmpDir();
    const lateDir = makeTmpDir();
    writeFile(path.join(earlyDir, 'codex.exe'), 'early-binary');
    writeFile(path.join(lateDir, 'codex.exe'), 'late-binary');
    // PATH order is the resolution contract every shell relies on — getting
    // this backwards would silently pick a different install than the shell would.
    const result = resolveCliBinary('codex', {
      env: { PATH: [earlyDir, lateDir].join(path.delimiter) },
    });
    expect(result.command).toBe(path.join(earlyDir, 'codex.exe'));
  });

  it('nothing found -> throws, message names the override env var', () => {
    const dir = makeTmpDir();
    let caught: unknown;
    try {
      resolveCliBinary('codex', { env: { PATH: dir }, overrideEnvVar: 'MY_CODEX_BIN' });
    } catch (err) {
      caught = err;
    }
    // The error has to be actionable: name the exact env var an operator can set.
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as Error).message).toContain('MY_CODEX_BIN');
  });

  it('shim found but its .js target does not exist on disk -> throws naming the shim, not a generic not-found', () => {
    const dir = makeTmpDir();
    // No file written under global/5/... — the shim names a path that isn't
    // there. Returning it anyway would hand the adapter a path to spawn that
    // ENOENTs immediately.
    const shimPath = path.join(dir, 'codex.CMD');
    writeFile(shimPath, '"%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*');
    let caught: unknown;
    try {
      resolveCliBinary('codex', { env: { PATH: dir } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    // Pins the "found the shim, couldn't parse a .js" branch specifically —
    // toThrowError(ApiError) alone would also pass for the unrelated
    // "nothing found on PATH at all" branch.
    expect((caught as Error).message).toContain('Found the shim');
  });
});

// ---------------------------------------------------------------------------
// POSIX short-circuit — the existing, deliberately untouched behaviour.
// Only meaningful (and only exercised) off Windows.
// ---------------------------------------------------------------------------
describe.skipIf(isWin32)('resolveCliBinary — POSIX short-circuit (non-win32 only)', () => {
  it('returns the bare name for execvp to resolve, via "path"', () => {
    const result = resolveCliBinary('codex', { env: { PATH: '/usr/bin' } });
    expect(result).toEqual({ command: 'codex', prefixArgs: [], via: 'path' });
  });
});

// ---------------------------------------------------------------------------
// extractShimJsEntry — the fragile half: string-parses a batch/sh script and
// must never guess. Platform-independent (pure string + fs.statSync logic).
// ---------------------------------------------------------------------------
describe('extractShimJsEntry', () => {
  it('pnpm .CMD shim: expands %~dp0 against the shim dir, both branches resolve to the one file', () => {
    const dir = makeTmpDir();
    const jsEntry = path.join(
      dir,
      'global',
      '5',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    writeFile(jsEntry, '// fake entry point');
    const shimPath = path.join(dir, 'codex.CMD');
    // Exact real pnpm-generated shim shape, verbatim apart from the path.
    const contents = [
      '@SETLOCAL',
      '@IF NOT DEFINED NODE_PATH (',
      '  @SET "NODE_PATH=...;..."',
      ') ELSE (',
      '  @SET "NODE_PATH=...;...;%NODE_PATH%"',
      ')',
      '@IF EXIST "%~dp0\\node.exe" (',
      '  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      ') ELSE (',
      '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
      '  node  "%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      ')',
    ].join('\r\n');
    expect(extractShimJsEntry(contents, shimPath)).toBe(jsEntry);
  });

  it('pnpm sh shim (no extension): expands $basedir against the shim dir', () => {
    const dir = makeTmpDir();
    const jsEntry = path.join(
      dir,
      'global',
      '5',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    writeFile(jsEntry, '// fake entry point');
    const shimPath = path.join(dir, 'codex');
    const contents = 'exec node  "$basedir/global/5/node_modules/@openai/codex/bin/codex.js" "$@"\n';
    expect(extractShimJsEntry(contents, shimPath)).toBe(jsEntry);
  });

  it('no .js path anywhere in the contents -> undefined, not a throw', () => {
    const dir = makeTmpDir();
    const shimPath = path.join(dir, 'codex.ps1');
    const contents = '$exe = Join-Path $PSScriptRoot "codex.exe"\n& $exe @args\n';
    // No .js quoted anywhere — there is nothing to guess from, so this must
    // return undefined rather than misparse the .exe reference.
    expect(extractShimJsEntry(contents, shimPath)).toBeUndefined();
  });

  it('a named .js path that does not exist on disk -> undefined, not a guess', () => {
    const dir = makeTmpDir();
    const shimPath = path.join(dir, 'codex.CMD');
    // Deliberately no file written at global/5/.../codex.js. Returning this
    // path anyway would spawn the wrong (nonexistent) thing.
    const contents = '"%~dp0\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
    expect(extractShimJsEntry(contents, shimPath)).toBeUndefined();
  });

  // npm's cmd-shim (what `npm install -g` writes) computes `SET dp0=%~dp0` in a
  // subroutine and then refers to it as `%dp0%` on the exec line — no tilde.
  // Handling only pnpm's inline `%~dp0` left every npm-installed CLI
  // unresolvable on Windows while pnpm-installed ones worked: a difference in
  // how the user installed the tool, which nobody would connect to the failure.
  it('npm-style shim referencing %dp0% (no tilde) resolves against the shim dir', () => {
    const dir = makeTmpDir();
    const jsEntry = path.join(dir, 'pkg', 'bin', 'cli.js');
    writeFile(jsEntry, '// fake entry point');
    const shimPath = path.join(dir, '.bin', 'codex.cmd');
    const contents = '"%dp0%\\..\\pkg\\bin\\cli.js" %*';
    expect(extractShimJsEntry(contents, shimPath)).toBe(jsEntry);
  });
});
