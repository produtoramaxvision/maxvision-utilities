import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/**
 * Vite plugin that marks `node:sqlite` as external.
 *
 * vite-node 2.1.x (Oct 2024) does not include `sqlite` in its built-in modules
 * list because `node:sqlite` was still experimental and only available as a
 * prefixed import. Node 25 ships it as `node:sqlite` only (no unprefixed form).
 * The `isNodeBuiltin` helper in vite-node checks Node's `builtinModules` array,
 * which lists `node:sqlite` (prefixed) but vite-node's set is built from the
 * unprefixed names — so it misses the entry and tries to resolve it as a file.
 *
 * This plugin intercepts the resolve step and marks the id external before Vite
 * attempts to load it from disk.
 */
function nodeSqliteExternalPlugin(): Plugin {
  const VIRTUAL_ID = '\0node-sqlite-shim';
  return {
    name: 'node-sqlite-external',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'node:sqlite' || id === 'sqlite') {
        return VIRTUAL_ID;
      }
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ID) {
        // Use createRequire to load the native built-in synchronously without
        // going through Vite's resolver (which cannot resolve node: protocol builtins
        // not in its hard-coded list). The result is spread as named exports so
        // ESM consumers can destructure { DatabaseSync }.
        return `
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const _sqlite = _require('node:sqlite');
export const DatabaseSync = _sqlite.DatabaseSync;
export const StatementSync = _sqlite.StatementSync;
`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [nodeSqliteExternalPlugin()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/core/**/*.test.ts', 'tests/video/**/*.test.ts', 'tests/cli/**/*.test.ts', 'tests/mcp/**/*.test.ts', 'src/**/*.test.ts', 'tests/integration/p13-regression.test.ts', 'tests/integration/p14-regression.test.ts'],
    exclude: ['tests/integration/live-smoke.test.ts', 'tests/golden/**', 'tests/evals/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/types.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 15000,
  },
});
