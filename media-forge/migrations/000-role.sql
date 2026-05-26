-- migrations/000-role.sql
-- Idempotent creation of the scoped role for the refs integration.
-- Run as a superuser with the psql variable mfrw_pass set:
--   psql "$PGVECTOR_ADMIN_URL" -v mfrw_pass="$MFRW_PASS" -f migrations/000-role.sql
--
-- The role is intentionally limited to LOGIN — no superuser, no CREATEDB, no CREATEROLE.
-- Actual schema USAGE + table privileges are granted separately in the migration script
-- (001-refs-index.sql) and via the inline GRANT block in Task 2.5 Step 1d.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'media_forge_refs_rw') THEN
    EXECUTE format('CREATE ROLE media_forge_refs_rw WITH LOGIN PASSWORD %L', :'mfrw_pass');
  END IF;
END
$$;
