import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

// Image schemas (P3.1)
export {
  NanoBananaProInput,
  Imagen4UltraInput,
  EditImageInput,
  ComposeSceneInput,
  DescribeImageInput,
  ExtractPaletteInput,
  ImageInput,
} from '../image/image-schemas.js';
export type {
  NanoBananaProInputT,
  Imagen4UltraInputT,
  EditImageInputT,
  ComposeSceneInputT,
  DescribeImageInputT,
  ExtractPaletteInputT,
  ImageInputT,
} from '../image/image-schemas.js';

// Video schemas (P3.2)
export {
  GenerateVideoT2VInput,
  GenerateVideoI2VInput,
  GenerateVideoInterpolateInput,
  GenerateVideoWithRefsInput,
  ExtendVideoInput,
  PollVideoOperationInput,
  DownloadVideoInput,
  VideoInput,
} from '../video/video-schemas.js';
export type {
  GenerateVideoT2VInputT,
  GenerateVideoI2VInputT,
  GenerateVideoInterpolateInputT,
  GenerateVideoWithRefsInputT,
  ExtendVideoInputT,
  PollVideoOperationInputT,
  DownloadVideoInputT,
  VideoInputT,
} from '../video/video-schemas.js';

// Re-import for internal use in MCP_TOOLS definitions
import {
  NanoBananaProInput,
  Imagen4UltraInput,
  EditImageInput,
  ComposeSceneInput,
  DescribeImageInput,
  ExtractPaletteInput,
} from '../image/image-schemas.js';
import {
  GenerateVideoT2VInput,
  GenerateVideoI2VInput,
  GenerateVideoInterpolateInput,
  GenerateVideoWithRefsInput,
  ExtendVideoInput,
  PollVideoOperationInput,
  DownloadVideoInput,
} from '../video/video-schemas.js';

// ---------------------------------------------------------------------------
// Pipeline / utility inline schemas (tool-specific, small shapes)
// ---------------------------------------------------------------------------

// dry_run_payload — accepts any valid image or video payload and returns API cost estimate
export const DryRunPayloadInput = z
  .object({
    // Accept a pre-validated payload object with at least an op discriminator
    op: z.string().min(1),
    params: z.record(z.string(), z.unknown()),
  })
  .strict();

export type DryRunPayloadInputT = z.infer<typeof DryRunPayloadInput>;

// estimate_cost — batch cost estimation without dispatching
export const EstimateCostInput = z
  .object({
    items: z
      .array(
        z.object({
          op: z.string().min(1),
          params: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1),
  })
  .strict();

export type EstimateCostInputT = z.infer<typeof EstimateCostInput>;

// validate_environment — verify API key + model availability (no params)
export const ValidateEnvironmentInput = z.object({}).strict();
export type ValidateEnvironmentInputT = z.infer<typeof ValidateEnvironmentInput>;

// capability_matrix — return model × params table (optional model filter)
export const CapabilityMatrixInput = z
  .object({
    model: z
      .enum([
        'gemini-3-pro-image-preview',
        'imagen-4.0-ultra-generate-001',
        'veo-3.1-generate-preview',
      ])
      .optional(),
  })
  .strict();

export type CapabilityMatrixInputT = z.infer<typeof CapabilityMatrixInput>;

// list_outputs — list jobs in .media-forge/jobs/
export const ListOutputsInput = z
  .object({
    project: z.string().optional(),
    limit: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export type ListOutputsInputT = z.infer<typeof ListOutputsInput>;

// get_job_metadata — read a job spec + trace.jsonl + lineage
export const GetJobMetadataInput = z
  .object({
    jobId: z.string().min(1),
  })
  .strict();

export type GetJobMetadataInputT = z.infer<typeof GetJobMetadataInput>;

// run_ocr — run OCR over an image (reviewer stage 1)
export const RunOcrInput = z
  .object({
    imagePath: z.string().min(1),
    languages: z.array(z.string()).min(1).default(['en']),
  })
  .strict();

export type RunOcrInputT = z.infer<typeof RunOcrInput>;

// check_brand_compliance — palette/logo/font brand check (reviewer stage 2)
export const CheckBrandComplianceInput = z
  .object({
    imagePath: z.string().min(1),
    brandGuidelinesPath: z.string().min(1),
  })
  .strict();

export type CheckBrandComplianceInputT = z.infer<typeof CheckBrandComplianceInput>;

// help — built-in usage docs for any media-forge tool
export const MediaHelpInput = z
  .object({
    topic: z.string().optional(),
  })
  .strict();

export type MediaHelpInputT = z.infer<typeof MediaHelpInput>;

// ---------------------------------------------------------------------------
// MCPTool interface
// ---------------------------------------------------------------------------
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
}

// ---------------------------------------------------------------------------
// MCP_TOOLS registry — 22 tools total
// 6 image + 7 video + 8 pipeline/utility + 1 help = 22
// ---------------------------------------------------------------------------
export const MCP_TOOLS: readonly MCPTool[] = Object.freeze([
  // ---- Image (6) ----
  {
    name: 'media_generate_image',
    description: 'Generate image via Nano Banana Pro (text → image)',
    inputSchema: NanoBananaProInput,
  },
  {
    name: 'media_generate_imagen',
    description: 'Generate image via Imagen 4 Ultra (seed/negative_prompt)',
    inputSchema: Imagen4UltraInput,
  },
  {
    name: 'media_edit_image',
    description: 'Semantic edit (add/remove/replace/inpaint/outpaint)',
    inputSchema: EditImageInput,
  },
  {
    name: 'media_compose_scene',
    description: 'Multi-image composition (up to 14 refs, Nano Banana Pro)',
    inputSchema: ComposeSceneInput,
  },
  {
    name: 'media_describe_image',
    description: 'Image → text description via Gemini vision',
    inputSchema: DescribeImageInput,
  },
  {
    name: 'media_extract_palette',
    description: 'Extract dominant colors as hex/rgb/hsl palette',
    inputSchema: ExtractPaletteInput,
  },

  // ---- Video (7) ----
  {
    name: 'media_generate_video_t2v',
    description: 'Text → video via Veo 3.1 Pro',
    inputSchema: GenerateVideoT2VInput,
  },
  {
    name: 'media_generate_video_i2v',
    description: 'Image (first frame) → video via Veo 3.1 Pro',
    inputSchema: GenerateVideoI2VInput,
  },
  {
    name: 'media_generate_video_interpolate',
    description: 'First + last frame → video via Veo 3.1 Pro',
    inputSchema: GenerateVideoInterpolateInput,
  },
  {
    name: 'media_generate_video_with_refs',
    description: 'Text + up to 3 asset reference images → video',
    inputSchema: GenerateVideoWithRefsInput,
  },
  {
    name: 'media_extend_video',
    description: 'Extend existing video by +7s hop (720p only, max 20 hops)',
    inputSchema: ExtendVideoInput,
  },
  {
    name: 'media_poll_video_operation',
    description: 'Poll long-running video operation status',
    inputSchema: PollVideoOperationInput,
  },
  {
    name: 'media_download_video',
    description: 'Fetch operation result video (2-day TTL)',
    inputSchema: DownloadVideoInput,
  },

  // ---- Pipeline / Utility (8) ----
  {
    name: 'media_dry_run_payload',
    description: 'Return what would be sent to API + cost estimate (no API call)',
    inputSchema: DryRunPayloadInput,
  },
  {
    name: 'media_estimate_cost',
    description: 'Estimate USD cost for a given operation set without dispatching',
    inputSchema: EstimateCostInput,
  },
  {
    name: 'media_validate_environment',
    description: 'Verify API key + model availability',
    inputSchema: ValidateEnvironmentInput,
  },
  {
    name: 'media_capability_matrix',
    description: 'Return model × params capability table for current registry',
    inputSchema: CapabilityMatrixInput,
  },
  {
    name: 'media_list_outputs',
    description: 'List jobs in .media-forge/jobs/',
    inputSchema: ListOutputsInput,
  },
  {
    name: 'media_get_job_metadata',
    description: 'Read a job spec + trace.jsonl + lineage',
    inputSchema: GetJobMetadataInput,
  },
  {
    name: 'media_run_ocr',
    description: 'Run OCR over an image (reviewer stage 1)',
    inputSchema: RunOcrInput,
  },
  {
    name: 'media_check_brand_compliance',
    description: 'Brand guideline check (palette/logo/font — reviewer stage 2)',
    inputSchema: CheckBrandComplianceInput,
  },

  // ---- Help (1) — rounds to 22 ----
  {
    name: 'media_help',
    description: 'Built-in usage docs for any media-forge tool',
    inputSchema: MediaHelpInput,
  },
] as const) as readonly MCPTool[];

// ---------------------------------------------------------------------------
// Helper accessors
// ---------------------------------------------------------------------------
export function getMCPToolByName(name: string): MCPTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

export function listMCPToolNames(): readonly string[] {
  return MCP_TOOLS.map((t) => t.name);
}
