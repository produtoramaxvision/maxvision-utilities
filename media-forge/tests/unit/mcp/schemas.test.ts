import { describe, it, expect } from 'vitest';
import {
  MCP_TOOLS,
  getMCPToolByName,
  listMCPToolNames,
  // inline pipeline schemas (for direct parse tests)
  DryRunPayloadInput,
  EstimateCostInput,
  ValidateEnvironmentInput,
  CapabilityMatrixInput,
  ListOutputsInput,
  GetJobMetadataInput,
  RunOcrInput,
  CheckBrandComplianceInput,
  MediaHelpInput,
} from '../../../src/mcp/schemas.js';

const EXPECTED_TOOL_NAMES = [
  // image (6)
  'media_generate_image',
  'media_generate_imagen',
  'media_edit_image',
  'media_compose_scene',
  'media_describe_image',
  'media_extract_palette',
  // video (7)
  'media_generate_video_t2v',
  'media_generate_video_i2v',
  'media_generate_video_interpolate',
  'media_generate_video_with_refs',
  'media_extend_video',
  'media_poll_video_operation',
  'media_download_video',
  // pipeline / utility (8)
  'media_dry_run_payload',
  'media_estimate_cost',
  'media_validate_environment',
  'media_capability_matrix',
  'media_list_outputs',
  'media_get_job_metadata',
  'media_run_ocr',
  'media_check_brand_compliance',
  // help (1)
  'media_help',
  // refs (4)
  'media_refs_search',
  'media_refs_compose_moodboard',
  'media_refs_presign',
  'media_refs_index',
  // webhook (1 — P13 scaffold for P14+ provider callbacks)
  'media_video_webhook_status',
  // cost estimation (2 — P13 provider-registry cost tools)
  'media_video_cost_estimate',
  'media_video_cost_report',
  // routing (1 — P13 cross-provider routing heuristic)
  'media_video_route',
  // higgsfield (7 — P14 provider tools)
  'media_higgsfield_soul_id',
  'media_higgsfield_dop',
  'media_higgsfield_cinema_studio',
  'media_higgsfield_speak',
  'media_higgsfield_marketing_studio',
  'media_higgsfield_recast',
  'media_higgsfield_virality_predictor',
  // higgsfield generate (1 — Codex P2 round 7 PR#10 generic Soul/Soul2 submit)
  'media_higgsfield_generate',
  // higgsfield async lifecycle (2 — Codex P2 round 5 PR#10)
  'media_higgsfield_poll',
  'media_higgsfield_download',
  // kling (1 — P15 Task 6)
  'media_kling_motion_brush',
  // kling elements CRUD (3 — P15 Tasks 6.5 / 6.6 / 6.7)
  'media_kling_element_create',
  'media_kling_element_list',
  'media_kling_element_delete',
  // kling elements composition (1 — P15 Task 7)
  'media_kling_elements',
  // kling lip-sync (1 — P15 Task 8)
  'media_kling_lip_sync',
  // kling omni multi-shot (1 — P15 Task 9)
  'media_kling_omni_multishot',
  // kling video extend (1 — P15 Task 10)
  'media_kling_video_extend',
  // kling lifecycle (2 — Codex P1 round 6 PR#11)
  'media_kling_poll',
  'media_kling_download',
  // seedance 2.0 (4 — P16 Task 7: t2v / i2v / multishot / reference-fusion)
  'media_seedance_text_to_video',
  'media_seedance_image_to_video',
  'media_seedance_multishot',
  'media_seedance_reference_fusion',
  // gallery (1 — F-I: list tenant's own generation history)
  'list_my_generations',
] as const;

// ---------------------------------------------------------------------------
// Registry shape assertions
// ---------------------------------------------------------------------------
describe('MCP_TOOLS registry', () => {
  it('contains exactly 55 tools', () => {
    expect(MCP_TOOLS.length).toBe(55);
  });

  it('is frozen (Object.isFrozen)', () => {
    expect(Object.isFrozen(MCP_TOOLS)).toBe(true);
  });

  it('every tool has a non-empty name', () => {
    for (const tool of MCP_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
    }
  });

  it('every tool name starts with media_ or is a gallery tool (list_my_*)', () => {
    for (const tool of MCP_TOOLS) {
      const ok = tool.name.startsWith('media_') || tool.name.startsWith('list_my_');
      expect(ok).toBe(true);
    }
  });

  it('every tool has a non-empty description', () => {
    for (const tool of MCP_TOOLS) {
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('every tool has an inputSchema', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('no duplicate tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// listMCPToolNames()
// ---------------------------------------------------------------------------
describe('listMCPToolNames()', () => {
  it('returns an array of length 55', () => {
    expect(listMCPToolNames().length).toBe(55);
  });

  it('contains all 55 expected tool names', () => {
    const names = listMCPToolNames();
    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// getMCPToolByName()
// ---------------------------------------------------------------------------
describe('getMCPToolByName()', () => {
  it('returns the tool for a known name', () => {
    const tool = getMCPToolByName('media_generate_image');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('media_generate_image');
  });

  it('returns undefined for an unknown name', () => {
    expect(getMCPToolByName('nope')).toBeUndefined();
  });

  it('returns the tool for each expected name', () => {
    for (const name of EXPECTED_TOOL_NAMES) {
      const tool = getMCPToolByName(name);
      expect(tool).toBeDefined();
      expect(tool?.name).toBe(name);
    }
  });
});

// ---------------------------------------------------------------------------
// inputSchema parse tests — representative tools
// ---------------------------------------------------------------------------
describe('inputSchema parsing — image tool (media_generate_image)', () => {
  it('parses valid nano-banana-pro input against inputSchema', () => {
    const tool = getMCPToolByName('media_generate_image');
    expect(tool).toBeDefined();
    const r = tool!.inputSchema.safeParse({ op: 'nano-banana-pro', prompt: 'a landscape' });
    expect(r.success).toBe(true);
  });

  it('rejects invalid input against inputSchema', () => {
    const tool = getMCPToolByName('media_generate_image');
    expect(tool).toBeDefined();
    // empty prompt → fails min(1)
    const r = tool!.inputSchema.safeParse({ op: 'nano-banana-pro', prompt: '' });
    expect(r.success).toBe(false);
  });
});

describe('inputSchema parsing — video tool (media_generate_video_t2v)', () => {
  it('parses valid t2v input against inputSchema', () => {
    const tool = getMCPToolByName('media_generate_video_t2v');
    expect(tool).toBeDefined();
    const r = tool!.inputSchema.safeParse({ op: 't2v', prompt: 'a timelapse' });
    expect(r.success).toBe(true);
  });
});

describe('inputSchema parsing — pipeline tool (media_estimate_cost)', () => {
  it('parses valid estimate_cost input against inputSchema', () => {
    const tool = getMCPToolByName('media_estimate_cost');
    expect(tool).toBeDefined();
    const r = tool!.inputSchema.safeParse({
      items: [{ op: 'nano-banana-pro', params: { prompt: 'test' } }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty items array', () => {
    const tool = getMCPToolByName('media_estimate_cost');
    expect(tool).toBeDefined();
    const r = tool!.inputSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pipeline / utility schema unit tests
// ---------------------------------------------------------------------------
describe('DryRunPayloadInput', () => {
  it('accepts valid op + params', () => {
    const r = DryRunPayloadInput.safeParse({
      op: 'nano-banana-pro',
      params: { prompt: 'test' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const r = DryRunPayloadInput.safeParse({
      op: 'nano-banana-pro',
      params: {},
      extra: 'ghost',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty op', () => {
    const r = DryRunPayloadInput.safeParse({ op: '', params: {} });
    expect(r.success).toBe(false);
  });
});

describe('EstimateCostInput', () => {
  it('accepts single item', () => {
    const r = EstimateCostInput.safeParse({
      items: [{ op: 't2v', params: {} }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty items array (min 1)', () => {
    const r = EstimateCostInput.safeParse({ items: [] });
    expect(r.success).toBe(false);
  });
});

describe('ValidateEnvironmentInput', () => {
  it('accepts empty object', () => {
    const r = ValidateEnvironmentInput.safeParse({});
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const r = ValidateEnvironmentInput.safeParse({ extra: 'val' });
    expect(r.success).toBe(false);
  });
});

describe('CapabilityMatrixInput', () => {
  it('accepts empty object (model optional)', () => {
    const r = CapabilityMatrixInput.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts valid model filter', () => {
    const r = CapabilityMatrixInput.safeParse({ model: 'veo-3.1-generate-preview' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown model', () => {
    const r = CapabilityMatrixInput.safeParse({ model: 'gpt-5' });
    expect(r.success).toBe(false);
  });
});

describe('ListOutputsInput', () => {
  it('accepts empty object with defaults', () => {
    const r = ListOutputsInput.safeParse({});
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.limit).toBe(100);
  });

  it('rejects limit=0 (min 1)', () => {
    const r = ListOutputsInput.safeParse({ limit: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects limit=1001 (max 1000)', () => {
    const r = ListOutputsInput.safeParse({ limit: 1001 });
    expect(r.success).toBe(false);
  });
});

describe('GetJobMetadataInput', () => {
  it('accepts valid jobId', () => {
    const r = GetJobMetadataInput.safeParse({ jobId: 'job-abc-123' });
    expect(r.success).toBe(true);
  });

  it('rejects empty jobId (min 1)', () => {
    const r = GetJobMetadataInput.safeParse({ jobId: '' });
    expect(r.success).toBe(false);
  });
});

describe('RunOcrInput', () => {
  it('accepts imagePath with default languages', () => {
    const r = RunOcrInput.safeParse({ imagePath: '/img/scan.png' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.languages).toEqual(['en']);
  });

  it('accepts custom languages array', () => {
    const r = RunOcrInput.safeParse({ imagePath: '/img/scan.png', languages: ['pt', 'en'] });
    expect(r.success).toBe(true);
  });

  it('rejects empty imagePath', () => {
    const r = RunOcrInput.safeParse({ imagePath: '' });
    expect(r.success).toBe(false);
  });
});

describe('CheckBrandComplianceInput', () => {
  it('accepts valid paths', () => {
    const r = CheckBrandComplianceInput.safeParse({
      imagePath: '/img/ad.png',
      brandGuidelinesPath: '/guidelines/brand.yaml',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty imagePath', () => {
    const r = CheckBrandComplianceInput.safeParse({
      imagePath: '',
      brandGuidelinesPath: '/guidelines/brand.yaml',
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing brandGuidelinesPath', () => {
    const r = CheckBrandComplianceInput.safeParse({ imagePath: '/img/ad.png' });
    expect(r.success).toBe(false);
  });
});

describe('MediaHelpInput', () => {
  it('accepts empty object (topic optional)', () => {
    const r = MediaHelpInput.safeParse({});
    expect(r.success).toBe(true);
  });

  it('accepts with topic', () => {
    const r = MediaHelpInput.safeParse({ topic: 'media_generate_image' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    const r = MediaHelpInput.safeParse({ topic: 'x', extra: 'ghost' });
    expect(r.success).toBe(false);
  });
});
