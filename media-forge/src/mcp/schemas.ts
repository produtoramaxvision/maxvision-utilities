import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { VIDEO_MODELS } from '../core/models.js';

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

// video_route — pick optimal provider+model for a video generation request
// (P13: Veo-only heuristic; extended in P14-P16 as more provider adapters land).
// `preferProvider` accepts the full Provider type union (including not-yet-wired
// names) so future-facing callers can specify a preference today; the handler
// throws a clear error when the preference has no candidate in the current
// registry.
export const VideoRouteInput = z.object({
  mode: z.enum([
    't2v',
    'i2v',
    'interpolate',
    'extend',
    'with-refs',
    'multi-shot',
    'lip-sync',
    'motion-brush',
    'elements',
    'targeted-edit',
  ]),
  prompt: z.string().min(1),
  durationSec: z.number().positive(),
  resolution: z.enum(['720p', '1080p', '2k', '4k']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '21:9', '4:3', '3:4']).optional(),
  preferProvider: z.enum(['google', 'higgsfield', 'kling', 'bytedance']).optional(),
});

export type VideoRouteInputT = z.infer<typeof VideoRouteInput>;

// ---------------------------------------------------------------------------
// HiggsfieldSoulIdInput — Soul ID lifecycle (create/list/find/markUsed)
// ---------------------------------------------------------------------------

// _HiggsfieldSoulIdBase — ZodObject base shape emitted in tools/list.
// All action-specific fields are optional so the base is a plain ZodObject
// (required by DEBT-008 constraint that inputSchema must not be ZodEffects).
// Runtime validation uses HiggsfieldSoulIdInput (discriminatedUnion).
export const _HiggsfieldSoulIdBase = z.object({
  action: z.enum(['create', 'list', 'find', 'markUsed']),
  id: z.string().min(1).optional(),
  characterName: z.string().min(1).optional(),
  assetPaths: z.array(z.string().min(1)).optional(),
});

export const HiggsfieldSoulIdInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    id: z.string().min(1),
    characterName: z.string().min(1),
    assetPaths: z.array(z.string().min(1)).min(1),
  }),
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('find'), characterName: z.string().min(1) }),
  z.object({ action: z.literal('markUsed'), id: z.string().min(1) }),
]);
export type HiggsfieldSoulIdInputT = z.infer<typeof HiggsfieldSoulIdInput>;

// ---------------------------------------------------------------------------
// HiggsfieldDopInput — DoP image-to-video with WAN Camera Control verbs (P14 Task 9)
// ---------------------------------------------------------------------------

export const DOP_CAMERA_VERBS = [
  'dolly_in', 'dolly_out', 'crane_up', 'crane_down', 'orbit', 'crash_zoom',
  'bullet_time', 'fpv_drone', 'handheld', 'whip_pan', 'tilt_up', 'tilt_down',
  'pan_left', 'pan_right', 'arc', 'truck', 'pedestal', 'rack_focus',
  'vertigo_effect', 'static', 'low_angle', 'high_angle',
] as const;

export const HiggsfieldDopInput = z.object({
  modelId: z.enum(['higgsfield-dop', 'higgsfield-dop-turbo']),
  firstFrameImagePath: z.string().min(1),
  prompt: z.string().min(1),
  cameraVerbs: z.array(z.enum(DOP_CAMERA_VERBS)).min(1).max(5),
  durationSec: z.number().positive().max(6),
  resolution: z.enum(['720p', '1080p']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '21:9', '4:3', '3:4']).optional(),
});
export type HiggsfieldDopInputT = z.infer<typeof HiggsfieldDopInput>;

// ---------------------------------------------------------------------------
// HiggsfieldCinemaStudioInput — Cinema Studio 3.5 with full lens dictionary (P14 Task 10)
// ---------------------------------------------------------------------------

export const HiggsfieldCinemaStudioInput = z.object({
  prompt: z.string().min(1),
  firstFrameImagePath: z.string().min(1),
  durationSec: z.number().positive().max(8),
  resolution: z.enum(['720p', '1080p']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '21:9', '4:3', '3:4']).optional(),
  focalLengthMm: z.number().positive().max(800).optional(),
  apertureFStop: z.number().positive().max(32).optional(),
  sensorSize: z.enum(['full-frame', 'super35', 'apsc', 'm43', 'imax']).optional(),
  colorGrading: z.string().min(1).optional(),
  lensId: z.string().min(1).optional(),
});
export type HiggsfieldCinemaStudioInputT = z.infer<typeof HiggsfieldCinemaStudioInput>;

// ---------------------------------------------------------------------------
// HiggsfieldSpeakInput — Speak / Speak 2.0 lip-sync: portrait + audio → talking head (P14 Task 11)
// ---------------------------------------------------------------------------

const _HiggsfieldSpeakBase = z.object({
  modelId: z.enum(['higgsfield-speak', 'higgsfield-speak2']),
  portraitImagePath: z.string().min(1),
  audioPath: z.string().min(1),
  prompt: z.string().min(1),
  durationSec: z.number().positive().max(60),
  resolution: z.enum(['720p', '1080p']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).optional(),
});
// FIX (Codex P2, PR#10): per-model duration cap. higgsfield-speak (Speak 1.0)
// caps at 30s; only higgsfield-speak2 supports up to 60s. Without this refine
// direct handler calls bypass the route-level filter and would submit oversized
// jobs that the upstream provider rejects with a confusing error.
export const HiggsfieldSpeakInput = _HiggsfieldSpeakBase.refine(
  (data) => {
    if (data.modelId === 'higgsfield-speak' && data.durationSec > 30) return false;
    return true;
  },
  {
    message:
      'higgsfield-speak (Speak 1.0) caps at 30s. Use higgsfield-speak2 for durations up to 60s.',
    path: ['durationSec'],
  },
);
export type HiggsfieldSpeakInputT = z.infer<typeof HiggsfieldSpeakInput>;

// HiggsfieldRecastInput — Recast Studio: swap character in existing video (P14 Task 13)
// ---------------------------------------------------------------------------

export const HiggsfieldRecastInput = z.object({
  sourceVideoPath: z.string().min(1),
  targetCharacterImagePath: z.string().min(1),
  prompt: z.string().min(1),
  durationSec: z.number().positive().max(30),
  resolution: z.enum(['720p', '1080p']),
});
export type HiggsfieldRecastInputT = z.infer<typeof HiggsfieldRecastInput>;

// HiggsfieldViralityPredictorInput — Virality Predictor: score an asset (P14 Task 14)
// ---------------------------------------------------------------------------

export const HiggsfieldViralityPredictorInput = z.object({
  assetUrl: z.string().url(),
  platform: z.enum(['tiktok', 'instagram', 'youtube-shorts', 'general']).default('general'),
});
export type HiggsfieldViralityPredictorInputT = z.infer<typeof HiggsfieldViralityPredictorInput>;

// HiggsfieldMarketingStudioInput — Marketing Studio: 9 UGC templates from product URL (P14 Task 12)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// KlingMotionBrushInput — Kling V3 Pro motion brush: paint regions with motion vectors (P15 Task 6)
// ---------------------------------------------------------------------------

export const KlingMotionBrushInput = z.object({
  prompt: z.string().min(1),
  imageUrl: z.string().url(),
  regions: z
    .array(
      z.object({
        id: z.string().min(1),
        polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
        motionVector: z.tuple([z.number(), z.number()]),
      }),
    )
    .min(1, 'at least 1 motion-brush region required'),
  durationSec: z.number().positive().max(10),
  modelId: z.enum(['kling-v3-pro']).default('kling-v3-pro'),
  watermarkEnabled: z.boolean().default(false),
  videoReferenceUrl: z.string().url().optional(),
  characterOrientation: z.enum(['image', 'video']).default('image'),
});
export type KlingMotionBrushInputT = z.infer<typeof KlingMotionBrushInput>;

export const HiggsfieldMarketingStudioInput = z.object({
  template: z.enum([
    'ugc', 'unboxing', 'tv-spot', 'hyper-motion', 'product-review',
    'asmr', 'lifestyle', 'testimonial', 'reel',
  ]),
  productUrl: z.string().url(),
  prompt: z.string().min(1),
  durationSec: z.number().positive().max(15),
  resolution: z.enum(['720p', '1080p']),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
});
export type HiggsfieldMarketingStudioInputT = z.infer<typeof HiggsfieldMarketingStudioInput>;

// ---------------------------------------------------------------------------
// Kling Elements — CRUD lifecycle (P15 Tasks 6.5 / 6.6 / 6.7)
// ---------------------------------------------------------------------------

// KlingElementCreateInput — base shape for tools/list (ZodObject, DEBT-008 compliant)
// validationSchema = KlingElementCreateInput (ZodEffects with .refine for mutual-exclusion)
export const _KlingElementCreateBase = z.object({
  imageUrl: z.string().url().optional(),
  imageBase64: z.string().min(1).optional(),
  displayName: z.string().min(1).max(100),
  category: z.enum(['character', 'product', 'location']).optional(),
});

export const KlingElementCreateInput = _KlingElementCreateBase.refine(
  (v) => Boolean(v.imageUrl) !== Boolean(v.imageBase64),
  { message: 'exactly one of imageUrl or imageBase64 required' },
);
export type KlingElementCreateInputT = z.infer<typeof KlingElementCreateInput>;

// KlingElementListInput — list from local cache (+ optional backend sync)
export const KlingElementListInput = z.object({
  syncWithBackend: z.boolean().default(false),
  category: z.enum(['character', 'product', 'location']).optional(),
  includeDeleted: z.boolean().default(false),
});
export type KlingElementListInputT = z.infer<typeof KlingElementListInput>;

// KlingElementDeleteInput — soft-delete locally + optionally hard-delete on backend
// confirm:true is required (literal guard — irreversible on backend)
export const KlingElementDeleteInput = z.object({
  elementId: z.string().min(1),
  confirm: z.literal(true, { errorMap: () => ({ message: 'confirm:true required to delete (irreversible)' }) }),
  alsoDeleteRemote: z.boolean().default(true),
});
export type KlingElementDeleteInputT = z.infer<typeof KlingElementDeleteInput>;

// KlingLipSyncInput — Kling V3 Pro lip-sync: drive a source video with text or audio (P15 Task 8)
// _KlingLipSyncBase — ZodObject base shape for tools/list (DEBT-008 compliant)
// KlingLipSyncInput — ZodEffects with two chained refines for mutual-exclusion validation
export const _KlingLipSyncBase = z.object({
  videoUrl: z.string().url(),
  text: z.string().min(1).optional(),
  audioUrl: z.string().url().optional(),
  emotion: z.enum(['happy', 'angry', 'sad', 'neutral']).optional(),
  modelId: z.enum(['kling-v3-pro']).default('kling-v3-pro'),
  watermarkEnabled: z.boolean().default(false),
});

export const KlingLipSyncInput = _KlingLipSyncBase
  .refine((v) => !!v.text || !!v.audioUrl, {
    message: 'either text or audioUrl required',
  })
  .refine((v) => !(v.text && v.audioUrl), {
    message: 'exactly one of text or audioUrl required (not both)',
  });

export type KlingLipSyncInputT = z.infer<typeof KlingLipSyncInput>;

// KlingElementsInput — compose up to 4 frame-locked element identities into one shot (P15 Task 7)
// elementIds: min 1, max 4 per Kling hard limit
export const KlingElementsInput = z.object({
  prompt: z.string().min(1),
  imageUrl: z.string().url(),
  elementIds: z.array(z.string().min(1)).min(1).max(4, 'max 4 elements per Kling spec'),
  durationSec: z.number().positive().max(10),
  modelId: z.enum(['kling-v3-pro']).default('kling-v3-pro'),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  watermarkEnabled: z.boolean().default(false),
});
export type KlingElementsInputT = z.infer<typeof KlingElementsInput>;

// KlingOmniMultiShotInput — Kling V3 Omni multi-shot orchestration (P15 Task 9)
// _KlingOmniMultiShotBase — ZodObject base shape for tools/list (DEBT-008 compliant)
// KlingOmniMultiShotInput — ZodEffects with two chained refines for runtime validation
//
// Single source of truth for caps: VIDEO_MODELS['kling-v3-omni'].limits
// The non-null assertion is safe: kling-v3-omni is a known static entry in the VIDEO_MODELS
// registry defined in src/core/models.ts with an explicit limits block.
const _omniSpec = VIDEO_MODELS['kling-v3-omni']!;
const OMNI_LIMITS = _omniSpec.limits ?? {
  maxShots: 6,
  maxDurationSec: 30,
  minDurationPerShotSec: 1,
  maxDurationPerShotSec: 10,
};

export const _KlingOmniMultiShotBase = z.object({
  shots: z
    .array(
      z.object({
        // 1-based per Kling Omni API spec. If Kling actually uses 0-based,
        // update min to 0 and the contiguous refine accordingly.
        index: z.number().int().min(1).max(OMNI_LIMITS.maxShots ?? 6),
        prompt: z.string().min(1),
        // FIX (Codex P2 round 11, PR#11): enforce minDurationPerShotSec from
        // the registry. Was `gt(0)` which let sub-second shots (e.g. 0.5s)
        // through schema even though kling-v3-omni.limits.minDurationPerShotSec
        // is 1. The provider would then ship an invalid clip the model can't
        // actually produce.
        duration: z
          .number()
          .min(
            OMNI_LIMITS.minDurationPerShotSec ?? 1,
            `min ${OMNI_LIMITS.minDurationPerShotSec ?? 1}s per shot`,
          )
          .max(
            OMNI_LIMITS.maxDurationPerShotSec ?? 10,
            `max ${OMNI_LIMITS.maxDurationPerShotSec ?? 10}s per shot`,
          ),
      }),
    )
    .min(1, 'shots[] requires at least 1 entry')
    .max(OMNI_LIMITS.maxShots ?? 6, `max ${OMNI_LIMITS.maxShots ?? 6} shots per Kling Omni spec`),
  imageRefs: z.array(z.object({ imageUrl: z.string().url() })).min(1),
  videoRefs: z.array(z.object({ videoUrl: z.string().url() })).optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  watermarkEnabled: z.boolean().default(false),
});

export const KlingOmniMultiShotInput = _KlingOmniMultiShotBase
  .refine(
    (v) => {
      // Indices must be contiguous 1..N with no duplicates
      const indices = v.shots.map((s) => s.index).sort((a, b) => a - b);
      for (let i = 0; i < indices.length; i++) {
        if (indices[i] !== i + 1) return false;
      }
      return true;
    },
    { message: 'shot indices must be contiguous 1..N starting at 1 with no duplicates' },
  )
  .refine(
    (v) => v.shots.reduce((sum, s) => sum + s.duration, 0) <= (OMNI_LIMITS.maxDurationSec ?? 30),
    {
      message: `Omni multi-shot total duration must <= ${OMNI_LIMITS.maxDurationSec ?? 30}s (sum of all shot durations)`,
    },
  );

export type KlingOmniMultiShotInputT = z.infer<typeof KlingOmniMultiShotInput>;

// KlingVideoExtendInput — Kling V3 Pro video extension (P15 Task 10)
// Plain ZodObject (no refines) — no Base/validation split needed.
export const KlingVideoExtendInput = z.object({
  videoUrl: z.string().url(),
  prompt: z.string().min(1),
  hops: z.number().int().min(1).max(4, 'max 4 hops per Kling video-extend (cost sanity cap)'),
  modelId: z.enum(['kling-v3-pro']).default('kling-v3-pro'),
  watermarkEnabled: z.boolean().default(false),
});
export type KlingVideoExtendInputT = z.infer<typeof KlingVideoExtendInput>;

// ---------------------------------------------------------------------------
// KlingPollInput / KlingDownloadInput — manual completion path
// FIX (Codex P1 round 6 PR#11): default MCP Kling tools suppress callback_url
// (HMAC mismatch). Without these, jobs stay 'pending' forever once submitted.
// ---------------------------------------------------------------------------
export const KlingPollInput = z.object({ jobId: z.string().min(1) });
export type KlingPollInputT = z.infer<typeof KlingPollInput>;

export const KlingDownloadInput = z.object({ jobIdOrUrl: z.string().min(1) });
export type KlingDownloadInputT = z.infer<typeof KlingDownloadInput>;

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
// MCP_TOOLS registry — 47 tools total (was 45; +2 from Codex P1 round 6 PR#11)
// 6 image + 7 video + 8 pipeline/utility + 1 help + 4 refs + 1 webhook + 2 cost + 1 route + 7 higgsfield + 11 kling = 47
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

  // ---- Routing (1 — P13 cross-provider routing heuristic; Veo-only today) ----
  {
    name: 'media_video_route',
    description:
      'Pick the optimal provider+model for a video generation request (P13: Veo-only; extended in P14-P16).',
    inputSchema: VideoRouteInput,
  },

  // ---- Higgsfield Soul ID (1 — P14 character training cache) ----
  {
    name: 'media_higgsfield_soul_id',
    description: 'Soul ID lifecycle (create/list/find/markUsed) — character training cache for Higgsfield.',
    inputSchema: _HiggsfieldSoulIdBase,
    validationSchema: HiggsfieldSoulIdInput,
  },

  // ---- Higgsfield DoP (1 — P14 image-to-video with WAN Camera Control verbs) ----
  {
    name: 'media_higgsfield_dop',
    description: 'Higgsfield Director of Photography — image-to-video with WAN Camera Control verbs.',
    inputSchema: HiggsfieldDopInput,
    validationSchema: HiggsfieldDopInput,
  },

  // ---- Higgsfield Cinema Studio (1 — P14 1,296 virtual lenses, focal/aperture/sensor/grading) ----
  {
    name: 'media_higgsfield_cinema_studio',
    description: 'Higgsfield Cinema Studio 3.5 — 1,296 virtual lenses, focal/aperture/sensor/grading.',
    inputSchema: HiggsfieldCinemaStudioInput,
    validationSchema: HiggsfieldCinemaStudioInput,
  },

  // ---- Higgsfield Speak (1 — P14 Task 11 lip-sync: portrait + audio → talking head) ----
  {
    name: 'media_higgsfield_speak',
    description: 'Higgsfield Speak / Speak 2.0 lip-sync — portrait + audio → talking head.',
    // debt-008 split: plain ZodObject for MCP inputSchema introspection;
    // refined schema (with per-model duration cap) for runtime validation.
    inputSchema: _HiggsfieldSpeakBase,
    validationSchema: HiggsfieldSpeakInput,
  },

  // ---- Higgsfield Marketing Studio (1 — P14 Task 12 UGC templates from product URL) ----
  {
    name: 'media_higgsfield_marketing_studio',
    description: 'Higgsfield Marketing Studio — 9 UGC templates from product URL (unboxing/TV spot/reel/etc).',
    inputSchema: HiggsfieldMarketingStudioInput,
    validationSchema: HiggsfieldMarketingStudioInput,
  },

  // ---- Higgsfield Recast (1 — P14 Task 13 character swap in existing video) ----
  {
    name: 'media_higgsfield_recast',
    description: 'Higgsfield Recast Studio — swap character in existing video (Instadump / Character Swap).',
    inputSchema: HiggsfieldRecastInput,
    validationSchema: HiggsfieldRecastInput,
  },

  // ---- Higgsfield Virality Predictor (1 — P14 Task 14 score asset viral/audience/hook) ----
  {
    name: 'media_higgsfield_virality_predictor',
    description: 'Higgsfield Virality Predictor — score an asset (viral / audience-fit / hook-strength).',
    inputSchema: HiggsfieldViralityPredictorInput,
    validationSchema: HiggsfieldViralityPredictorInput,
  },

  // ---- Kling Motion Brush (1 — P15 Task 6: paint regions of still image with motion vectors) ----
  {
    name: 'media_kling_motion_brush',
    description:
      'Kling V3 Pro motion brush - paint regions of a still image with motion vectors. Returns a jobId; poll status or wait for webhook callback. Input: imageUrl, prompt, regions[].',
    inputSchema: KlingMotionBrushInput,
  },

  // ---- Kling Elements CRUD (3 — P15 Tasks 6.5 / 6.6 / 6.7) ----
  {
    name: 'media_kling_element_create',
    description:
      'Create a Kling element_id from an uploaded image (URL or base64). Returns element_id for use in media_kling_elements composition. Cached locally in kling_elements SQLite table.',
    inputSchema: _KlingElementCreateBase,
    validationSchema: KlingElementCreateInput,
  },
  {
    name: 'media_kling_element_list',
    description:
      'List registered Kling element_ids. Defaults to local cache; pass syncWithBackend:true to refresh against Kling API.',
    inputSchema: KlingElementListInput,
  },
  {
    name: 'media_kling_element_delete',
    description:
      'Delete a Kling element_id from local cache + (default) Kling backend. Requires confirm:true (irreversible on backend). Local row is soft-deleted (deleted_at set) for audit.',
    inputSchema: KlingElementDeleteInput,
  },

  // ---- Kling Elements composition (1 — P15 Task 7: compose up to 4 frame-locked identities into one shot) ----
  {
    name: 'media_kling_elements',
    description:
      'Kling V3 Pro Elements - up to 4 frame-locked reference identities (characters, objects, locations) composed into one shot via base image + elementIds. Use for consistent multi-character scenes.',
    inputSchema: KlingElementsInput,
  },

  // ---- Kling Lip-Sync (1 — P15 Task 8: drive source video with text or audio) ----
  {
    name: 'media_kling_lip_sync',
    description:
      'Kling V3 Pro Lip-Sync - drive a source video clip with either generated speech (text + emotion picker: happy/angry/sad/neutral) or supplied audio file URL. Exactly one of text or audioUrl required.',
    inputSchema: _KlingLipSyncBase,
    validationSchema: KlingLipSyncInput,
  },

  // ---- Kling Omni Multi-Shot (1 — P15 Task 9: single-API multi-cut orchestration) ----
  {
    name: 'media_kling_omni_multishot',
    description:
      'Kling V3 Omni multi-shot orchestration - single API call generates up to 6 contiguous cuts with per-shot prompt + duration, sharing visual identity via imageRefs. Use for music-video / narrative sequences. Total duration = sum of shot durations (max 30s).',
    inputSchema: _KlingOmniMultiShotBase,
    validationSchema: KlingOmniMultiShotInput,
  },

  // ---- Kling Video Extend (1 — P15 Task 10: add ~4.5s continuation per hop, up to 4 hops ~18s) ----
  {
    name: 'media_kling_video_extend',
    description:
      'Kling V3 Pro video extension - adds ~4.5s of continuation per hop to a source video. Chain up to 4 hops (~18s total extension). Returns first hop jobId + hopsRemaining; re-invoke after webhook fires to chain.',
    inputSchema: KlingVideoExtendInput,
  },

  // ---- Kling lifecycle tools (2 — Codex P1 round 6 PR#11: manual completion path when callbacks suppressed) ----
  {
    name: 'media_kling_poll',
    description:
      'Poll a Kling job by internal jobId. Hydrates native_task_id + endpoint kind from cost-tracker DB, then calls the matching Kling REST poll endpoint. Use when callback URLs are suppressed (default MCP flow) and you need to drive a job to completion manually.',
    inputSchema: KlingPollInput,
  },
  {
    name: 'media_kling_download',
    description:
      'Download a Kling job asset by internal jobId or direct URL. When given a jobId, hydrates state from DB, polls to obtain a fresh URL, downloads the asset, and writes it under MEDIA_FORGE_OUTPUTS_DIR. Asset URLs are TTL-bounded; download immediately after the job reports completed.',
    inputSchema: KlingDownloadInput,
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
