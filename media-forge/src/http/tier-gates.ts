// media-forge/src/http/tier-gates.ts
// Mapa tier → Set de tool names permitidas.
// Nomes extraidos do MCP_TOOLS registry real (src/mcp/schemas.ts).
// pro: construido diretamente do registry — nunca diverge da contagem real.
// Qualquer adicao de tool ao registry fica disponivel em pro automaticamente.
import type { Tier } from './auth.js';
import { MCP_TOOLS } from '../mcp/schemas.js';

// Categorias baseadas no MCP_TOOLS registry (schemas.ts) -- verificadas em 2026-06-02
const IMAGE_TOOLS = new Set([
  'media_generate_image',
  'media_generate_imagen',
  'media_edit_image',
  'media_compose_scene',
  'media_describe_image',
  'media_extract_palette',
]);

const UTILITY_TOOLS = new Set([
  'media_dry_run_payload',
  'media_estimate_cost',
  'media_validate_environment',
  'media_capability_matrix',
  'media_list_outputs',
  'media_get_job_metadata',
  'media_run_ocr',
  'media_check_brand_compliance',
]);

const HELP_TOOLS = new Set(['media_help']);

const VIDEO_TOOLS = new Set([
  'media_generate_video_t2v',
  'media_generate_video_i2v',
  'media_generate_video_interpolate',
  'media_generate_video_with_refs',
  'media_extend_video',
  'media_poll_video_operation',
  'media_download_video',
]);

// COST_TOOLS inclui media_video_webhook_status (routing/cost concern; nao e video de geracao)
const COST_TOOLS = new Set([
  'media_video_cost_estimate',
  'media_video_cost_report',
  'media_video_route',
  'media_video_webhook_status',
]);

const HIGGSFIELD_TOOLS = new Set([
  'media_higgsfield_soul_id',
  'media_higgsfield_dop',
  'media_higgsfield_cinema_studio',
  'media_higgsfield_speak',
  'media_higgsfield_marketing_studio',
  'media_higgsfield_recast',
  'media_higgsfield_virality_predictor',
  'media_higgsfield_generate',
  'media_higgsfield_poll',
  'media_higgsfield_download',
]);

// Kling: 10 tools confirmadas contra schemas.ts
const KLING_TOOLS = new Set([
  'media_kling_motion_brush',
  'media_kling_element_create',
  'media_kling_element_list',
  'media_kling_element_delete',
  'media_kling_elements',
  'media_kling_lip_sync',
  'media_kling_omni_multishot',
  'media_kling_video_extend',
  'media_kling_poll',
  'media_kling_download',
]);

const SEEDANCE_TOOLS = new Set([
  'media_seedance_text_to_video',
  'media_seedance_image_to_video',
  'media_seedance_multishot',
  'media_seedance_reference_fusion',
]);

function union(...sets: Set<string>[]): Set<string> {
  const out = new Set<string>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

export const TIER_GATES: Record<Tier, ReadonlySet<string>> = {
  // free: so imagem + utilidade + help (spec §4.4: "Free tier so caminho imagem")
  free: union(IMAGE_TOOLS, UTILITY_TOOLS, HELP_TOOLS),

  // creator: + video (Veo/Kling/Higgsfield/Seedance) + custo/rota (cap por ciclo vem de F-E)
  creator: union(
    IMAGE_TOOLS, UTILITY_TOOLS, HELP_TOOLS,
    VIDEO_TOOLS, COST_TOOLS,
    HIGGSFIELD_TOOLS, KLING_TOOLS, SEEDANCE_TOOLS,
  ),

  // pro: construido diretamente do registry -- nunca diverge; inclui refs + todas as futuras tools
  pro: new Set(MCP_TOOLS.map((t) => t.name)),
};

/** Verifica se uma tool esta disponivel para o tier informado. */
export function isToolAllowed(tier: Tier, toolName: string): boolean {
  return TIER_GATES[tier].has(toolName);
}
