import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
import { logger } from '../../core/logger.js';
import { MCP_TOOLS, type MCPTool } from '../schemas.js';
import {
  IMAGE_MODEL_NANO_BANANA_PRO,
  IMAGE_MODEL_IMAGEN_4_ULTRA,
  VIDEO_MODEL_VEO_3_1_PRO,
  ASPECT_RATIO_NANO_BANANA,
  ASPECT_RATIO_IMAGEN,
  ASPECT_RATIO_VIDEO,
  IMAGE_SIZE,
  THINKING_LEVELS,
  PERSON_GENERATION_IMAGE,
  PERSON_GENERATION_VIDEO,
  VIDEO_RESOLUTION,
  VIDEO_DURATION_SECONDS,
} from '../../core/models.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export type ToolHandler = (input: unknown) => Promise<ToolResult>;

// Escape hatch type: the SDK's registerTool overload requires ToolCallback<InputArgs>
// which is tightly coupled to the inputSchema generic. Since all our handlers operate
// on `unknown` inputs validated at runtime, we loosen the call-site via this helper.
export type LooseRegisterTool = (
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
  },
  cb: ToolHandler,
) => void;

export function looseRegister(server: McpServer): LooseRegisterTool {
  return (server as unknown as { registerTool: LooseRegisterTool }).registerTool.bind(server);
}

// ---------------------------------------------------------------------------
// Wrap: unified error handling + logging for every tool handler
// ---------------------------------------------------------------------------

export function wrap(name: string, fn: ToolHandler): ToolHandler {
  return async (input) => {
    const start = Date.now();
    try {
      const result = await fn(input);
      logger.debug('mcp tool ok', { name, durationMs: Date.now() - start });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logger.warn('mcp tool error', { name, msg, durationMs: Date.now() - start });
      return {
        content: [{ type: 'text' as const, text: msg }],
        isError: true,
      };
    }
  };
}

// ---------------------------------------------------------------------------
// asResult: uniform structured response wrapper
// ---------------------------------------------------------------------------

export function asResult(structured: unknown): {
  content: [{ type: 'text'; text: string }];
  structuredContent: unknown;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// validateInput: use validationSchema (superRefine) when available, else inputSchema
// ---------------------------------------------------------------------------

export function validateInput<T>(tool: MCPTool, input: unknown): T {
  const schema: ZodTypeAny = tool.validationSchema ?? tool.inputSchema;
  return schema.parse(input) as T;
}

// ---------------------------------------------------------------------------
// Static capability matrix built from models.ts constants
// ---------------------------------------------------------------------------

export const CAPABILITY_MATRIX = {
  [IMAGE_MODEL_NANO_BANANA_PRO]: {
    type: 'image',
    aspectRatios: ASPECT_RATIO_NANO_BANANA,
    imageSizes: IMAGE_SIZE,
    thinkingLevels: THINKING_LEVELS,
    personGeneration: PERSON_GENERATION_IMAGE,
    supportsComposition: true,
    supportsEditing: true,
    maxReferenceImages: 14,
  },
  [IMAGE_MODEL_IMAGEN_4_ULTRA]: {
    type: 'image',
    aspectRatios: ASPECT_RATIO_IMAGEN,
    supportsNegativePrompt: true,
    supportsSeed: true,
    personGeneration: PERSON_GENERATION_IMAGE,
    maxImagesPerRequest: 4,
  },
  [VIDEO_MODEL_VEO_3_1_PRO]: {
    type: 'video',
    aspectRatios: ASPECT_RATIO_VIDEO,
    resolutions: VIDEO_RESOLUTION,
    durationSeconds: VIDEO_DURATION_SECONDS,
    personGeneration: PERSON_GENERATION_VIDEO,
    supportsAudio: true,
    supportsI2V: true,
    supportsInterpolation: true,
    supportsExtension: true,
    maxExtensionHops: 20,
    extensionResolution: '720p',
  },
} as const;

// ---------------------------------------------------------------------------
// Tool help text (static per tool, or listing all tools)
// ---------------------------------------------------------------------------

export function buildHelpText(topic: string | undefined): string {
  if (!topic) {
    const lines = ['media-forge MCP tools:', ''];
    for (const tool of MCP_TOOLS) {
      lines.push(`  ${tool.name}  —  ${tool.description}`);
    }
    lines.push('');
    lines.push('Use topic="<tool_name>" for detailed help on a specific tool.');
    return lines.join('\n');
  }

  const tool = MCP_TOOLS.find((t) => t.name === topic);
  if (!tool) {
    return `Unknown tool: "${topic}". Call media_help with no topic to list all tools.`;
  }

  return [
    `Tool: ${tool.name}`,
    `Description: ${tool.description}`,
    '',
    'Input schema (Zod): see MCP_TOOLS registry in schemas.ts',
    '',
    'Usage example: call this tool via MCP with the required parameters.',
  ].join('\n');
}
