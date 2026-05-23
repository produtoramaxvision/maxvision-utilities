import { z } from 'zod';

export interface ApiFieldError {
  field: string;
  code: string;
  expected?: string;
  received?: string;
  message: string;
  params?: Record<string, unknown>;
}

interface ZodIssueShape {
  code: string;
  path: PropertyKey[];
  message: string;
  // Common across v3 + v4
  expected?: string;
  received?: string;
  maximum?: number;
  minimum?: number;
  keys?: string[];
  params?: Record<string, unknown>;
  // v3
  options?: readonly unknown[];
  // v4
  input?: unknown;
  values?: readonly unknown[];
}

export function formatZodError(err: z.ZodError): ApiFieldError[] {
  return err.issues.map((rawIss): ApiFieldError => {
    const iss = rawIss as unknown as ZodIssueShape;
    const field = iss.path.map((p) => String(p)).join('.') || '(root)';

    // Received: prefer v4 `input` (raw value), else v3 `received` (type name or value)
    let received: string | undefined;
    if (iss.input !== undefined) {
      received =
        typeof iss.input === 'object' && iss.input !== null
          ? safeJson(iss.input)
          : String(iss.input);
    } else if (typeof iss.received === 'string') {
      received = iss.received;
    }

    // Expected: build human-readable bound based on code + available fields
    let expected: string | undefined;
    if (iss.code === 'invalid_type' && iss.expected) {
      expected = iss.expected;
    } else if (
      (iss.code === 'invalid_value' || iss.code === 'invalid_enum_value') &&
      (iss.values || iss.options)
    ) {
      const list = iss.values ?? iss.options ?? [];
      expected = `one of [${list.map((v) => JSON.stringify(v)).join(', ')}]`;
    } else if (iss.code === 'too_big' && typeof iss.maximum === 'number') {
      expected = `<= ${iss.maximum}`;
    } else if (iss.code === 'too_small' && typeof iss.minimum === 'number') {
      expected = `>= ${iss.minimum}`;
    } else if (iss.code === 'unrecognized_keys') {
      expected = 'no extra keys';
    }

    return {
      field,
      code: iss.code,
      ...(expected !== undefined ? { expected } : {}),
      ...(received !== undefined ? { received } : {}),
      message: iss.message,
      ...(iss.params !== undefined ? { params: iss.params } : {}),
    };
  });
}

// Zod v4 helpers (formatError is deprecated)
export function prettyZodError(err: z.ZodError): string {
  const fn = (z as unknown as { prettifyError?: (e: z.ZodError) => string }).prettifyError;
  if (typeof fn === 'function') return fn(err);
  // Fallback for Zod v3
  return err.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

export function treeZodError(err: z.ZodError): unknown {
  const fn = (z as unknown as { treeifyError?: (e: z.ZodError) => unknown }).treeifyError;
  if (typeof fn === 'function') return fn(err);
  return formatZodError(err);
}

export function flatZodError(err: z.ZodError): {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
} {
  const fn = (
    z as unknown as {
      flattenError?: (e: z.ZodError) => { formErrors: string[]; fieldErrors: Record<string, string[]> };
    }
  ).flattenError;
  if (typeof fn === 'function') return fn(err);
  const raw = err.flatten();
  const fieldErrors: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw.fieldErrors)) {
    if (v) fieldErrors[k] = v;
  }
  return { formErrors: raw.formErrors, fieldErrors };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserializable]';
  }
}
