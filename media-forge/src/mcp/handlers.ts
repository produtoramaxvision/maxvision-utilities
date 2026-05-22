// src/mcp/handlers.ts — STUB for 8.1 (8.2 will register 22 tools)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface HandlersDeps {
  client: unknown; // tightened in 8.2
  config: unknown; // tightened in 8.2
}

export function registerAllTools(_server: McpServer, _deps: HandlersDeps): void {
  // 8.2 will register 22 tools here
}
