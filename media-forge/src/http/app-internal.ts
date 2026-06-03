import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../mcp/server.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/storage.js';
import type { AuthContext } from './auth.js';
import type { GalleryStore } from '../gallery/gallery-store.js';
import { CreditClient } from '../billing/credit-client.js';

export interface McpRequestOpts {
  galleryStore?: GalleryStore;
}

export async function handleMcpRequest(
  req: Request,
  ctx: AuthContext,
  env: NodeJS.ProcessEnv = process.env,
  mcpOpts: McpRequestOpts = {},
): Promise<Response> {
  // Stateless: server + transport frescos por request.
  // env e passado para loadConfig para que testes possam injetar variaveis sem
  // afetar process.env global.
  // F-C: ctx.tier propaga para gating de tools; ctx.tenantId disponivel para audit/billing futuro.
  // F-B: storage opcional — quando MINIO_* configurado, handlers retornam signed URL.
  // F-I: galleryStore + tenantId propagados para list_my_generations.
  const config = loadConfig(env);
  const storage = outputStorageFromConfig(config);
  // F-E: build a per-request CreditClient ONLY when both CREDIT_API_URL + CREDIT_API_KEY are
  // set. Missing either => billing OFF (self-host / hosted-sem-billing) => creditClient
  // undefined => every debit wrapper hits its no-op passthrough. Stateless: one instance per
  // request is acceptable (the client holds no per-request state).
  const creditApiUrl = env.CREDIT_API_URL;
  const creditApiKey = env.CREDIT_API_KEY;
  const creditClient =
    creditApiUrl && creditApiKey
      ? new CreditClient({ baseUrl: creditApiUrl, apiKey: creditApiKey })
      : undefined;
  const server = buildServer({
    config,
    storage: storage ?? undefined,
    tier: ctx.tier,
    galleryStore: mcpOpts.galleryStore,
    tenantId: ctx.tenantId,
    creditClient,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
