import { describe, it, expect } from 'vitest';
import { buildServer } from '../../../src/mcp/server.js';

describe('buildServer com storage injetado', () => {
  it('não lança sem storage (degradação graciosa)', () => {
    // Sem storage: handlers funcionam, artefatos ficam no disco (modo legado)
    expect(() => buildServer({})).not.toThrow();
  });

  it('não lança com storage undefined', () => {
    expect(() => buildServer({ storage: undefined })).not.toThrow();
  });
});
