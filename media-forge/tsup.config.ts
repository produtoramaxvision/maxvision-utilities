import { defineConfig } from 'tsup';

export default defineConfig({
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
});
