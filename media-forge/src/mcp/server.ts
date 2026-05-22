// src/mcp/server.ts
// MCP stdio server entry point.
// CRITICAL: stdout is exclusively reserved for JSON-RPC messages.
// All logging goes through logger (which writes to stderr only).
// Never use console.log here or in any code path reachable from this file.
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import { createClient } from '../core/client.js';
import { registerAllTools } from './handlers.js';

export interface BuildServerOpts {
  // Injection point for tests — config + client come from outside in tests
  config?: ReturnType<typeof loadConfig>;
  client?: ReturnType<typeof createClient>;
}

export function buildServer(opts: BuildServerOpts = {}): McpServer {
  const config = opts.config ?? loadConfig(process.env as Record<string, string | undefined>);
  const client = opts.client ?? createClient({ config });
  const server = new McpServer({ name: 'media-forge', version: '0.1.0' });
  registerAllTools(server, { client, config });
  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('media-forge MCP server ready on stdio');
}

// Entry point when executed directly
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startStdioServer().catch((err) => {
    logger.error('media-forge MCP server fatal', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
