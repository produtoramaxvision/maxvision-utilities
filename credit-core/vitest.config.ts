import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    pool: 'forks',
    // Os três arquivos .int compartilham o mesmo Postgres embarcado e cada um faz
    // DROP TABLE no beforeAll. Serializar os arquivos (mantendo forks) evita que o
    // DROP de um corrompa os dados do outro em paralelo.
    fileParallelism: false,
    testTimeout: 30000, // initialise() do embedded-postgres na 1ª vez baixa/prepara o binário
  },
});
