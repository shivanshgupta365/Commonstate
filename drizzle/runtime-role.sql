-- Run once with the migration/owner connection. PRODUCT_DATABASE_URL must use
-- this role (or an equivalent NOBYPASSRLS role), never the schema owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commonstate_runtime') THEN
    CREATE ROLE commonstate_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE commonstate_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO commonstate_runtime', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO commonstate_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commonstate_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commonstate_runtime;

-- Audit history is append-only for the application runtime. Migration and
-- break-glass owner roles remain responsible for retention operations.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM commonstate_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO commonstate_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO commonstate_runtime;

-- Deployment step (supply the password through your secret manager, not this
-- repository):
-- ALTER ROLE commonstate_runtime LOGIN PASSWORD '<generated-password>';
-- PRODUCT_DATABASE_URL=postgresql://commonstate_runtime:<password>@.../postgres
