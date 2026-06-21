-- 008-video-jobs-tenant.sql — attribute each video job to its tenant so the
-- async webhook completion path can record the generation in the gallery.
-- Existing rows: tenant_id stays NULL → treated as 'default' by readers.
ALTER TABLE video_jobs ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_video_jobs_tenant ON video_jobs (tenant_id);
