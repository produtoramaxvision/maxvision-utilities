import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(__dir, '../../../plugins/media-forge-hosted/.claude-plugin');
const raw = readFileSync(join(pluginRoot, 'plugin.json'), 'utf-8');
const plugin = JSON.parse(raw) as Record<string, unknown>;

describe('media-forge-hosted plugin.json -- schema', () => {
  it('name is media-forge-hosted', () => {
    expect(plugin['name']).toBe('media-forge-hosted');
  });

  it('mcpServers.media-forge.type is http', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    expect(servers?.['media-forge']?.['type']).toBe('http');
  });

  it('mcpServers.media-forge.url is the canonical hosted URL (static, no interpolation)', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const url = servers?.['media-forge']?.['url'] as string;
    expect(url).toBe('https://media-forge.produtoramaxvision.com.br/mcp');
  });

  it('mcpServers.media-forge.headers.Authorization uses MEDIA_FORGE_API_KEY', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const headers = servers?.['media-forge']?.['headers'] as Record<string, string>;
    expect(headers?.['Authorization']).toMatch(/Bearer.*MEDIA_FORGE_API_KEY/);
  });

  it('mcpServers.media-forge.headers has X-MaxVision-License', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const headers = servers?.['media-forge']?.['headers'] as Record<string, string>;
    expect(headers?.['X-MaxVision-License']).toBeDefined();
  });

  it('has no command/args/env (is not a stdio plugin)', () => {
    const servers = plugin['mcpServers'] as Record<string, Record<string, unknown>>;
    const server = servers?.['media-forge'];
    expect(server?.['command']).toBeUndefined();
    expect(server?.['args']).toBeUndefined();
    expect(server?.['env']).toBeUndefined();
  });

  it('version semver present', () => {
    expect((plugin['version'] as string)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('author.email is produtoramaxvision@gmail.com', () => {
    const author = plugin['author'] as Record<string, string>;
    expect(author?.['email']).toBe('produtoramaxvision@gmail.com');
  });
});
