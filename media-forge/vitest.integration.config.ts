import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/golden/**/*.test.ts'],
    exclude: [
      'tests/integration/live-smoke.test.ts',
    ],
    testTimeout: 60_000,
  },
});
