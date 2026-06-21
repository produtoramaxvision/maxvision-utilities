# Changelog

## [0.1.3] - 2026-06-21

### Security

- SSRF / secret-exfiltration guard on the sweep probe (HIGH). The probe attached the
  shared x-mf-status-secret to a caller-supplied status_url; any API-key holder could
  harvest the secret or drive blind SSRF. Now the secret is sent ONLY to a host in
  SWEEP_PROBE_ALLOWED_HOSTS (exact match); userinfo, IP literals, loopback/.local,
  non-http(s), and redirects are rejected. Empty allowlist denies all (fail safe).

## [0.1.2] - 2026-06-20

### Fixed

- **Cross-kind settle overdraft (P0, money):** a `release` and a `capture` for the same
  reservation have different `kind`, so `ON CONFLICT (kind, external_id)` did not dedup
  them — both inserted, letting a late capture re-charge after a sweep release (negative
  balance). Now enforced first-settle-wins via a partial unique index
  `uq_ledger_settle_per_reservation ON ledger_entries (reservation_id) WHERE kind IN ('capture','release')`;
  `Store.append` swallows the resulting `23505` as a no-op.

### Added

- **Production sweep caller.** `runSweep` is now invoked in production via a Redis-locked
  periodic scheduler (`SET NX PX` mutual exclusion → multi-replica-safe), with anti-overlap
  and error isolation. Closes the F1 gap (expired Kling reservations no longer hang forever).
- **Generic cross-service status oracle.** Each reservation carries a `status_url`
  (`status_url` column); the sweep GETs it (shared-secret `x-mf-status-secret`, timeout) to
  decide capture vs release. Any uncertainty (no url, timeout, non-2xx, network error) →
  RELEASE (never charges on a guess). `completed` captures the REAL cost via `actualCredits`.
- `runSweepAllTenants` (multi-tenant orchestrator), `Store.tenantsWithExpiredReservations`,
  `Store.statusUrlFor`, admin `POST /sweep` (authed, manual trigger), graceful shutdown
  (SIGTERM/SIGINT → server.close + scheduler.stop + pool/redis cleanup).
- Migration `002_sweep_oracle.sql` (data-repair of duplicate settles + partial index + `status_url`).

### Env

- `SWEEP_ENABLED` (default true), `SWEEP_INTERVAL_MS` (60000), `SWEEP_LOCK_TTL_MS` (300000),
  `SWEEP_PROBE_TIMEOUT_MS` (4000), `MEDIA_FORGE_STATUS_SECRET`, `REDIS_URL`.
