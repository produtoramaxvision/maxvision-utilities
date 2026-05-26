import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

// Image schemas (P3.1)
export {
  NanoBananaProInput,
  _NanoBananaProBase,
  Imagen4UltraInput,
  EditImageInput,
  _EditImageBase,
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
  _T2VBase,
  GenerateVideoI2VInput,
  _I2VBase,
  GenerateVideoInterpolateInput,
  _InterpolateBase,
  GenerateVideoWithRefsInput,
  _WithRefsBase,
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

// Refs schemas (Phase 1+)
export {
  RefsSearchInput,
  RefsComposeMoodboardInput,
  RefsPresignInput,
  RefsIndexInput,
} from '../refs/refs-schemas.js';
export type {
  RefsSearchInputT,
  RefsComposeMoodboardInputT,
  RefsPresignInputT,
  RefsIndexInputT,
} from '../refs/refs-schemas.js';

// Re-import for internal use in MCP_TOOLS definitions
import {
  NanoBananaProInput,
  _NanoBananaProBase,
  Imagen4UltraInput,
  EditImageInput,
  _EditImageBase,
  ComposeSceneInput,
  DescribeImageInput,
  ExtractPaletteInput,
} from '../image/image-schemas.js';
import {
  GenerateVideoT2VInput,
  _T2VBase,
  GenerateVideoI2VInput,
  _I2VBase,
  GenerateVideoInterpolateInput,
  _InterpolateBase,
  GenerateVideoWithRefsInput,
  _WithRefsBase,
  ExtendVideoInput,
  PollVideoOperationInput,
  DownloadVideoInput,
} from '../video/video-schemas.js';
import {
  RefsSearchInput,
  RefsComposeMoodboardInput,
  RefsPresignInput,
  RefsIndexInput,
} from '../refs/refs-schemas.js';

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

// video_webhook_status — report runtime state of the local webhook router
// (P14+ provider callback endpoint). Empty input — the tool is a pure query.
export const VideoWebhookStatusInput = z.object({}).strict();
export type VideoWebhookStatusInputT = z.infer<typeof VideoWebhookStatusInput>;

// video_cost_estimate — estimate USD cost for a video generation request
// (any provider in the registry; P13 supports google/Veo only)
export const VideoCostEstimateInput = z.object({
  modelId: z.string().min(1),
  mode: z.enum(['t2v', 'i2v', 'interpolate', 'extend', 'with-refs']),
  prompt: z.string().min(1),
  durationSec: z.number().positive(),
  resolution: z.enum(['720p', '1080p', '2k', '4k']),
});

export type VideoCostEstimateInputT = z.infer<typeof VideoCostEstimateInput>;

// video_cost_report — aggregate cost report from the local SQLite ledger
export const VideoCostReportInput = z.object({
  periodDays: z.number().int().positive().default(30),
}).strict();

export type VideoCostReportInputT = z.infer<typeof VideoCostReportInput>;

// ---------------------------------------------------------------------------
// MCPTool interface
// ---------------------------------------------------------------------------
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;          // base shape — emitted in tools/list
  validationSchema?: ZodTypeAny;    // full (superRefine) shape — runtime parse
  outputSchema?: ZodTypeAny;
}

// ---------------------------------------------------------------------------
// MCP_TOOLS registry — 29 tools total
// 6 image + 7 video + 8 pipeline/utility + 1 help + 4 refs + 1 webhook + 2 cost = 29
// ---------------------------------------------------------------------------
export const MCP_TOOLS: readonly MCPTool[] = Object.freeze([
  // ---- Image (6) ----
  {
    name: 'media_generate_image',
    description: 'Generate image via Nano Banana Pro (text → image)',
    inputSchema: _NanoBananaProBase,
    validationSchema: NanoBananaProInput,
  },
  {
    name: 'media_generate_imagen',
    description: 'Generate image via Imagen 4 Ultra (seed/negative_prompt)',
    inputSchema: Imagen4UltraInput,
  },
  {
    name: 'media_edit_image',
    description: 'Semantic edit (add/remove/replace/inpaint/outpaint)',
    inputSchema: _EditImageBase,
    validationSchema: EditImageInput,
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
    inputSchema: _T2VBase,
    validationSchema: GenerateVideoT2VInput,
  },
  {
    name: 'media_generate_video_i2v',
    description: 'Image (first frame) → video via Veo 3.1 Pro',
    inputSchema: _I2VBase,
    validationSchema: GenerateVideoI2VInput,
  },
  {
    name: 'media_generate_video_interpolate',
    description: 'First + last frame → video via Veo 3.1 Pro',
    inputSchema: _InterpolateBase,
    validationSchema: GenerateVideoInterpolateInput,
  },
  {
    name: 'media_generate_video_with_refs',
    description: 'Text + up to 3 asset reference images → video',
    inputSchema: _WithRefsBase,
    validationSchema: GenerateVideoWithRefsInput,
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

  // ---- Help (1) ----
  {
    name: 'media_help',
    description: 'Built-in usage docs for any media-forge tool',
    inputSchema: MediaHelpInput,
  },

  // ---- Refs (4 — Phase 1+) ----
  {
    name: 'media_refs_search',
    description: 'Search media-forge-refs bucket by tag or semantic embedding',
    inputSchema: RefsSearchInput,
  },
  {
    name: 'media_refs_compose_moodboard',
    description: 'Compose a single moodboard keyframe from N refs + subjects via NBP',
    inputSchema: RefsComposeMoodboardInput,
  },
  {
    name: 'media_refs_presign',
    description: 'Generate presigned GET URLs for ref objects (TTL 60-3600s)',
    inputSchema: RefsPresignInput,
  },
  {
    name: 'media_refs_index',
    description: 'Batch index refs into pgvector for semantic search (Phase 2)',
    inputSchema: RefsIndexInput,
  },

  // ---- Webhook (1 — P13 scaffold for P14+ provider callbacks) ----
  {
    name: 'media_video_webhook_status',
    description:
      'Status of the local webhook router (P14+ provider callback endpoint). Reports running state, bind address, and registered handlers.',
    inputSchema: VideoWebhookStatusInput,
  },

  // ---- Cost estimation (2 — P13 provider-registry cost tools) ----
  {
    name: 'media_video_cost_estimate',
    description:
      'Estimate USD cost for a video generation request (any provider in the registry; P13 supports google/Veo only).',
    inputSchema: VideoCostEstimateInput,
  },
  {
    name: 'media_video_cost_report',
    description:
      'Aggregate cost report from the local SQLite ledger. Returns totals and per-provider breakdowns for the specified period.',
    inputSchema: VideoCostReportInput,
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
