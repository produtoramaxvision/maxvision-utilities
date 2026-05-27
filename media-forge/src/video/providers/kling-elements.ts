// src/video/providers/kling-elements.ts
// REST wrapper for Kling elements lifecycle (create / list / delete).
// NOT routed through KlingProvider — elements are a separate API surface
// that does not go through the VideoProvider generate/poll cycle.
//
// UNVERIFIED endpoint paths — Kling docs (context7) suggest
// /v1/general/advanced-custom-elements/ for CREATE; first 404 should trigger
// correction. List/delete paths are similarly unverified.
// Execution Amendment A11 will capture the correction once prod first-call confirms.

import { getKlingAuthHeader, type KlingEnvSubset } from './auth/kling-jwt.js';

const KLING_API_BASE = 'https://api-singapore.klingai.com';

export interface CreateElementArgs {
  readonly env: KlingEnvSubset;
  readonly fetchImpl?: typeof fetch;
  readonly imageUrl?: string;
  readonly imageBase64?: string;
  readonly displayName: string;
  readonly category?: 'character' | 'product' | 'location';
}

export interface ElementMetadata {
  readonly elementId: string;
  readonly displayName: string;
  readonly category?: string;
  readonly createdAt: string;
}

// UNVERIFIED — Kling docs (context7) suggest /v1/general/advanced-custom-elements/ for CREATE;
// first 404 should trigger correction.
export async function createKlingElement(args: CreateElementArgs): Promise<ElementMetadata> {
  if (!args.imageUrl && !args.imageBase64) throw new Error('createKlingElement: either imageUrl or imageBase64 required');
  if (args.imageUrl && args.imageBase64) throw new Error('createKlingElement: provide imageUrl OR imageBase64, not both');
  const fetchImpl = args.fetchImpl ?? fetch;
  const auth = getKlingAuthHeader(args.env);
  const res = await fetchImpl(`${KLING_API_BASE}/v1/elements/create`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: args.imageUrl,
      image_base64: args.imageBase64,
      name: args.displayName,
      ...(args.category ? { category: args.category } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(`Kling element create ${res.status}: ${(err as { message?: string }).message ?? '(no message)'}`);
  }
  const payload = (await res.json()) as { code?: number; data?: { element_id?: string } };
  if (payload.code !== 0 || !payload.data?.element_id) throw new Error(`Kling element create returned code ${payload.code}`);
  return {
    elementId: payload.data.element_id,
    displayName: args.displayName,
    category: args.category,
    createdAt: new Date().toISOString(),
  };
}

// UNVERIFIED — list endpoint path /v1/elements is inferred from pattern.
export async function listKlingElementsFromBackend(args: { env: KlingEnvSubset; fetchImpl?: typeof fetch }): Promise<ElementMetadata[]> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const auth = getKlingAuthHeader(args.env);
  const res = await fetchImpl(`${KLING_API_BASE}/v1/elements`, { method: 'GET', headers: { ...auth } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(`Kling element list ${res.status}: ${(err as { message?: string }).message ?? '(no message)'}`);
  }
  const payload = (await res.json()) as { code?: number; data?: { elements?: Array<Record<string, unknown>> } };
  return (payload.data?.elements ?? []).map((e) => ({
    elementId: String(e['element_id'] ?? ''),
    displayName: String(e['name'] ?? ''),
    category: e['category'] as string | undefined,
    createdAt: String(e['created_at'] ?? new Date().toISOString()),
  }));
}

// UNVERIFIED — delete endpoint path /v1/elements/{id} is inferred from pattern.
export async function deleteKlingElement(args: { env: KlingEnvSubset; fetchImpl?: typeof fetch; elementId: string }): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const auth = getKlingAuthHeader(args.env);
  const res = await fetchImpl(`${KLING_API_BASE}/v1/elements/${encodeURIComponent(args.elementId)}`, { method: 'DELETE', headers: { ...auth } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(`Kling element delete ${res.status}: ${(err as { message?: string }).message ?? '(no message)'}`);
  }
}
