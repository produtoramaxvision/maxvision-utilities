import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/golden/**/*.test.ts'],
    // live-smoke and plugin-dispatch are runtime-gated via describe.skipIf —
    // including them at config level lets the live-smoke pnpm script filter
    // by path without an exclude conflict. Default runs skip them via env.
    testTimeout: 60_000,
  },
});
