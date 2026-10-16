-- SPEC 20: borrado de empresas por la plataforma. Ninguna fila existente cambia: la columna es nula.
ALTER TABLE "tenants" ADD COLUMN "deletion_requested_at" TIMESTAMPTZ(3);

-- Constancia que sobrevive a la empresa: tenant_id sin FK y sin RLS (solo caminos de sistema).
CREATE TABLE "tenant_deletions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tenant_name" TEXT NOT NULL,
    "tenant_slug" TEXT NOT NULL,
    "requested_by_user_id" UUID,
    "requested_by_email" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "members_deleted" INTEGER NOT NULL DEFAULT 0,
    "users_deleted" INTEGER NOT NULL DEFAULT 0,
    "conversations_deleted" INTEGER NOT NULL DEFAULT 0,
    "messages_deleted" INTEGER NOT NULL DEFAULT 0,
    "attachments_deleted" INTEGER NOT NULL DEFAULT 0,
    "objects_deleted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tenant_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_deletions_tenant_id_key" ON "tenant_deletions"("tenant_id");
CREATE INDEX "tenant_deletions_requested_at_idx" ON "tenant_deletions"("requested_at");

ALTER TABLE "tenant_deletions" ADD CONSTRAINT "tenant_deletions_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
