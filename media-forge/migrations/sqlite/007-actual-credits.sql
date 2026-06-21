-- Task 8.5: persist actual_credits alongside actual_usd so credit-core sweep
-- can read the already-computed value without re-deriving it.
ALTER TABLE video_jobs ADD COLUMN actual_credits INTEGER;
