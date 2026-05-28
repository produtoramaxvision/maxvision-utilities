-- Codex P2 round 17 (PR#11): persist the actual Kling endpoint kind on submit so
-- hydrateFromDb can reconstruct it after a process restart. Previously the column
-- was derived from `mode` alone, but extras-routed jobs (base mode + elementIds
-- or lipSync) submit to /v1/motion or /advanced-lip-sync — re-deriving from mode
-- without the original extras pointed poll at the wrong endpoint and the job
-- became unpollable.
ALTER TABLE video_jobs ADD COLUMN endpoint_kind TEXT;
