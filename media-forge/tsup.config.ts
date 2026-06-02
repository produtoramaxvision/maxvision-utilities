import { defineConfig } from 'tsup';

export default defineConfig([
  // Main bundles: index, mcp/server, cli — bundled fully (no cross-entry imports).
  {
    entry: {
      index: 'src/index.ts',
      'mcp/server': 'src/mcp/server.ts',
      'cli/cli': 'src/cli/cli.ts',
      // Refs module — emitted as individual files so hooks/inject-refs.mjs can
      // dynamically import them at runtime without requiring a full TS pipeline.
      'refs/taxonomy': 'src/refs/taxonomy.ts',
      'refs/refs-service': 'src/refs/refs-service.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    target: 'node20',
    outDir: 'dist',
    shims: false,
  },
  // HTTP server bundle: mcp/server is marked external so its top-level
  // startup guard (process.argv[1] check) does not run inside this bundle.
  // At runtime, node resolves the external import to dist/mcp/server.js.
  {
    entry: {
      'http/server': 'src/http/server.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: false,
    target: 'node20',
    outDir: 'dist',
    shims: false,
    external: [/.*mcp\/server\.js$/, /.*mcp\/server$/],
  },
]);
