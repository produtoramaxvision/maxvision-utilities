import { serve } from '@hono/node-server';
import { buildHttpApp } from './app.js';
import { logger } from '../core/logger.js';

export function startHttpServer(): void {
  const port = Number(process.env['MEDIA_FORGE_HTTP_PORT'] ?? 8787);
  const app = buildHttpApp();
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
  logger.info('media-forge MCP HTTP server ready', { port });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHttpServer();
}
