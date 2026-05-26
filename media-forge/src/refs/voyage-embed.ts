const VOYAGE_URL = 'https://api.voyageai.com/v1/multimodalembeddings';
const MODEL = 'voyage-multimodal-3';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const CIRCUIT_BREAK_THRESHOLD = 5;

let consecutiveFailures = 0;

export class VoyageCircuitOpenError extends Error {
  constructor() {
    super('Voyage circuit breaker open — bailing');
    this.name = 'VoyageCircuitOpenError';
  }
}

export interface EmbedResult {
  vector: Float32Array;
}

// Test helper: reset circuit state between test cases
export function _resetCircuitForTests(): void {
  consecutiveFailures = 0;
}

export async function embedImages(jpegs: Buffer[], apiKey: string): Promise<EmbedResult[]> {
  if (!apiKey) throw new Error('Voyage API key missing (VOYAGE_API_KEY)');
  if (consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD) throw new VoyageCircuitOpenError();

  const inputs = jpegs.map((b) => ({
    content: [{ type: 'image_base64', image_base64: `data:image/jpeg;base64,${b.toString('base64')}` }],
  }));
  const body = JSON.stringify({ inputs, model: MODEL, input_type: 'document', truncation: true });

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(VOYAGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body,
      });
    } catch (err) {
      lastErr = err as Error;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * Math.pow(2, attempt)));
      }
      continue;
    }
    if (resp.status === 429 || resp.status >= 500) {
      lastErr = new Error(`Voyage transient ${resp.status}`);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * Math.pow(2, attempt)));
      }
      continue;
    }
    if (!resp.ok) {
      consecutiveFailures += 1;
      throw new Error(`Voyage failed (${resp.status}): ${await resp.text()}`);
    }
    const json = (await resp.json()) as { data: Array<{ embedding: number[] }> };
    consecutiveFailures = 0;
    return json.data.map((d) => ({ vector: Float32Array.from(d.embedding) }));
  }
  consecutiveFailures += 1;
  throw lastErr ?? new Error('Voyage embedding failed after retries');
}
