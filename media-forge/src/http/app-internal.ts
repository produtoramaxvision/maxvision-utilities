import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from '../mcp/server.js';
import { loadConfig } from '../core/config.js';
import { outputStorageFromConfig } from '../output/storage.js';
import type { AuthContext } from './auth.js';

export async function handleMcpRequest(
  req: Request,
  _ctx: AuthContext,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  // Stateless: server + transport frescos por request.
  // env é passado para loadConfig para que testes possam injetar variáveis sem
  // afetar process.env global. _ctx carrega o tenant em F-C (injeção nos
  // handlers); em F-A é só a apiKey.
  // F-B: storage opcional — quando MINIO_* configurado, handlers retornam signed URL.
  // BuildServerOpts.storage é adicionado na Task 5; aqui (Task 4) só computamos o cliente.
  const config = loadConfig(env);
  const storage = outputStorageFromConfig(config);
  void storage;
  const server = buildServer({ config });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
