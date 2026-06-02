import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../mcp/server.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/storage.js';
import type { AuthContext } from './auth.js';

export async function handleMcpRequest(
  req: Request,
  ctx: AuthContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  // Stateless: server + transport frescos por request.
  // env e passado para loadConfig para que testes possam injetar variaveis sem
  // afetar process.env global.
  // F-C: ctx.tier propaga para gating de tools; ctx.tenantId disponivel para audit/billing futuro.
  // F-B: storage opcional — quando MINIO_* configurado, handlers retornam signed URL.
  const config = loadConfig(env);
  const storage = outputStorageFromConfig(config);
  const server = buildServer({ config, storage: storage ?? undefined, tier: ctx.tier });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
