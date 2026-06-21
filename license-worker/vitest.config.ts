import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    pool: '@cloudflare/vitest-pool-workers',
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Injeta o secret de admin para os testes (nunca no wrangler.toml em produção)
          bindings: {
            LICENSE_ADMIN_SECRET: 'test-admin-secret',
          },
        },
      },
    },
  },
});
