import { describe, it, expect } from 'vitest';
import { TIER_GATES, isToolAllowed } from '../../../src/http/tier-gates.js';
import { MCP_TOOLS } from '../../../src/mcp/schemas.js';

describe('TIER_GATES', () => {
  it('free tem acesso a media_generate_image', () => {
    expect(isToolAllowed('free', 'media_generate_image')).toBe(true);
  });

  it('free NÃO tem acesso a media_generate_video_t2v', () => {
    expect(isToolAllowed('free', 'media_generate_video_t2v')).toBe(false);
  });

  it('free NÃO tem acesso a nenhuma tool Higgsfield', () => {
    const higgsfieldTools = [...TIER_GATES.pro].filter((t) => t.startsWith('media_higgsfield'));
    for (const tool of higgsfieldTools) {
      expect(isToolAllowed('free', tool), `free should not have ${tool}`).toBe(false);
    }
  });

  it('creator tem acesso a media_generate_video_t2v', () => {
    expect(isToolAllowed('creator', 'media_generate_video_t2v')).toBe(true);
  });

  it('creator NÃO tem acesso a refs tools', () => {
    expect(isToolAllowed('creator', 'media_refs_search')).toBe(false);
  });

  it('pro tem acesso a todas as tools', () => {
    expect(isToolAllowed('pro', 'media_refs_search')).toBe(true);
    expect(isToolAllowed('pro', 'media_generate_video_t2v')).toBe(true);
    expect(isToolAllowed('pro', 'media_generate_image')).toBe(true);
  });

  it('pro tem mais tools que creator', () => {
    expect(TIER_GATES.pro.size).toBeGreaterThan(TIER_GATES.creator.size);
  });

  it('creator tem mais tools que free', () => {
    expect(TIER_GATES.creator.size).toBeGreaterThan(TIER_GATES.free.size);
  });

  it('pro.size === MCP_TOOLS.length (pro tem todas as tools do registry)', () => {
    expect(TIER_GATES.pro.size).toBe(MCP_TOOLS.length);
  });

  it('todas as tools de free e creator estao em pro', () => {
    for (const tool of TIER_GATES.free) {
      expect(TIER_GATES.pro.has(tool), `pro should have free tool ${tool}`).toBe(true);
    }
    for (const tool of TIER_GATES.creator) {
      expect(TIER_GATES.pro.has(tool), `pro should have creator tool ${tool}`).toBe(true);
    }
  });
});
