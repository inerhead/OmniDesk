-- SPEC 12: rol de aplicación para Row Level Security.
-- `omnidesk_app` (NOLOGIN) tiene los permisos sobre las tablas y NO es dueño de ninguna ni tiene
-- BYPASSRLS. `omnidesk_app_login` hereda de él y es con el que se conecta el API (DATABASE_APP_URL);
-- su contraseña la fija `scripts/ensure-app-role.mjs` al arrancar, desde DATABASE_APP_PASSWORD.
-- Los roles son del clúster: si ya existen (otra base del mismo servidor, p. ej. la de pruebas), se
-- reutilizan.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnidesk_app') THEN
    CREATE ROLE omnidesk_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnidesk_app_login') THEN
    CREATE ROLE omnidesk_app_login LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT IN ROLE omnidesk_app;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO omnidesk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omnidesk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omnidesk_app;
-- El historial de migraciones solo lo toca el dueño.
REVOKE ALL ON TABLE "_prisma_migrations" FROM omnidesk_app;

-- Las tablas que creen migraciones futuras (como dueño) nacen con los mismos permisos.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omnidesk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO omnidesk_app;
