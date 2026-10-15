-- SPEC 12: retención por empresa, registro de borrados y cascadas para borrar conversaciones y contactos.
-- Todas las empresas existentes conservan sus datos indefinidamente (retention_days NULL).
ALTER TABLE "tenants" ADD COLUMN "retention_days" INTEGER;

CREATE TABLE "deletion_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_member_id" UUID,
    "conversations_deleted" INTEGER NOT NULL,
    "messages_deleted" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deletion_log_tenant_id_created_at_idx" ON "deletion_log"("tenant_id", "created_at");

ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_fkey";
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_conversation_id_fkey";
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_identities" DROP CONSTRAINT "contact_identities_contact_id_fkey";
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
