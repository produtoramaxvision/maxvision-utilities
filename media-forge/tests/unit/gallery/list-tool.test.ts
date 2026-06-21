// media-forge/tests/unit/gallery/list-tool.test.ts
import { describe, it, expect } from 'vitest';

describe('list_my_generations input contract', () => {
  it('page deve ser >= 1', async () => {
    const { ListMyGenerationsInput } = await import('../../../src/mcp/schemas.js');
    expect(ListMyGenerationsInput.safeParse({ page: 0 }).success).toBe(false);
    expect(ListMyGenerationsInput.safeParse({ page: 1, page_size: 20 }).success).toBe(true);
  });

  it('page_size maior que 100 eh rejeitado', async () => {
    const { ListMyGenerationsInput } = await import('../../../src/mcp/schemas.js');
    expect(ListMyGenerationsInput.safeParse({ page: 1, page_size: 101 }).success).toBe(false);
  });
});
