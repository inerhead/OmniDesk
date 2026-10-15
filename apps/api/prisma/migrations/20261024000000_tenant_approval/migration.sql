-- SPEC 18: aprobación de empresas, suspensión por la plataforma y datos de contacto.
-- Las empresas existentes (la demo incluida) quedan APPROVED. Después el default pasa a PENDING:
-- una empresa nueva queda en revisión salvo que el código diga lo contrario (falla cerrado).
CREATE TYPE "TenantApproval" AS ENUM ('PENDING', 'APPROVED');

ALTER TABLE "tenants"
    ADD COLUMN "approval" "TenantApproval" NOT NULL DEFAULT 'APPROVED',
    ADD COLUMN "approved_at" TIMESTAMPTZ(3),
    ADD COLUMN "approved_by_user_id" UUID,
    ADD COLUMN "suspended_at" TIMESTAMPTZ(3),
    ADD COLUMN "suspended_by_user_id" UUID,
    ADD COLUMN "suspension_reason" TEXT,
    ADD COLUMN "contact_phone" TEXT,
    ADD COLUMN "contact_email" TEXT;

ALTER TABLE "tenants" ALTER COLUMN "approval" SET DEFAULT 'PENDING';

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_approved_by_user_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_suspended_by_user_id_fkey"
    FOREIGN KEY ("suspended_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sin tenant_id ni RLS: solo la leen los caminos de sistema (rol dueño).
CREATE TABLE "tenant_rejections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_name" TEXT NOT NULL,
    "tenant_slug" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "rejected_at" TIMESTAMPTZ(3) NOT NULL,
    "rejected_by_user_id" UUID,
    "dismissed_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenant_rejections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_rejections_user_id_idx" ON "tenant_rejections"("user_id");
CREATE INDEX "tenant_rejections_rejected_at_idx" ON "tenant_rejections"("rejected_at");

ALTER TABLE "tenant_rejections" ADD CONSTRAINT "tenant_rejections_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_rejections" ADD CONSTRAINT "tenant_rejections_rejected_by_user_id_fkey"
    FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
