-- SPEC 12: Row Level Security por empresa en todas las tablas con tenant_id.
-- ENABLE + FORCE: la política aplica también al dueño de la tabla si no es superusuario. El rol
-- dueño del API (superusuario en la imagen de PostgreSQL) la salta: solo lo usan los caminos de
-- sistema. `omnidesk_app` solo ve y escribe filas de la empresa fijada con
-- `set_config('app.tenant_id', <uuid>, true)`; sin ella no ve ninguna (falla cerrado).
-- NULLIF: en una conexión del pool que ya la tuvo fijada, la variable queda en '' y no en NULL.

-- Con FORCE, un dueño sin SUPERUSER ni BYPASSRLS se quedaría sin acceso (los caminos de sistema
-- usan el rol dueño): mejor que la migración falle y el API no arranque.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'El rol % debe ser SUPERUSER o tener BYPASSRLS para activar RLS (SPEC 12)', current_user;
  END IF;
END
$$;

ALTER TABLE "channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channels" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channels" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "integration_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integration_credentials" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contacts" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "contact_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_identities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contact_identities" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversations" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "messages" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "message_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "message_attachments" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "tenant_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_members" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "conversation_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "conversation_events" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "outbox_events" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invitations" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "deletion_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deletion_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deletion_log" TO omnidesk_app
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
