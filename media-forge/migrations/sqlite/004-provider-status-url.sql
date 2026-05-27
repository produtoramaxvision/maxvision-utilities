-- Codex P2 round 7 PR#10 — persist Higgsfield-returned status_url alongside
-- provider_request_id so pollStatus uses the server's authoritative URL
-- (signed URLs, alternative paths) instead of reconstructing it.
ALTER TABLE provider_request_map ADD COLUMN status_url TEXT;
