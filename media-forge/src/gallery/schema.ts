// media-forge/src/gallery/schema.ts
// Pure types for the gallery subsystem (F-I). No I/O.

export interface GenerationRecord {
  generationId: string;    // job_id do media-forge
  tenantId: string;
  model: string;
  provider: string;
  costUsd: number;
  creditsDebited: number;
  creditValueUsd: number;
  minioKey: string | null;
  signedUrl: string | null;
  status: 'completed' | 'failed';
  createdAt: string;       // ISO 8601
}

export interface GalleryPage {
  items: GenerationRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface InsertGenerationOpts {
  generationId: string;
  tenantId: string;
  model: string;
  provider: string;
  costUsd: number;
  creditsDebited: number;
  creditValueUsd: number;
  minioKey?: string | null;
  signedUrl?: string | null;
  status?: 'completed' | 'failed';
}

export interface ListGenerationsOpts {
  tenantId: string;
  page: number;      // 1-based
  pageSize: number;  // max 100
}
