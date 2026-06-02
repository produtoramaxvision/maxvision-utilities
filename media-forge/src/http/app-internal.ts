import type { AuthContext } from './auth.js';

export async function handleMcpRequest(_req: Request, _ctx: AuthContext): Promise<Response> {
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}
