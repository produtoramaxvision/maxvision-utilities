// Hono app do transporte HTTP. /mcp delega a handleMcpRequest (liga ao McpServer).
// /webhooks/:provider/:jobId monta o webhook Hono sub-app quando o secret está presente (F-B).
import { Hono } from 'hono';
import { resolveAuth } from './auth.js';
import { handleMcpRequest } from './app-internal.js';
import { buildWebhookApp } from './webhook-hono.js';

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
    return handleMcpRequest(c.req.raw, auth.ctx, env);
  });

  // F-B: monta o webhook app quando o secret está configurado. Sem secret = endpoint desabilitado.
  const secret = env['MEDIA_FORGE_WEBHOOK_SECRET'];
  if (secret && secret.length > 0) {
    const webhookApp = buildWebhookApp({ secret });
    // Guarda o sub-app no Hono app para injeção de handlers por startHttpServer / testes.
    (app as unknown as Record<string, unknown>).webhookApp = webhookApp;
    // Status com trailing slash: Hono mapeia o GET '/' do sub-app para '/webhooks'
    // (sem barra). Registramos '/webhooks/' explicitamente para que ambos os
    // formatos respondam 200 com a mesma lista de handlers (source: o próprio map).
    app.get('/webhooks/', (c) =>
      c.json({ status: 'ok', handlers: Array.from(webhookApp.webhookHandlers.keys()) }),
    );
    app.route('/webhooks', webhookApp as unknown as Hono);
  }

  return app;
}
