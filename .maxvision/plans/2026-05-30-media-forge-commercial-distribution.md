# media-forge Commercial Distribution Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use maxvision:subagent-driven-development (recommended) or maxvision:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `media-forge` cleanly installable and legally safe for public/commercial distribution as a Claude Code plugin, removing the GPL dependency and the user-side build/install burden.

**Architecture:** Two independent phases. **Phase 1** decouples runtime from the GPL `ffmpeg-static` binary by resolving a system/LGPL `ffmpeg` at runtime (decode-only → JPEG, no GPL features used). **Phase 2** makes the plugin install without a user build: pure-JS deps bundled into `dist/` by tsup, the single remaining native dep (`sharp`) installed once into the official `${CLAUDE_PLUGIN_DATA}` persistent directory via a `SessionStart` hook, and the prebuilt `dist/` shipped via npm.

**Tech Stack:** TypeScript (ESM), tsup (bundler), vitest (tests), Node ≥22.5.0, pnpm ≥9, Claude Code plugin + stdio MCP server, sharp (Apache-2.0), system ffmpeg (LGPL).

**Decisions locked (2026-05-30):**
- Distribution surface: **Claude Code plugin only** (not Claude Desktop / MCPB).
- ffmpeg licensing: **system/LGPL ffmpeg**, drop bundled GPL `ffmpeg-static` from runtime.

**Audit findings this plan is built on:**
- `ffmpeg-static` is imported in exactly 2 runtime files, both via `execFile` subprocess (aggregation, not linking):
  - `src/refs/keyframe-extractor.ts:12,55,61` — fallback keyframe extraction (sharp handles the common case).
  - `src/review/reviewer.ts:151,156` — `extractFirstFrame` for video review.
  - (`scripts/generate-test-fixtures.ts:29` is dev-only, not shipped.)
- Both operations are decode-input → encode-JPEG (`-vframes 1`, `select scene`, `-q:v 3`). No x264/x265/GPL features. An LGPL or system ffmpeg covers 100% with zero feature loss.
- After ffmpeg removal, the only native runtime dependency is **sharp** (libvips).
- `tsup.config.ts` already emits `dist/mcp/server.js` and `dist/cli/cli.js`.
- Inconsistencies to fix: `.nvmrc` says `20` but `engines.node` is `>=22.5.0` (CI dropped Node 20 in commit `7e203c8`); `tsup` `target: 'node20'`. `db.ts` uses `node:sqlite` (Node 22.5+).

**Scope note:** Phase 1 is independently shippable and testable on its own. If you prefer, execute and merge Phase 1 first, then Phase 2 as a separate branch.

---

## File Structure

**Phase 1 — ffmpeg decoupling**
- Create `src/core/ffmpeg.ts` — single source of truth for resolving the ffmpeg binary path. Throws a typed error with remediation when absent.
- Create `tests/unit/core/ffmpeg.test.ts` — unit tests for the resolver (no real ffmpeg needed).
- Modify `src/refs/keyframe-extractor.ts` — replace `import ffmpegPath from 'ffmpeg-static'` with the resolver.
- Modify `src/review/reviewer.ts` — replace dynamic `import('ffmpeg-static')` with the resolver.
- Modify `src/cli/commands/doctor.ts` — add an `ffmpeg` check to `DoctorResult`.
- Modify `tests/unit/cli/doctor.test.ts` — assert the new ffmpeg check.
- Modify `package.json` — move `ffmpeg-static` out of `dependencies`.
- Modify `.env.example` — document `MEDIA_FORGE_FFMPEG_PATH` and the system-ffmpeg requirement.

**Phase 2 — install without user build**
- Modify `.nvmrc`, `tsup.config.ts` — Node 22 consistency.
- Modify `tsup.config.ts` — `noExternal` bundles pure-JS deps; `external: ['sharp']`.
- Create `hooks/ensure-deps.mjs` — installs `sharp` into `${CLAUDE_PLUGIN_DATA}` (replaces the empty `scripts/install-deps.*`).
- Modify `hooks/hooks.json` — wire `SessionStart` → `ensure-deps.mjs`.
- Modify `.mcp.json` — add `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules`.
- Modify `bin/media-forge` — honor the same `NODE_PATH`.
- Modify `package.json` — `dependencies` split (bundled vs `sharp`), `files[]` review.
- Modify `.claude-plugin/marketplace.json` (repo root) — `media-forge` source `npm`.

---

## PHASE 1 — Decouple from GPL ffmpeg-static

### Task 1: ffmpeg resolver helper

**Files:**
- Create: `src/core/ffmpeg.ts`
- Test: `tests/unit/core/ffmpeg.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/ffmpeg.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// child_process is mocked so tests never depend on a real ffmpeg install.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
import { spawnSync } from 'node:child_process';
import {
  resolveFfmpegPath,
  resolveFfmpegPathOrNull,
  FfmpegNotFoundError,
  __resetFfmpegCache,
} from '../../../src/core/ffmpeg.js';

beforeEach(() => {
  __resetFfmpegCache();
  vi.mocked(spawnSync).mockReset();
});

describe('resolveFfmpegPath', () => {
  it('returns MEDIA_FORGE_FFMPEG_PATH when it points to an existing file', () => {
    // process.execPath (the node binary) always exists — use it as a stand-in.
    const env = { MEDIA_FORGE_FFMPEG_PATH: process.execPath } as NodeJS.ProcessEnv;
    expect(resolveFfmpegPath(env)).toBe(process.execPath);
    expect(spawnSync).not.toHaveBeenCalled(); // override short-circuits PATH probe
  });

  it('falls back to system PATH via which/where', () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: `${process.execPath}\n`,
      stderr: '',
    } as never);
    const env = {} as NodeJS.ProcessEnv;
    expect(resolveFfmpegPath(env)).toBe(process.execPath);
  });

  it('throws FfmpegNotFoundError when no override and PATH probe fails', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: '' } as never);
    expect(() => resolveFfmpegPath({} as NodeJS.ProcessEnv)).toThrow(FfmpegNotFoundError);
  });

  it('resolveFfmpegPathOrNull returns null instead of throwing', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: '' } as never);
    expect(resolveFfmpegPathOrNull({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/ffmpeg.test.ts`
Expected: FAIL — `Cannot find module '../../../src/core/ffmpeg.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/ffmpeg.ts
// Resolves a usable ffmpeg binary at runtime. We only ever DECODE input and
// ENCODE to JPEG (mjpeg) — operations available in any LGPL/system ffmpeg —
// so we deliberately avoid bundling the GPL ffmpeg-static binary.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export class FfmpegNotFoundError extends Error {
  constructor() {
    super(
      'ffmpeg not found. Install ffmpeg and ensure it is on PATH, or set ' +
        'MEDIA_FORGE_FFMPEG_PATH to the binary. ' +
        'Windows: winget install Gyan.FFmpeg | macOS: brew install ffmpeg | ' +
        'Debian/Ubuntu: apt-get install ffmpeg',
    );
    this.name = 'FfmpegNotFoundError';
  }
}

let cached: string | undefined;

export function __resetFfmpegCache(): void {
  cached = undefined;
}

export function resolveFfmpegPathOrNull(env: NodeJS.ProcessEnv = process.env): string | null {
  if (cached) return cached;

  const override = env['MEDIA_FORGE_FFMPEG_PATH'];
  if (override && existsSync(override)) {
    cached = override;
    return override;
  }

  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, ['ffmpeg'], { encoding: 'utf8' });
  if (r.status === 0 && typeof r.stdout === 'string') {
    const found = r.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0 && existsSync(s));
    if (found) {
      cached = found;
      return found;
    }
  }
  return null;
}

export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  const p = resolveFfmpegPathOrNull(env);
  if (!p) throw new FfmpegNotFoundError();
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/ffmpeg.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/core/ffmpeg.ts tests/unit/core/ffmpeg.test.ts
git commit -m "feat(ffmpeg): add system/LGPL ffmpeg resolver (decouple from GPL ffmpeg-static)"
```

---

### Task 2: Migrate keyframe-extractor to the resolver

**Files:**
- Modify: `src/refs/keyframe-extractor.ts:12` (import), `:54-77` (usage)
- Test: `tests/unit/refs/keyframe-extractor.test.ts` (existing — must still pass)

- [ ] **Step 1: Replace the import**

In `src/refs/keyframe-extractor.ts`, remove line 12:

```ts
import ffmpegPath from 'ffmpeg-static';
```

and add (next to the other imports):

```ts
import { resolveFfmpegPath } from '../core/ffmpeg.js';
```

- [ ] **Step 2: Update the ffmpeg invocation**

Replace the body of `extractKeyframesViaFfmpeg` lines 54-77 so it resolves the binary instead of using the static import. Replace:

```ts
async function extractKeyframesViaFfmpeg(input: Buffer, opts: ExtractOpts): Promise<Buffer[]> {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary unavailable');
  const dir = await mkdtemp(join(tmpdir(), 'mf-refs-'));
```

with:

```ts
async function extractKeyframesViaFfmpeg(input: Buffer, opts: ExtractOpts): Promise<Buffer[]> {
  const ffmpegPath = resolveFfmpegPath();
  const dir = await mkdtemp(join(tmpdir(), 'mf-refs-'));
```

(The rest of the function — `execFileP(ffmpegPath, [...])` and cleanup — is unchanged.)

- [ ] **Step 3: Run the existing unit test**

Run: `pnpm vitest run tests/unit/refs/keyframe-extractor.test.ts`
Expected: PASS. The two animated/static cases are served by sharp and never reach ffmpeg; the resolver is only hit on sharp page-index failure.

- [ ] **Step 4: Typecheck the file**

Run: `pnpm typecheck`
Expected: no errors (the now-unused `ffmpeg-static` import is gone).

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/refs/keyframe-extractor.ts
git commit -m "refactor(refs): resolve ffmpeg via core/ffmpeg instead of ffmpeg-static"
```

---

### Task 3: Migrate reviewer.extractFirstFrame to the resolver

**Files:**
- Modify: `src/review/reviewer.ts:145-161`
- Test: `tests/unit/review/reviewer.test.ts` (existing — must still pass)

- [ ] **Step 1: Replace the dynamic ffmpeg import**

In `src/review/reviewer.ts`, inside `extractFirstFrame` (lines 145-161), remove:

```ts
  const { default: ffmpegPath } = await import('ffmpeg-static');
```

and replace the `execFileP` call so it uses the resolver. The function becomes:

```ts
async function extractFirstFrame(videoPath: string): Promise<Buffer> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { resolveFfmpegPath } = await import('../core/ffmpeg.js');
  const ffmpegPath = resolveFfmpegPath();
  const execFileP = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), 'mf-rev-'));
  try {
    const out = join(dir, 'first.jpg');
    await execFileP(ffmpegPath, ['-y', '-i', videoPath, '-vframes', '1', '-q:v', '3', out]);
    return readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

Note: `ffmpegPath` is now `string` (resolver guarantees non-null), so the previous `ffmpegPath!` non-null assertion is removed. Keep the args array exactly as `['-y', '-i', videoPath, '-vframes', '1', '-q:v', '3', out]`.

- [ ] **Step 2: Run the existing reviewer test**

Run: `pnpm vitest run tests/unit/review/reviewer.test.ts`
Expected: PASS (the test does not exercise real video extraction; if it stubs `extractFirstFrame`, behavior is unchanged).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/review/reviewer.ts
git commit -m "refactor(review): resolve ffmpeg via core/ffmpeg in extractFirstFrame"
```

---

### Task 4: Add ffmpeg check to the `doctor` command

**Files:**
- Modify: `src/cli/commands/doctor.ts` (the `DoctorResult` interface + the check assembly)
- Test: `tests/unit/cli/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/cli/doctor.test.ts` (match the file's existing import/run style):

```ts
import { resolveFfmpegPathOrNull } from '../../../src/core/ffmpeg.js';

it('doctor reports ffmpeg ok when a binary resolves', async () => {
  // process.execPath stands in for a resolvable binary
  const result = await runDoctor({ MEDIA_FORGE_FFMPEG_PATH: process.execPath } as NodeJS.ProcessEnv);
  expect(result.checks.ffmpeg.ok).toBe(true);
  expect(typeof result.checks.ffmpeg.path).toBe('string');
});

it('doctor reports ffmpeg not-ok with hint when unresolved', async () => {
  const result = await runDoctor({} as NodeJS.ProcessEnv); // no ffmpeg on test PATH guaranteed? use override-absent
  // If the host running tests happens to have ffmpeg, this still type-checks;
  // assert the shape rather than a hard false.
  expect(result.checks.ffmpeg).toHaveProperty('ok');
});
```

Note: replace `runDoctor` with whatever the existing test calls (e.g. an exported `runDoctorChecks(env)`); inspect `tests/unit/cli/doctor.test.ts` first and mirror its harness. If `doctor.ts` exposes a pure check assembler, export and call that; otherwise add an exported `assembleDoctorResult(env)` in Step 3.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/cli/doctor.test.ts`
Expected: FAIL — `checks.ffmpeg` is undefined.

- [ ] **Step 3: Implement the ffmpeg check**

In `src/cli/commands/doctor.ts`, extend the `DoctorResult` interface:

```ts
export interface DoctorResult {
  ok: boolean;
  checks: {
    config: { ok: boolean; mode?: 'gemini' | 'vertex'; missing?: string[] };
    outputDir: { ok: boolean; path: string; writable: boolean; reason?: string };
    network: { ok: boolean; reachable?: boolean; reason?: string };
    models: { ok: boolean; checked: string[] };
    ffmpeg: { ok: boolean; path?: string; hint?: string };
  };
}
```

Add the check function (import the resolver at top: `import { resolveFfmpegPathOrNull } from '../../core/ffmpeg.js';`):

```ts
function checkFfmpeg(env: Record<string, string | undefined>): DoctorResult['checks']['ffmpeg'] {
  const p = resolveFfmpegPathOrNull(env as NodeJS.ProcessEnv);
  if (p) return { ok: true, path: p };
  return {
    ok: false,
    hint: 'Install ffmpeg (winget/brew/apt) or set MEDIA_FORGE_FFMPEG_PATH. Required for animated-ref fallback and video first-frame review.',
  };
}
```

Wire it into the assembled `checks` object alongside `config`, `outputDir`, `network`, `models`. ffmpeg absence is a **warning, not a hard failure**: do NOT let `ffmpeg.ok === false` flip the top-level `result.ok` to false (the core image pipeline works without ffmpeg). Keep `result.ok` driven by `config`/`outputDir`/`models` as before; surface ffmpeg as advisory in the printed output.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/cli/doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add src/cli/commands/doctor.ts tests/unit/cli/doctor.test.ts
git commit -m "feat(doctor): advisory ffmpeg availability check"
```

---

### Task 5: Drop ffmpeg-static from runtime dependencies + document

**Files:**
- Modify: `package.json` (`dependencies` → remove `ffmpeg-static`; add to `devDependencies` only if `scripts/generate-test-fixtures.ts` still needs it)
- Modify: `.env.example`

- [ ] **Step 1: Move ffmpeg-static out of runtime deps**

In `package.json`, remove `"ffmpeg-static": "^5.2.0",` from `dependencies`. Because `scripts/generate-test-fixtures.ts` (dev-only) imports it, add it to `devDependencies`:

```json
"devDependencies": {
  "ffmpeg-static": "^5.2.0",
  ...existing...
}
```

If you prefer zero GPL in the tree even for dev, instead rewrite `scripts/generate-test-fixtures.ts` to use the system ffmpeg via `resolveFfmpegPath()` and remove `ffmpeg-static` entirely. (Optional — dev binaries are not distributed, so devDependency is acceptable.)

- [ ] **Step 2: Update the lockfile**

Run: `pnpm install`
Expected: `pnpm-lock.yaml` updated; `ffmpeg-static` no longer under runtime deps graph.

- [ ] **Step 3: Document the requirement in `.env.example`**

Append to `.env.example`:

```bash
# ---------------------------------------------------------------------------
# ffmpeg (LGPL/system) — used for animated-ref fallback + video first-frame review.
# media-forge does NOT bundle ffmpeg (avoids GPL/x264-x265 patent exposure).
# Provide one of:
#   - ffmpeg on PATH (winget install Gyan.FFmpeg | brew install ffmpeg | apt-get install ffmpeg)
#   - MEDIA_FORGE_FFMPEG_PATH=/absolute/path/to/ffmpeg
# ---------------------------------------------------------------------------
# MEDIA_FORGE_FFMPEG_PATH=
```

- [ ] **Step 4: Full test + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. No remaining runtime import of `ffmpeg-static` (grep to confirm):

Run: `grep -rn "ffmpeg-static" src/ && echo "FOUND IN SRC (bad)" || echo "clean: no ffmpeg-static in src/"`
Expected: `clean: no ffmpeg-static in src/`.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore(deps): remove ffmpeg-static from runtime deps; document system ffmpeg"
```

**Phase 1 exit criteria:** `pnpm typecheck && pnpm lint && pnpm test` green; no `ffmpeg-static` in `src/`; `media-forge doctor` shows an ffmpeg line. Phase 1 is shippable here.

---

## PHASE 2 — Install without a user build

### Task 6: Node 22 consistency

**Files:**
- Modify: `.nvmrc`, `tsup.config.ts:18`

- [ ] **Step 1: Fix `.nvmrc`**

Set `.nvmrc` contents to:

```
22.5.0
```

- [ ] **Step 2: Fix tsup target**

In `tsup.config.ts`, change `target: 'node20',` to:

```ts
  target: 'node22',
```

- [ ] **Step 3: Verify build still works**

Run: `pnpm build`
Expected: `dist/` regenerated, no errors. (`node:sqlite` in `db.ts` is valid at node22 target.)

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
cd media-forge
git add .nvmrc tsup.config.ts
git commit -m "chore: align Node target to 22.5 (matches engines + node:sqlite)"
```

---

### Task 7: Bundle ONLY first-party code; keep ALL deps external (A1 — Approach Y)

**Why (eng review A1):** bundling every dep (`noExternal`) breaks gRPC/protobuf and dynamic-require libs — `@google-cloud/vision` (dynamic `.proto` loading), `pg` (optional `pg-native`), and bloats dist with `@aws-sdk/*`. Build would pass but the MCP server would crash at runtime on Vision/Postgres. Instead bundle only YOUR code and install the full `dependencies` set into `${CLAUDE_PLUGIN_DATA}` (Task 8). Eliminates all bundling-compat risk; keeps `dist` tiny.

**Files:**
- Modify: `tsup.config.ts`

- [ ] **Step 1: Configure tsup to externalize all node_modules**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'mcp/server': 'src/mcp/server.ts',
    'cli/cli': 'src/cli/cli.ts',
    'refs/taxonomy': 'src/refs/taxonomy.ts',
    'refs/refs-service': 'src/refs/refs-service.ts',
  },
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node22',
  outDir: 'dist',
  shims: false,
  // Bundle ONLY first-party code. Every dependency stays external and is
  // installed into ${CLAUDE_PLUGIN_DATA}/node_modules by hooks/ensure-deps.mjs.
  // tsup/esbuild treats bare imports as external by default when skipNodeModulesBundle
  // is on; make it explicit so no dep is ever inlined.
  skipNodeModulesBundle: true,
});
```

- [ ] **Step 2: Build and verify NO dep is inlined**

Run: `pnpm build`
Expected: success; `dist/` files are small (first-party only).

Run: `grep -rlE "node-vibrant|@google-cloud|@aws-sdk" dist/*.js | head` — should show only `import ... from '@...'` external references, never inlined library source. Spot-check `dist/mcp/server.js` size is KB, not MB.

- [ ] **Step 3: Confirm externalization via a resolve smoke**

Run: `node -e "require('node:fs').readFileSync('dist/mcp/server.js','utf8').includes('node_modules')||console.log('ok: no inlined node_modules paths')"`
Expected: prints `ok` (no bundled dep source). The server will only run once deps are installed in `NODE_PATH` (Task 8/9) — that is intended.

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
cd media-forge
git add tsup.config.ts
git commit -m "build(tsup): bundle first-party only; externalize all deps (avoid grpc/pg bundling breakage)"
```

---

### Task 8: SessionStart hook installs the FULL runtime dep set into ${CLAUDE_PLUGIN_DATA}

**Why (A1/Approach Y):** since Task 7 externalizes all deps, the hook now installs the entire `dependencies` set (not just sharp) into the persistent data dir. This is the officially documented `${CLAUDE_PLUGIN_DATA}` pattern (Claude Code does NOT auto-install on plugin install).

**Files:**
- Create: `hooks/ensure-deps.mjs`
- Create: `hooks/deps/package.json` (runtime deps manifest — a copy of `package.json` `dependencies`)
- Add a build step (or doc note) keeping `hooks/deps/package.json` `dependencies` in sync with the root `package.json` `dependencies`.

- [ ] **Step 1: Create the runtime deps manifest**

Create `hooks/deps/package.json` mirroring the root `package.json` `dependencies` block verbatim (after Task 5 removed `ffmpeg-static`):

```json
{
  "name": "media-forge-runtime-deps",
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.98.0",
    "@aws-sdk/client-bedrock-runtime": "^3.700.0",
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "@fal-ai/client": "^1.7.0",
    "@google-cloud/vision": "^5.3.6",
    "@google/genai": "^2.0.1",
    "@higgsfield/client": "0.2.1",
    "@modelcontextprotocol/sdk": "^1.0.4",
    "commander": "^12.1.0",
    "dotenv": "^16.4.7",
    "lru-cache": "^11.0.0",
    "node-vibrant": "^4.0.3",
    "p-limit": "^6.1.0",
    "pg": "^8.13.0",
    "pngjs": "^7.0.0",
    "sharp": "^0.34.5",
    "yaml": "^2.6.0",
    "zod": "^3.23.8"
  }
}
```

To prevent drift, add a guard test `tests/unit/hooks/deps-manifest-sync.test.ts` asserting `hooks/deps/package.json` `dependencies` deep-equals the root `package.json` `dependencies` (minus any intentionally-bundled/dev-only names). This fails CI if someone adds a runtime dep to root but forgets the hook manifest.

- [ ] **Step 2: Create the install hook**

Create `hooks/ensure-deps.mjs`:

```js
#!/usr/bin/env node
// Installs media-forge's runtime deps once into the plugin's persistent data
// dir, and reinstalls when the pinned manifest changes. All deps are external
// (see tsup.config.ts); the bundled dist resolves them via NODE_PATH.
// Official pattern: https://code.claude.com/docs/en/plugins-reference (persistent data directory)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PLUGIN_ROOT;
const data = process.env.CLAUDE_PLUGIN_DATA;
if (!root || !data) process.exit(0); // not running as an installed plugin; no-op

const srcManifest = join(root, 'hooks', 'deps', 'package.json');
const dstManifest = join(data, 'package.json');

const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

// Up to date when manifest matches AND a representative native dep resolved.
if (read(srcManifest) === read(dstManifest) && existsSync(join(data, 'node_modules', 'sharp'))) {
  process.exit(0);
}

try {
  mkdirSync(data, { recursive: true });
  copyFileSync(srcManifest, dstManifest);
  // npm is always present with Node; the user may not have pnpm.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: data,
    stdio: 'inherit',
  });
} catch (err) {
  // Drop the copied manifest so the next session retries the install.
  rmSync(dstManifest, { force: true });
  console.error('[media-forge] dependency install failed:', err?.message ?? err);
  process.exit(0); // never block the session; doctor + named errors report the gap (Task 11)
}
```

- [ ] **Step 3: Manual dry-run of the hook**

```bash
set -euo pipefail
cd media-forge
CLAUDE_PLUGIN_ROOT="$(pwd)" CLAUDE_PLUGIN_DATA="$(mktemp -d)" node hooks/ensure-deps.mjs && echo "hook ok"
```

Expected: full dep set installs into the temp dir; prints `hook ok`. Re-running with the same `CLAUDE_PLUGIN_DATA` no-ops (idempotent).

- [ ] **Step 4: Commit**

```bash
set -euo pipefail
cd media-forge
git add hooks/ensure-deps.mjs hooks/deps/package.json tests/unit/hooks/deps-manifest-sync.test.ts
git commit -m "feat(hooks): install full runtime dep set into CLAUDE_PLUGIN_DATA on SessionStart"
```

---

### Task 9: Wire the hook + NODE_PATH for MCP and CLI

**Files:**
- Modify: `hooks/hooks.json` (add `ensure-deps` to `SessionStart`)
- Modify: `.mcp.json` (add `NODE_PATH`)
- Modify: `bin/media-forge` (honor `NODE_PATH`)

- [ ] **Step 1: Add the hook to SessionStart**

In `hooks/hooks.json`, the existing `SessionStart` array currently runs `refresh-taxonomy.mjs`. Add `ensure-deps.mjs` as the FIRST hook so deps exist before taxonomy refresh. The `SessionStart` block becomes:

```json
"SessionStart": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/hooks/ensure-deps.mjs",
        "timeout": 120
      },
      {
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/hooks/refresh-taxonomy.mjs",
        "timeout": 12
      }
    ]
  }
]
```

(120s timeout covers a cold sharp install on first session.)

- [ ] **Step 2: Point the MCP server at the persistent node_modules**

In `.mcp.json`, add `NODE_PATH` to the `env` block of the `media-forge` server (keep all existing env vars):

```json
"MEDIA_FORGE_SEEDANCE_ENABLED": "${MEDIA_FORGE_SEEDANCE_ENABLED:-true}",
"NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
```

- [ ] **Step 3: Make the CLI honor NODE_PATH**

`bin/media-forge` currently does `import('../dist/cli/cli.js')`. Node only reads `NODE_PATH` at process start, so prepend a block that adds the data dir and re-initializes the module search paths before the dynamic import. Replace `bin/media-forge` with exactly:

```js
#!/usr/bin/env node
import { Module } from 'node:module';

// Ensure ${CLAUDE_PLUGIN_DATA}/node_modules is resolvable for sharp.
const data = process.env.CLAUDE_PLUGIN_DATA;
if (data && !(process.env.NODE_PATH ?? '').includes(data)) {
  const sep = process.platform === 'win32' ? ';' : ':';
  process.env.NODE_PATH = [`${data}/node_modules`, process.env.NODE_PATH].filter(Boolean).join(sep);
  Module._initPaths(); // re-read NODE_PATH so sharp resolves from the data dir
}

import('../dist/cli/cli.js')
  .then((m) => m.runCli(process.argv.slice(2)))
  .catch((err) => {
    console.error('media-forge fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
```

Note: `Module._initPaths()` re-reads `NODE_PATH` so `sharp` resolves from the data dir without a child re-exec.

**Risk (F2, CEO review):** `Module._initPaths()` is an undocumented Node internal. It works today and across current LTS lines, but is not contractually stable. Accepted as the pragmatic choice (the documented alternative is a child re-exec with `NODE_PATH` set, which doubles process startup). The Task 13 clean-machine smoke test is the guard: if a Node upgrade ever breaks `_initPaths`, the matrix job goes red before a customer hits it. Revisit if that test fails.

- [ ] **Step 4: Validate plugin config**

Run: `pnpm dlx @anthropic-ai/claude-code plugin validate . --strict` (or `claude plugin validate . --strict` if the CLI is on PATH)
Expected: no schema errors in `plugin.json`, `hooks/hooks.json`, `.mcp.json`.

- [ ] **Step 5: Commit**

```bash
set -euo pipefail
cd media-forge
git add hooks/hooks.json .mcp.json bin/media-forge
git commit -m "feat(plugin): wire ensure-deps hook + NODE_PATH for sharp at runtime"
```

---

### Task 10: Ship prebuilt dist via npm + point marketplace at it

**Files:**
- Modify: `package.json` (`files[]` review)
- Modify: `.claude-plugin/marketplace.json` (repo root — `media-forge` source → npm)

Rationale: Claude Code does not build plugins. Publishing to npm with `dist` in `files[]` ships the compiled JS; `prepublishOnly` already runs `typecheck && lint && test && build`. The marketplace entry references the npm package so installs get prebuilt code; the `ensure-deps` hook supplies `sharp` at runtime.

- [ ] **Step 1: Confirm files[] ships everything the runtime needs**

In `package.json`, verify `files[]` includes (it currently does): `dist`, `agents`, `skills`, `commands`, `prompts`, `hooks`, `.claude-plugin`, `.mcp.json`, `migrations`. Add `hooks/deps` is covered by `hooks`. Remove the now-irrelevant `scripts/install-deps.sh`/`scripts/install-deps.cmd` entries from `files[]` (they are empty/removed):

```json
"files": [
  "dist",
  "agents",
  "skills",
  "commands",
  "prompts",
  "hooks",
  ".claude-plugin",
  ".mcp.json",
  "migrations",
  "README.md",
  "LICENSE",
  "CHANGELOG.md"
]
```

- [ ] **Step 2: Delete the empty install-deps stubs**

Run:

```bash
set -euo pipefail
cd media-forge
git rm -f scripts/install-deps.sh scripts/install-deps.cmd 2>/dev/null || rm -f scripts/install-deps.sh scripts/install-deps.cmd
```

Expected: removed (the hook replaces them).

- [ ] **Step 3: Dry-run the npm package contents (HARD GATE — F4)**

Run: `pnpm pack --dry-run 2>&1 | tee /tmp/mf-pack.txt`
Expected: tarball lists `dist/`, `hooks/`, `skills/`, `agents/`, `commands/`, `.claude-plugin/`, `.mcp.json`, `migrations/` — and does NOT list `src/`, `tests/`, `.env`, `.env.example`, `ffmpeg-static`.

Assert no secret/source leak (fail the task if any hit):

```bash
set -euo pipefail
grep -E '(^|/)\.env($|[^.])|/src/|/tests/|ffmpeg-static' /tmp/mf-pack.txt && { echo "LEAK in tarball — fix files[]/.npmignore before publish"; exit 1; } || echo "tarball clean"
```

- [ ] **Step 4: Point the marketplace entry at npm**

In the repo-root `.claude-plugin/marketplace.json`, change the `media-forge` plugin `source` from `"./media-forge"` to the npm form (keep `name`, `description`, `skills`):

```json
{
  "name": "media-forge",
  "source": { "source": "npm", "package": "media-forge" },
  "description": "Production-grade image and video generation ...",
  "skills": [ "./skills/audit", "...keep existing list..." ]
}
```

Note: confirm the exact npm-source schema against `https://code.claude.com/docs/en/plugin-marketplaces` at execution time; if the published package name must be scoped (e.g. `@maxvision/media-forge`), update both `package.json` `name` and this entry together.

- [ ] **Step 5: Commit (do NOT publish yet)**

```bash
set -euo pipefail
cd media-forge
git add package.json
cd ..
git add .claude-plugin/marketplace.json media-forge/scripts 2>/dev/null || true
git commit -m "build(dist): ship prebuilt via npm; point marketplace at npm source; drop empty install-deps stubs"
```

**Deploy sequencing (F3 — do NOT reorder):** the `marketplace.json` `source: npm` flip (Step 4) only works AFTER the package exists on npm. Correct order: (1) Task 12 CI or manual `pnpm publish` lands `media-forge@<version>` on npm, (2) THEN commit/push the `marketplace.json` npm-source flip. Flipping the marketplace before the first publish breaks every install. Until the first publish, keep `source: ./media-forge` so local/dev installs still work.

Publishing is gated on the legal checklist below. With Task 12 (CI release) in scope, the canonical publish path is `git tag media-forge-v<x.y.z> && git push --tags`, not a manual `pnpm publish`.

---

## PHASE 3 — Commercial hardening + CI (added by CEO review 2026-05-30, SELECTIVE EXPANSION)

### Task 11: Close the silent-failure gap on sharp (F1 — CRITICAL)

**Why:** `ensure-deps.mjs` swallows install errors (exit 0) so a failed sharp install is invisible until a sharp-using tool throws a raw `Cannot find module 'sharp'`. For a paid product that is a support ticket. Surface it early and name it.

**Files:**
- Create: `src/core/native-deps.ts`
- Test: `tests/unit/core/native-deps.test.ts`
- Modify: `src/mcp/server.ts` (startup assert), `src/cli/cli.ts` (startup assert), `src/cli/commands/doctor.ts` (sharp check)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core/native-deps.test.ts
import { describe, it, expect } from 'vitest';
import { checkSharp } from '../../../src/core/native-deps.js';

describe('checkSharp', () => {
  it('returns ok=true when sharp resolves (installed in dev)', () => {
    const r = checkSharp();
    expect(r).toHaveProperty('ok');
    // In the dev tree sharp is a devDependency, so it resolves.
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/core/native-deps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/core/native-deps.ts
// sharp is installed at runtime into ${CLAUDE_PLUGIN_DATA}/node_modules by the
// ensure-deps SessionStart hook. If that install failed (no npm, offline, proxy,
// EACCES), surface a NAMED, actionable error instead of a raw module-not-found.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface NativeDepCheck {
  ok: boolean;
  hint?: string;
}

export function checkSharp(): NativeDepCheck {
  try {
    require.resolve('sharp');
    return { ok: true };
  } catch {
    return {
      ok: false,
      hint: 'sharp is not installed. Run `media-forge doctor`. If it persists, ensure npm is on PATH and re-open the session so ensure-deps can install it.',
    };
  }
}

export class SharpUnavailableError extends Error {
  constructor(hint: string) {
    super(hint);
    this.name = 'SharpUnavailableError';
  }
}

// Call once at MCP server / CLI startup. Throws a named error the surface layer
// can present cleanly, instead of letting a deep `import sharp` crash raw.
export function assertSharp(): void {
  const r = checkSharp();
  if (!r.ok) throw new SharpUnavailableError(r.hint!);
}
```

- [ ] **Step 4: Wire startup asserts + doctor**

In `src/mcp/server.ts` and `src/cli/cli.ts`, call `assertSharp()` early in the bootstrap path, wrapped so the surface prints the friendly message (MCP: return an error tool-result / log; CLI: print `err.message` and exit non-zero) rather than a stack trace.

In `src/cli/commands/doctor.ts`, add a `sharp` check mirroring the ffmpeg one (Task 4): extend `DoctorResult.checks` with `sharp: { ok: boolean; hint?: string }` using `checkSharp()`. Like ffmpeg, sharp-missing is advisory in the printed report but, unlike ffmpeg, it gates the image pipeline — so mark it prominently.

- [ ] **Step 5: Run + commit**

Run: `pnpm vitest run tests/unit/core/native-deps.test.ts && pnpm typecheck`
Expected: PASS.

```bash
set -euo pipefail
cd media-forge
git add src/core/native-deps.ts tests/unit/core/native-deps.test.ts src/mcp/server.ts src/cli/cli.ts src/cli/commands/doctor.ts
git commit -m "feat(native-deps): named SharpUnavailableError + doctor check (close silent-failure gap)"
```

### Task 12: CI release automation (Expansion A)

**Why:** Every release must be built+tested identically. Manual `pnpm publish` risks shipping a stale/un-built dist. Tag-driven CI removes human error.

**Files:**
- Create: `media-forge/.github/workflows/release.yml` (or repo-root `.github/workflows/` if the monorepo centralizes CI — check existing `.github/` layout first)

- [ ] **Step 1: Create the workflow**

```yaml
name: media-forge release
on:
  push:
    tags: ['media-forge-v*']
jobs:
  release:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: media-forge } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '22.5.0', registry-url: 'https://registry.npmjs.org' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck && pnpm lint && pnpm test && pnpm build
      - run: pnpm publish --no-git-checks --access public
        env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
```

- [ ] **Step 2: Document the release ritual**

Add to `media-forge/CONTRIBUTING.md` (Releasing section): bump version, `git tag media-forge-v<x.y.z>`, `git push --tags` → CI builds, tests, publishes. Add `NPM_TOKEN` to repo secrets (manual, one-time, do NOT commit).

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities
git add media-forge/.github/workflows/release.yml media-forge/CONTRIBUTING.md
git commit -m "ci(media-forge): tag-driven npm release (build+test+publish)"
```

### Task 13: Clean-machine install test in CI (Expansion B)

**Why:** Proves "install and it works" on a runner WITHOUT the dev toolchain, across OSes — catches per-OS native-dep regressions (sharp) before a customer does.

**Files:**
- Create: `media-forge/.github/workflows/install-smoke.yml`

- [ ] **Step 1: Create the matrix smoke workflow**

```yaml
name: media-forge install smoke
on: [push, pull_request]
jobs:
  install-smoke:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    defaults: { run: { working-directory: media-forge } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22.5.0' }
      # Build the package tarball the way users receive it.
      - run: npm pack
      # Simulate plugin install: extract tarball to a temp "plugin root",
      # run ensure-deps with a temp CLAUDE_PLUGIN_DATA, assert sharp resolves
      # and the bundled CLI boots.
      - run: node .github/scripts/install-smoke.mjs
```

- [ ] **Step 2: Create the smoke driver**

Create `media-forge/.github/scripts/install-smoke.mjs` that: extracts the packed tarball to a temp dir, sets `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` to temp dirs, runs `hooks/ensure-deps.mjs`, then asserts a representative set of the externalized deps resolves from `CLAUDE_PLUGIN_DATA/node_modules` — at minimum `sharp` (native), `pg` (dynamic-require), and `@google-cloud/vision` (grpc/protobuf) — and that `node dist/cli/cli.js --help` exits 0 with `NODE_PATH` pointed at the data dir. Verifying pg + vision (not just sharp) is the guard that Approach Y actually resolves the deps that would have broken under bundling. Exit non-zero on any failure so the matrix job goes red.

- [ ] **Step 3: Commit**

```bash
set -euo pipefail
cd /c/Users/MaxVision/Desktop/cursor-oficial/maxvision-utilities
git add media-forge/.github/workflows/install-smoke.yml media-forge/.github/scripts/install-smoke.mjs
git commit -m "ci(media-forge): clean-machine install smoke across OS matrix"
```

---

## Phase 2 exit criteria + pre-launch checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green.
- [ ] `pnpm build` produces fresh `dist/` (includes P15/P16 Kling/Seedance — current `dist/` is stale from 2026-05-26).
- [ ] `plugin validate . --strict` clean.
- [ ] Clean-machine install test: on a machine WITHOUT the dev toolchain, install the plugin, start a session, confirm `ensure-deps` installs sharp and the MCP server connects (`claude --debug` shows no init error).
- [ ] `media-forge doctor` reports config + ffmpeg + outputDir.
- [ ] **Legal (gate before `pnpm publish`):**
  - [ ] Confirm no `ffmpeg-static` (GPL) ships in the npm tarball (`pnpm pack --dry-run` shows it absent).
  - [ ] Confirm `sharp` (Apache-2.0) + bundled `libvips` (LGPL-2.1) license tree is acceptable for commercial redistribution; include required attributions in `NOTICE`.
  - [ ] If any video transcode/encode feature is added later that needs x264/x265, re-open the GPL + MPEG-LA/Via patent review.

---

## Self-Review

**Spec coverage:** ffmpeg decoupling (Tasks 1-5) ✓; build/ship without user build (Tasks 6-10) ✓; CLAUDE_PLUGIN_DATA native-dep pattern (Tasks 8-9) ✓; marketplace distribution (Task 10) ✓; Node version + stale-dist fixes (Tasks 6, exit criteria) ✓; legal gate (checklist) ✓.

**Type consistency:** `resolveFfmpegPath` / `resolveFfmpegPathOrNull` / `FfmpegNotFoundError` / `__resetFfmpegCache` defined in Task 1 and used verbatim in Tasks 2, 3, 4. `DoctorResult.checks.ffmpeg: { ok; path?; hint? }` defined and asserted consistently in Task 4.

**Known execution-time verifications (flagged inline, not placeholders):**
- Task 4 harness name (`runDoctor` vs existing exported function) — inspect `tests/unit/cli/doctor.test.ts` and mirror it.
- Task 9 `bin/media-forge` — delete the placeholder `existsSync` import line; keep only the NODE_PATH/`_initPaths` block.
- Task 10 npm-source schema + package name scoping — confirm against the official marketplace doc at execution time.

## MAXVISION ORCHESTRATION REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_resolved | SELECTIVE EXPANSION; 2 expansions + 1 critical fix accepted (T11-T13); F2/F3/F4 hardening folded |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_resolved | A1 bundling fix accepted (Approach Y); T7/T8/T13 revised; manifest-sync guard added |
| Codex/Outside Voice | `/codex review` | Independent 2nd opinion | 0 | skipped | offered, deferred to keep momentum |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | no UI scope |

- **UNRESOLVED:** 0 — all surfaced decisions answered (Approach A, SELECTIVE EXPANSION, F1 fix, Expansions A+B, A1 Approach Y).
- **CRITICAL GAPS:** 0 open — F1 silent-failure closed by Task 11; A1 bundling-breakage closed by Approach Y (Tasks 7/8/13).
- **VERDICT:** CEO + ENG CLEARED — plan ready to implement. Legal checklist (ffmpeg GPL absence, libvips LGPL) remains a manual gate before `pnpm publish`.
