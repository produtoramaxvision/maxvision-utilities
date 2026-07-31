-- 010-image-jobs-tenant.sql — attribute each image job to its tenant so the
-- cost guard's daily-spend query can be scoped per tenant, mirroring
-- 008-video-jobs-tenant.sql for video_jobs.
-- Existing rows: tenant_id stays NULL → treated as 'default' by readers.
ALTER TABLE image_jobs ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_image_jobs_tenant ON image_jobs (tenant_id);
