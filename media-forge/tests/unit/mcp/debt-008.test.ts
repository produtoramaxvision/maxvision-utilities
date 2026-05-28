/**
 * Tests for DEBT-008: MCP tools/list inputSchema emission for ZodEffects-wrapped tools.
 *
 * Verifies that:
 * 1. All 30 tools expose a ZodObject as inputSchema (not ZodEffects).
 * 2. validateInput uses validationSchema (with superRefine) when present.
 * 3. validateInput falls back to inputSchema when validationSchema is absent.
 * 4. media_generate_video_t2v rejects 4k + durationSeconds=4 (superRefine rule).
 * 5. media_generate_image rejects mutually-exclusive thinkingLevel + thinkingBudget.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ZodObject, ZodEffects } from 'zod';
import { MCP_TOOLS, getMCPToolByName, type MCPTool } from '../../../src/mcp/schemas.js';

// ---------------------------------------------------------------------------
// Mirror of the validateInput helper from handlers.ts for unit testing
// (avoids importing private module internals; logic is trivial)
// ---------------------------------------------------------------------------
import type { ZodTypeAny } from 'zod';

function validateInput<T>(tool: MCPTool, input: unknown): T {
  const schema: ZodTypeAny = tool.validationSchema ?? tool.inputSchema;
  return schema.parse(input) as T;
}

// ---------------------------------------------------------------------------
// Test 1: all 30 tools expose a ZodObject (not ZodEffects) as inputSchema
// ---------------------------------------------------------------------------

describe('DEBT-008: tools/list inputSchema shape', () => {
  it('every tool exposes a ZodObject (not ZodEffects) as inputSchema', () => {
    expect(MCP_TOOLS.length).toBe(54);
    for (const tool of MCP_TOOLS) {
      const isZodObject = tool.inputSchema instanceof ZodObject;
      expect(
        isZodObject,
        `${tool.name}: inputSchema is ${tool.inputSchema.constructor.name}, expected ZodObject`,
      ).toBe(true);
    }
  });

  it('tools with superRefine carry a ZodEffects as validationSchema', () => {
    const affectedTools = [
      'media_generate_image',
      'media_edit_image',
      'media_generate_video_t2v',
      'media_generate_video_i2v',
      'media_generate_video_interpolate',
      'media_generate_video_with_refs',
    ];
    for (const name of affectedTools) {
      const tool = getMCPToolByName(name);
      expect(tool, `tool ${name} not found`).toBeDefined();
      expect(
        tool!.validationSchema instanceof ZodEffects,
        `${name}: validationSchema should be ZodEffects`,
      ).toBe(true);
    }
  });

  it('plain-ZodObject tools have no validationSchema set', () => {
    const plainTools = [
      'media_generate_imagen',
      'media_compose_scene',
      'media_describe_image',
      'media_extract_palette',
      'media_extend_video',
      'media_poll_video_operation',
      'media_download_video',
    ];
    for (const name of plainTools) {
      const tool = getMCPToolByName(name);
      expect(tool, `tool ${name} not found`).toBeDefined();
      expect(tool!.validationSchema).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: validateInput uses validationSchema when present
// ---------------------------------------------------------------------------

describe('DEBT-008: validateInput uses validationSchema when present', () => {
  it('applies cross-field superRefine when validationSchema exists', () => {
    const baseSchema = z.object({ x: z.number(), y: z.number() }).strict();
    const fullSchema = baseSchema.superRefine((v, ctx) => {
      if (v.x > 0 && v.y > 0) {
        ctx.addIssue({ code: 'custom', path: ['x'], message: 'x and y cannot both be positive' });
      }
    });
    const tool: MCPTool = {
      name: 'test_tool',
      description: 'test',
      inputSchema: baseSchema,
      validationSchema: fullSchema,
    };

    // base schema alone would pass — but validationSchema should reject it
    expect(baseSchema.safeParse({ x: 1, y: 1 }).success).toBe(true);
    expect(() => validateInput(tool, { x: 1, y: 1 })).toThrow(z.ZodError);
  });

  it('passes valid input when cross-field rule is satisfied', () => {
    const baseSchema = z.object({ x: z.number(), y: z.number() }).strict();
    const fullSchema = baseSchema.superRefine((v, ctx) => {
      if (v.x > 0 && v.y > 0) {
        ctx.addIssue({ code: 'custom', path: ['x'], message: 'x and y cannot both be positive' });
      }
    });
    const tool: MCPTool = {
      name: 'test_tool',
      description: 'test',
      inputSchema: baseSchema,
      validationSchema: fullSchema,
    };

    // x=-1 satisfies rule → passes
    const result = validateInput<{ x: number; y: number }>(tool, { x: -1, y: 1 });
    expect(result).toEqual({ x: -1, y: 1 });
  });
});

// ---------------------------------------------------------------------------
// Test 3: validateInput falls back to inputSchema when validationSchema absent
// ---------------------------------------------------------------------------

describe('DEBT-008: validateInput falls back to inputSchema', () => {
  it('uses inputSchema directly when validationSchema is not set', () => {
    const tool = getMCPToolByName('media_generate_imagen');
    expect(tool).toBeDefined();
    expect(tool!.validationSchema).toBeUndefined();

    const result = validateInput<{ op: string }>(tool!, {
      op: 'imagen-4-ultra',
      prompt: 'a sunny landscape',
    });
    expect(result).toMatchObject({ op: 'imagen-4-ultra', prompt: 'a sunny landscape' });
  });

  it('rejects invalid input via inputSchema fallback', () => {
    const tool = getMCPToolByName('media_generate_imagen');
    expect(tool).toBeDefined();
    // empty prompt fails min(1)
    expect(() => validateInput(tool!, { op: 'imagen-4-ultra', prompt: '' })).toThrow(z.ZodError);
  });
});

// ---------------------------------------------------------------------------
// Test 4: media_generate_video_t2v rejects 4k + durationSeconds=4 at handler level
// ---------------------------------------------------------------------------

describe('DEBT-008: media_generate_video_t2v cross-field rejection', () => {
  it('rejects 4k resolution with durationSeconds=4 (superRefine rule)', () => {
    const tool = getMCPToolByName('media_generate_video_t2v');
    expect(tool).toBeDefined();

    const badInput = {
      op: 't2v',
      prompt: 'a flowing river',
      resolution: '4k',
      durationSeconds: 4,
    };

    let thrownError: unknown;
    try {
      validateInput(tool!, badInput);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(z.ZodError);
    const zodErr = thrownError as z.ZodError;
    const issue = zodErr.issues.find((i) => i.path.includes('durationSeconds'));
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/durationSeconds=8/);
  });

  it('accepts 4k resolution with durationSeconds=8', () => {
    const tool = getMCPToolByName('media_generate_video_t2v');
    expect(tool).toBeDefined();

    const goodInput = {
      op: 't2v',
      prompt: 'a flowing river',
      resolution: '4k',
      durationSeconds: 8,
    };

    const result = validateInput<{ resolution: string }>(tool!, goodInput);
    expect(result).toMatchObject({ resolution: '4k', durationSeconds: 8 });
  });
});

// ---------------------------------------------------------------------------
// Test 5: media_generate_image rejects thinkingLevel + thinkingBudget combo
// ---------------------------------------------------------------------------

describe('DEBT-008: media_generate_image cross-field rejection', () => {
  it('rejects mutually exclusive thinkingLevel + thinkingBudget at handler level', () => {
    const tool = getMCPToolByName('media_generate_image');
    expect(tool).toBeDefined();

    const badInput = {
      op: 'nano-banana-pro',
      prompt: 'a mountain scene',
      thinkingLevel: 'HIGH',
      thinkingBudget: 1000,
    };

    let thrownError: unknown;
    try {
      validateInput(tool!, badInput);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(z.ZodError);
    const zodErr = thrownError as z.ZodError;
    const issue = zodErr.issues.find((i) => i.path.includes('thinkingLevel'));
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/mutually exclusive/);
  });

  it('accepts thinkingLevel without thinkingBudget', () => {
    const tool = getMCPToolByName('media_generate_image');
    expect(tool).toBeDefined();

    const goodInput = {
      op: 'nano-banana-pro',
      prompt: 'a mountain scene',
      thinkingLevel: 'HIGH',
    };

    const result = validateInput<{ thinkingLevel: string }>(tool!, goodInput);
    expect(result).toMatchObject({ thinkingLevel: 'HIGH' });
  });

  it('base inputSchema alone accepts thinkingLevel + thinkingBudget (no superRefine)', () => {
    const tool = getMCPToolByName('media_generate_image');
    expect(tool).toBeDefined();

    // inputSchema is _NanoBananaProBase (ZodObject, no superRefine) — should pass
    const r = tool!.inputSchema.safeParse({
      op: 'nano-banana-pro',
      prompt: 'a mountain scene',
      thinkingLevel: 'HIGH',
      thinkingBudget: 1000,
    });
    expect(r.success).toBe(true);
  });
});
