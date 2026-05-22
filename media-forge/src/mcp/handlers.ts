// src/mcp/handlers.ts
// Registers all 22 MCP tools backed by service implementations.
// Pattern: wrap each service call in wrap() for unified error handling and logging.
// NEVER throw from a handler — always return {isError: true} with message.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MediaForgeClient } from '../core/client.js';
import type { MediaForgeConfig } from '../core/config.js';
import type { OutputManager } from '../output/output-manager.js';
import type { ZodTypeAny } from 'zod';
import { logger } from '../core/logger.js';
import { MCP_TOOLS, type MCPTool } from './schemas.js';
import {
  generateImageNanoBananaPro,
  generateImageImagen4Ultra,
  editImage,
  composeScene,
  describeImage,
  extractPalette,
} from '../image/image-service.js';
import {
  generateVideoT2V,
  generateVideoI2V,
  generateVideoInterpolate,
  generateVideoWithRefs,
  extendVideo,
  pollVideoOperation,
  downloadVideo,
} from '../video/video-service.js';
import { OcrValidator, checkBrand } from '../review/review-service.js';
import { estimateImageCost, estimateVideoCost } from '../core/cost.js';
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
} from '../core/models.js';

export interface HandlersDeps {
  client: MediaForgeClient;
  config: MediaForgeConfig;
  outputManager?: OutputManager;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

type ToolHandler = (input: unknown) => Promise<ToolResult>;

// Escape hatch type: the SDK's registerTool overload requires ToolCallback<InputArgs>
// which is tightly coupled to the inputSchema generic. Since all our handlers operate
// on `unknown` inputs validated at runtime, we loosen the call-site via this helper.
type LooseRegisterTool = (
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
  },
  cb: ToolHandler,
) => void;

function looseRegister(server: McpServer): LooseRegisterTool {
  return (server as unknown as { registerTool: LooseRegisterTool }).registerTool.bind(server);
}

// ---------------------------------------------------------------------------
// Wrap: unified error handling + logging for every tool handler
// ---------------------------------------------------------------------------

function wrap(name: string, fn: ToolHandler): ToolHandler {
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

function asResult(structured: unknown): {
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

function validateInput<T>(tool: MCPTool, input: unknown): T {
  const schema: ZodTypeAny = tool.validationSchema ?? tool.inputSchema;
  return schema.parse(input) as T;
}

// ---------------------------------------------------------------------------
// Static capability matrix built from models.ts constants
// ---------------------------------------------------------------------------

const CAPABILITY_MATRIX = {
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

function buildHelpText(topic: string | undefined): string {
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

// ---------------------------------------------------------------------------
// registerAllTools — main export
// ---------------------------------------------------------------------------

export function registerAllTools(server: McpServer, deps: HandlersDeps): void {
  const { client, config } = deps;
  const reg = looseRegister(server);

  function getTool(name: string) {
    const t = MCP_TOOLS.find((tool) => tool.name === name);
    if (!t) throw new Error(`BUG: tool ${name} not found in MCP_TOOLS registry`);
    return t;
  }

  // ---- Image tools (6) ----

  {
    const t = getTool('media_generate_image');
    reg(
      t.name,
      { title: 'Generate Image (Nano Banana Pro)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateImageNanoBananaPro(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_imagen');
    reg(
      t.name,
      { title: 'Generate Image (Imagen 4 Ultra)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateImageImagen4Ultra(input as never, client))),
    );
  }

  {
    const t = getTool('media_edit_image');
    reg(
      t.name,
      { title: 'Edit Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await editImage(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_compose_scene');
    reg(
      t.name,
      { title: 'Compose Scene', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await composeScene(input as never, client))),
    );
  }

  {
    const t = getTool('media_describe_image');
    reg(
      t.name,
      { title: 'Describe Image', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await describeImage(input as never, client))),
    );
  }

  {
    const t = getTool('media_extract_palette');
    reg(
      t.name,
      { title: 'Extract Color Palette', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await extractPalette(input as never))),
    );
  }

  // ---- Video tools (7) ----

  {
    const t = getTool('media_generate_video_t2v');
    reg(
      t.name,
      { title: 'Generate Video (Text to Video)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoT2V(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_i2v');
    reg(
      t.name,
      { title: 'Generate Video (Image to Video)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoI2V(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_interpolate');
    reg(
      t.name,
      { title: 'Generate Video (Interpolate)', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoInterpolate(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_generate_video_with_refs');
    reg(
      t.name,
      { title: 'Generate Video With References', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => asResult(await generateVideoWithRefs(validateInput(t, input), client))),
    );
  }

  {
    const t = getTool('media_extend_video');
    // Adapter: ExtendVideoInput → ExtendOpts
    // v0.1.0 limitation: treats sourceVideoPath as sourceVideoUri, prompt as both
    // originalPrompt and extensionDirective (no separate directive field in schema).
    reg(
      t.name,
      { title: 'Extend Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as {
          sourceVideoPath: string;
          prompt: string;
          hopIndex: number;
          dryRun?: boolean;
        };
        return asResult(
          await extendVideo({
            client,
            sourceVideoUri: inp.sourceVideoPath,
            sourceMimeType: 'video/mp4',
            originalPrompt: inp.prompt,
            extensionDirective: inp.prompt,
            hopIndex: inp.hopIndex ?? 0,
          }),
        );
      }),
    );
  }

  {
    const t = getTool('media_poll_video_operation');
    reg(
      t.name,
      { title: 'Poll Video Operation', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { operationName: string; intervalMs?: number; timeoutMs?: number };
        const intervalMs = inp.intervalMs ?? 10000;
        const maxAttempts = Math.floor((inp.timeoutMs ?? 900000) / intervalMs);
        return asResult(
          await pollVideoOperation({
            client,
            operationName: inp.operationName,
            intervalMs,
            maxAttempts,
          }),
        );
      }),
    );
  }

  {
    const t = getTool('media_download_video');
    // v0.1.0: downloadVideo requires a direct videoUri (not an operationName).
    // If caller passes an operation name instead of a resolved URI, return a
    // structured error note rather than making a broken HTTP request.
    reg(
      t.name,
      { title: 'Download Video', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as {
          operationName: string;
          outputDir?: string;
          filename?: string;
        };
        // Heuristic: if it looks like a GCS / HTTP URI, pass it directly.
        // If it looks like an operation name (e.g. "projects/.../operations/..."), warn.
        const isUri =
          inp.operationName.startsWith('https://') ||
          inp.operationName.startsWith('gs://') ||
          inp.operationName.startsWith('http://');
        if (!isUri) {
          return asResult({
            ok: false,
            note: 'media_download_video requires a resolved video URI (https:// or gs://). Re-poll the operation with media_poll_video_operation to get the videoUri from the response, then call this tool.',
            operationName: inp.operationName,
          });
        }
        return asResult(
          await downloadVideo({
            client,
            videoUri: inp.operationName,
            apiKey: config.apiKey,
            outputDir: inp.outputDir ?? config.outputDir,
            filename: inp.filename,
          }),
        );
      }),
    );
  }

  // ---- Pipeline / Utility tools (8) ----

  {
    const t = getTool('media_dry_run_payload');
    reg(
      t.name,
      { title: 'Dry Run Payload', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { op: string; params: Record<string, unknown> };
        return asResult({ dryRun: true, payload: inp });
      }),
    );
  }

  {
    const t = getTool('media_estimate_cost');
    reg(
      t.name,
      { title: 'Estimate Cost', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { items: Array<{ op: string; params: Record<string, unknown> }> };
        let totalUsd = 0;
        const perItem: Array<{ op: string; usd: number; breakdown: string }> = [];
        for (const item of inp.items) {
          let usd = 0;
          let breakdown = `Unknown op: ${item.op}`;

          const op = item.op.toLowerCase();
          if (op.includes('nano-banana') || op.includes('nano_banana') || op.includes('generate_image')) {
            const params = item.params as { imageSize?: string };
            const imageSize = (params.imageSize as '1K' | '2K' | '4K') ?? '4K';
            const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('imagen') || op.includes('imagen4')) {
            const params = item.params as { numberOfImages?: number };
            const est = estimateImageCost({
              model: IMAGE_MODEL_IMAGEN_4_ULTRA,
              numberOfImages: params.numberOfImages ?? 1,
            });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('video') || op.includes('veo') || op.includes('t2v') || op.includes('i2v')) {
            const params = item.params as { resolution?: string; generateAudio?: boolean };
            const est = estimateVideoCost({
              model: VIDEO_MODEL_VEO_3_1_PRO,
              resolution: (params.resolution as '720p' | '1080p' | '4k') ?? '720p',
              generateAudio: params.generateAudio ?? true,
            });
            usd = est.usd;
            breakdown = est.breakdown;
          } else if (op.includes('image')) {
            // fallback: treat as nano-banana-pro
            const est = estimateImageCost({ model: IMAGE_MODEL_NANO_BANANA_PRO, imageSize: '4K' });
            usd = est.usd;
            breakdown = est.breakdown;
          }

          totalUsd += usd;
          perItem.push({ op: item.op, usd, breakdown });
        }
        return asResult({ totalUsd, perItem });
      }),
    );
  }

  {
    const t = getTool('media_validate_environment');
    reg(
      t.name,
      { title: 'Validate Environment', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (_input) => {
        const missing: string[] = [];
        const hasApiKey = Boolean(config.apiKey);
        const hasVertex = config.useVertex && Boolean(config.project);

        if (!hasApiKey && !hasVertex) {
          missing.push('GOOGLE_API_KEY (or GEMINI_API_KEY, or GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT)');
        }

        const ok = missing.length === 0;
        return asResult({ ok, missing });
      }),
    );
  }

  {
    const t = getTool('media_capability_matrix');
    reg(
      t.name,
      { title: 'Capability Matrix', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { model?: string };
        if (inp.model) {
          const entry = (CAPABILITY_MATRIX as Record<string, unknown>)[inp.model];
          if (!entry) {
            return asResult({ error: `Unknown model: ${inp.model}` });
          }
          return asResult({ [inp.model]: entry });
        }
        return asResult(CAPABILITY_MATRIX);
      }),
    );
  }

  {
    const t = getTool('media_list_outputs');
    reg(
      t.name,
      { title: 'List Outputs', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (_input) => {
        // OutputManager does not currently expose a listJobs method.
        // v0.1.0 placeholder — P9/P10 will implement job listing.
        return asResult({
          jobs: [],
          note: 'list helper not yet implemented — will be available in a future phase',
        });
      }),
    );
  }

  {
    const t = getTool('media_get_job_metadata');
    reg(
      t.name,
      { title: 'Get Job Metadata', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { jobId: string };
        const jobDir = path.join(config.projectDir, 'jobs', inp.jobId);

        const result: Record<string, unknown> = { jobId: inp.jobId, jobDir };

        // Read metadata.json
        const metadataPath = path.join(jobDir, 'metadata.json');
        try {
          const raw = await fs.readFile(metadataPath, 'utf8');
          result['metadata'] = JSON.parse(raw) as unknown;
        } catch {
          result['metadata'] = null;
        }

        // Read trace.jsonl
        const tracePath = path.join(jobDir, 'trace.jsonl');
        try {
          const raw = await fs.readFile(tracePath, 'utf8');
          result['trace'] = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => {
              try {
                return JSON.parse(l) as unknown;
              } catch {
                return l;
              }
            });
        } catch {
          result['trace'] = [];
        }

        // Read lineage.jsonl
        const lineagePath = path.join(jobDir, 'lineage.jsonl');
        try {
          const raw = await fs.readFile(lineagePath, 'utf8');
          result['lineage'] = raw
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => {
              try {
                return JSON.parse(l) as unknown;
              } catch {
                return l;
              }
            });
        } catch {
          result['lineage'] = [];
        }

        return asResult(result);
      }),
    );
  }

  {
    const t = getTool('media_run_ocr');
    reg(
      t.name,
      { title: 'Run OCR', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { imagePath: string; languages?: string[] };
        const validator = new OcrValidator({ backend: config.ocrBackend });
        const result = await validator.validateText({
          imagePath: inp.imagePath,
          requiredText: '',
          hasTextIntent: true,
        });
        return asResult({
          imagePath: inp.imagePath,
          detectedText: result.detectedText,
          backend: result.backend,
          skipped: result.skipped,
        });
      }),
    );
  }

  {
    const t = getTool('media_check_brand_compliance');
    reg(
      t.name,
      { title: 'Check Brand Compliance', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { imagePath: string; brandGuidelinesPath: string };
        return asResult(
          await checkBrand({
            imagePath: inp.imagePath,
            guidelinesPath: inp.brandGuidelinesPath,
          }),
        );
      }),
    );
  }

  // ---- Help (1) ----

  {
    const t = getTool('media_help');
    reg(
      t.name,
      { title: 'Help', description: t.description, inputSchema: t.inputSchema as never },
      wrap(t.name, async (input) => {
        const inp = input as { topic?: string };
        const text = buildHelpText(inp.topic);
        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: { topic: inp.topic ?? null, text },
        };
      }),
    );
  }
}
