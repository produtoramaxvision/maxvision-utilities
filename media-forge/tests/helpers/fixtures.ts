export const SAMPLE_REFINED_SPEC = {
  domain: 'product-photographer',
  prompt: 'A leather handbag on white marble',
  model: 'gemini-3-pro-image-preview' as const,
  imageSize: '4K' as const,
  aspectRatio: '1:1' as const,
  required_text: undefined,
  enterprise_mode: false,
};

export const SAMPLE_BRAND_GUIDELINES = `
colors:
  primary: "#FF6B00"
  secondary: "#1A1A2E"
  tolerance_dE2000: 5
typography:
  approved_fonts: [Inter, "Inter Display"]
  forbidden: [Comic Sans, Papyrus]
`;

export const SAMPLE_TRACE_ENTRY = {
  ts: '2026-05-22T00:00:00Z',
  stage: 'product-photographer',
  input_hash: 'sha256:abc',
  output_path: '.media-forge/jobs/test/v1/hero.png',
  model: 'gemini-3-pro-image-preview',
  params: { aspectRatio: '1:1', imageSize: '4K' },
  duration_ms: 14200,
  cost_usd: 0.24,
};

/** 1x1 PNG (transparent) — useful as fake base64 image bytes */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
