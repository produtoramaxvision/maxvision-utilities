// src/utils/cli-binary.ts
// Resolving a CLI name into something Node can actually spawn WITHOUT a shell.
//
// ## The bug this exists to fix
//
// Both CLI adapters — Codex image and Higgsfield — did `spawn('codex', args,
// { shell: false })`. That is correct and deliberate on POSIX: execvp resolves
// the name against PATH, and an argv array means a prompt containing `; rm -rf ~`
// is one opaque element rather than a command.
//
// On Windows it cannot work. npm and pnpm install CLIs as SHIMS, not binaries:
//
//   codex        an sh script (for Git Bash / WSL)
//   codex.CMD    a batch shim
//   codex.ps1    a PowerShell shim
//
// Node refuses both, and measurably so on this machine:
//
//   spawn('codex')                    -> ENOENT  (no PATHEXT search without a shell)
//   spawn('C:\...\codex.CMD')         -> EINVAL  (Node blocks .cmd/.bat without
//                                                 shell:true, since CVE-2024-27980)
//
// So every Windows call through these adapters failed before reaching the
// provider. Injected-runner tests could not see it — they replace the spawn
// entirely — and `codex --version` in a shell works fine, which is why it read
// as installed and working.
//
// ## Why not shell: true
//
// Because the prompt is arbitrary user text. Through cmd.exe, `&`, `|`, `^` and
// `%VAR%` inside a prompt are re-parsed after Node quotes the arguments, and a
// prompt becomes a command. Both adapters carry a comment forbidding exactly
// that rewrite. This module exists so Windows can be supported WITHOUT giving
// that property up: everything below still spawns an argv array with shell:false.
//
// ## The two resolutions, both verified on this machine
//
//   native .exe on PATH        -> spawn it directly
//   sh/CMD shim only           -> spawn process.execPath with the shim's own
//                                 .js entry point, which is a plain Node script
//
// Both answered `codex --version` correctly under shell:false.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApiError } from '../core/errors.js';

export interface ResolvedCli {
  /** What to hand spawn() as the command. */
  readonly command: string;
  /** Arguments that must precede the caller's own. Empty for a native binary. */
  readonly prefixArgs: ReadonlyArray<string>;
  /** How it was found — surfaced for diagnostics, never for branching. */
  readonly via: 'path' | 'native-exe' | 'node-shim' | 'override';
}

/** Executable extensions worth trying, most-preferred first. */
const WINDOWS_NATIVE_EXTS = ['.exe', '.com'] as const;
/** Shim extensions: not spawnable, but they NAME the real entry point. */
const WINDOWS_SHIM_EXTS = ['', '.cmd', '.CMD', '.ps1'] as const;

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const raw = env['PATH'] ?? env['Path'] ?? '';
  return raw.split(path.delimiter).filter((p) => p.length > 0);
}

function firstExisting(dirs: string[], name: string, exts: ReadonlyArray<string>): string | undefined {
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Missing or unreadable — the next candidate is the answer, not an error.
      }
    }
  }
  return undefined;
}

/**
 * Pulls the `.js` entry point out of an npm/pnpm shim.
 *
 * Both shim flavours name it, with the directory written as a variable that has
 * to be expanded against the shim's own location:
 *
 *   sh    exec node  "$basedir/global/5/node_modules/@openai/codex/bin/codex.js" "$@"
 *   cmd   node  "%~dp0\global\5\node_modules\@openai\codex\bin\codex.js" %*
 *
 * Returns undefined rather than guessing when the file does not match that
 * shape. A wrong path here would spawn the wrong program, which is worse than
 * an error naming the override.
 */
export function extractShimJsEntry(shimContents: string, shimPath: string): string | undefined {
  const shimDir = path.dirname(shimPath);

  // Both forms quote the path. Take the LAST match: the cmd shim writes the
  // same path twice (node.exe branch and bare-node branch) and either resolves
  // to the same file, while the sh shim's final `exec` line is the operative one.
  const matches = [...shimContents.matchAll(/"([^"]*\.js)"/g)].map((m) => m[1]!);
  if (matches.length === 0) return undefined;

  const raw = matches[matches.length - 1]!;
  const expanded = raw
    .replace(/^\$basedir[\\/]/, '')
    .replace(/^%~dp0[\\/]?/, '')
    .replace(/\\/g, path.sep)
    .replace(/\//g, path.sep);

  // Already absolute (a shim can hardcode one) — take it as-is.
  const candidate = path.isAbsolute(expanded) ? expanded : path.join(shimDir, expanded);
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolveCliOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Env var a caller can set to point at a real executable. */
  readonly overrideEnvVar?: string;
  /** Injected for tests; defaults to the running Node binary. */
  readonly nodeExecPath?: string;
}

/**
 * Resolves a CLI name into a spawnable command.
 *
 * POSIX returns the bare name and lets execvp do its job — the existing,
 * working behaviour, deliberately untouched.
 */
export function resolveCliBinary(name: string, opts: ResolveCliOptions = {}): ResolvedCli {
  const env = opts.env ?? process.env;

  const override = opts.overrideEnvVar ? env[opts.overrideEnvVar] : undefined;
  if (override !== undefined && override.length > 0) {
    // Trusted as given. An operator pointing this at a specific binary knows
    // more about their machine than any discovery heuristic here.
    return { command: override, prefixArgs: [], via: 'override' };
  }

  if (process.platform !== 'win32') {
    return { command: name, prefixArgs: [], via: 'path' };
  }

  const dirs = pathEntries(env);

  const nativeExe = firstExisting(dirs, name, WINDOWS_NATIVE_EXTS);
  if (nativeExe !== undefined) {
    return { command: nativeExe, prefixArgs: [], via: 'native-exe' };
  }

  const shim = firstExisting(dirs, name, WINDOWS_SHIM_EXTS);
  if (shim !== undefined) {
    let contents: string;
    try {
      contents = fs.readFileSync(shim, 'utf8');
    } catch {
      contents = '';
    }
    const jsEntry = extractShimJsEntry(contents, shim);
    if (jsEntry !== undefined) {
      // Node running a plain .js file: no shell, argv array preserved, so the
      // prompt stays one opaque element exactly as on POSIX.
      return {
        command: opts.nodeExecPath ?? process.execPath,
        prefixArgs: [jsEntry],
        via: 'node-shim',
      };
    }
  }

  throw new ApiError(
    `"${name}" could not be resolved to something spawnable without a shell. ` +
      (shim !== undefined
        ? `Found the shim at ${shim}, but could not read a .js entry point out of it. `
        : `No ${name}.exe and no ${name} shim were found on PATH. `) +
      (opts.overrideEnvVar
        ? `Set ${opts.overrideEnvVar} to the full path of a real executable.`
        : `Install it so a native executable is on PATH.`),
    'API',
    { binary: name },
  );
}
