import { describe, it, expect } from 'vitest';
import { buildServer } from '../../../src/mcp/server.js';
import { loadConfig } from '../../../src/core/config.js';

// Hermético: injeta config com credencial stub para isolar a variável sob teste
// (storage). buildServer cria o client Google eagerly; sem creds ele lançaria
// ConfigError — irrelevante aqui. Não depende de .env ambiente (passava local,
// quebrava no CI sem GOOGLE_API_KEY).
const config = loadConfig({ GOOGLE_API_KEY: 'test-key' } as NodeJS.ProcessEnv);

describe('buildServer com storage injetado', () => {
  it('não lança sem storage (degradação graciosa)', () => {
    // Sem storage: handlers funcionam, artefatos ficam no disco (modo legado)
    expect(() => buildServer({ config })).not.toThrow();
  });

  it('não lança com storage undefined', () => {
    expect(() => buildServer({ config, storage: undefined })).not.toThrow();
  });
});
