-- 002_sweep_oracle.sql — settle first-wins + status_url for the sweep oracle.

-- (a) DATA REPAIR: collapse any pre-existing duplicate settles. Keep the EARLIEST
--     settle (lowest id) per reservation; delete the rest.
DELETE FROM ledger_entries le
USING (
  SELECT id, row_number() OVER (PARTITION BY reservation_id ORDER BY id) AS rn
  FROM ledger_entries
  WHERE kind IN ('capture','release') AND reservation_id IS NOT NULL
) dup
WHERE le.id = dup.id AND dup.rn > 1;

-- (b) At most one settle (capture XOR release) per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_settle_per_reservation
  ON ledger_entries (reservation_id)
  WHERE kind IN ('capture','release');

-- (c) Oracle: each reservation may carry the URL credit-core probes for job status.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS status_url text;
