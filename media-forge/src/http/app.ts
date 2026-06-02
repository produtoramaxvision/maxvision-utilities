// Hono app do transporte HTTP. /mcp delega a handleMcpRequest (Task 4 liga ao McpServer).
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';

export interface HttpAppOpts {
  env?: NodeJS.ProcessEnv;
}

export function buildHttpApp(opts: HttpAppOpts = {}) {
  const env = opts.env ?? process.env;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/metrics', (c) =>
    c.text('# media-forge metrics\n', 200, { 'content-type': 'text/plain; version=0.0.4' }),
  );

  app.post('/mcp', async (c) => {
    const auth = resolveAuth(c.req.header('Authorization'), env);
    if (!auth.ok) return c.json({ error: 'unauthorized', reason: auth.reason }, 401);
    return handleMcpRequest(c.req.raw, auth.ctx);
  });

  return app;
}
