// src/video/providers/kling-elements.ts
// REST wrapper for Kling elements lifecycle (create / list / delete).
// NOT routed through KlingProvider — elements are a separate API surface
// that does not go through the VideoProvider generate/poll cycle.
//
// FIX (Codex P2 round 14, PR#11): CREATE endpoint corrected from
// /v1/elements/create to the documented /v1/general/advanced-custom-elements/
// per kling.ai/document-api/apiReference/model/element. Body shape rewritten
// to the documented schema (element_name + element_description + reference_type
// + element_image_list). Response is ASYNC (task_id + task_status); we poll
// until succeed/failed before returning the element_id.
// List/delete paths remain UNVERIFIED — first 404 will trigger correction.

import { getKlingAuthHeader, type KlingEnvSubset } from './auth/kling-jwt.js';

const KLING_API_BASE = 'https://api-singapore.klingai.com';
const CREATE_ELEMENT_POLL_INTERVAL_MS = 2000;
const CREATE_ELEMENT_POLL_TIMEOUT_MS = 60_000;

export interface CreateElementArgs {
  readonly env: KlingEnvSubset;
  readonly fetchImpl?: typeof fetch;
  readonly imageUrl?: string;
  readonly imageBase64?: string;
  readonly displayName: string;
  readonly category?: 'character' | 'product' | 'location';
  /** Optional poll override for tests. */
  readonly pollIntervalMs?: number;
  /** Optional timeout override for tests. */
  readonly pollTimeoutMs?: number;
}

export interface ElementMetadata {
  readonly elementId: string;
  readonly displayName: string;
  readonly category?: string;
  readonly createdAt: string;
}

interface CreateElementResponse {
  readonly code?: number;
  readonly message?: string;
  readonly data?: {
    readonly task_id?: string;
    readonly task_status?: 'submitted' | 'processing' | 'succeed' | 'failed' | string;
    readonly task_status_msg?: string;
    /**
     * Some Kling endpoints return element_id directly in the create response when the
     * job completes synchronously; we honour that fast-path before falling back to poll.
     */
    readonly element_id?: string;
    readonly task_result?: {
      readonly element_id?: string;
    };
  };
}

export async function createKlingElement(args: CreateElementArgs): Promise<ElementMetadata> {
  if (!args.imageUrl && !args.imageBase64) {
    throw new Error('createKlingElement: either imageUrl or imageBase64 required');
  }
  if (args.imageUrl && args.imageBase64) {
    throw new Error('createKlingElement: provide imageUrl OR imageBase64, not both');
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const auth = getKlingAuthHeader(args.env);
  const frontalImage = args.imageUrl ?? args.imageBase64;
  const body: Record<string, unknown> = {
    element_name: args.displayName,
    // Docs require non-empty element_description; fall back to displayName when omitted.
    element_description: args.displayName,
    reference_type: 'image_refer',
    element_image_list: {
      frontal_image: frontalImage,
      refer_images: [],
    },
  };
  if (args.category) {
    // Map category → docs tag_list with documented tag_id values:
    //   o_102 Character / o_104 Item / o_106 Scene.
    const tagId =
      args.category === 'character' ? 'o_102' :
      args.category === 'product' ? 'o_104' :
      args.category === 'location' ? 'o_106' : undefined;
    if (tagId) body.tag_list = [{ tag_id: tagId }];
  }
  const res = await fetchImpl(`${KLING_API_BASE}/v1/general/advanced-custom-elements/`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `Kling element create ${res.status}: ${err.message ?? '(no message)'}`,
    );
  }
  const payload = (await res.json()) as CreateElementResponse;
  if (payload.code !== 0 || !payload.data) {
    throw new Error(
      `Kling element create returned code ${payload.code}: ${payload.message ?? '(no message)'}`,
    );
  }

  // Sync fast-path: some legacy Kling environments still return element_id directly.
  const syncElementId = payload.data.element_id ?? payload.data.task_result?.element_id;
  if (syncElementId) {
    return {
      elementId: syncElementId,
      displayName: args.displayName,
      ...(args.category ? { category: args.category } : {}),
      createdAt: new Date().toISOString(),
    };
  }

  const taskId = payload.data.task_id;
  if (!taskId) {
    throw new Error(
      `Kling element create: response missing both element_id and task_id (got code=${payload.code})`,
    );
  }

  // Async path: poll the documented task lifecycle until succeed/failed.
  const intervalMs = args.pollIntervalMs ?? CREATE_ELEMENT_POLL_INTERVAL_MS;
  const timeoutMs = args.pollTimeoutMs ?? CREATE_ELEMENT_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Kling element create: timed out after ${timeoutMs}ms waiting for task_id=${taskId}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const pollRes = await fetchImpl(
      `${KLING_API_BASE}/v1/general/advanced-custom-elements/${encodeURIComponent(taskId)}`,
      { method: 'GET', headers: { ...auth } },
    );
    if (!pollRes.ok) {
      const err = (await pollRes.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        `Kling element create poll ${pollRes.status}: ${err.message ?? '(no message)'}`,
      );
    }
    const pollPayload = (await pollRes.json()) as CreateElementResponse;
    const status = pollPayload.data?.task_status;
    if (status === 'failed') {
      throw new Error(
        `Kling element create failed: ${pollPayload.data?.task_status_msg ?? '(no message)'}`,
      );
    }
    if (status === 'succeed') {
      const id =
        pollPayload.data?.element_id ?? pollPayload.data?.task_result?.element_id;
      if (!id) {
        throw new Error(
          `Kling element create: task ${taskId} succeeded but no element_id in result`,
        );
      }
      return {
        elementId: id,
        displayName: args.displayName,
        ...(args.category ? { category: args.category } : {}),
        createdAt: new Date().toISOString(),
      };
    }
    // submitted / processing → keep polling.
  }
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
