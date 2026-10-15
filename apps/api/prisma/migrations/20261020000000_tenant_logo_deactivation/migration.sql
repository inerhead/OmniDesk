-- SPEC 16: logo de la empresa e inactivación. Todas las empresas existentes quedan activas.
ALTER TABLE "tenants" ADD COLUMN "logo_key" TEXT;
ALTER TABLE "tenants" ADD COLUMN "logo_updated_at" TIMESTAMPTZ(3);
ALTER TABLE "tenants" ADD COLUMN "deactivated_at" TIMESTAMPTZ(3);
ALTER TABLE "tenants" ADD COLUMN "deactivated_by_member_id" UUID;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_deactivated_by_member_id_fkey"
    FOREIGN KEY ("deactivated_by_member_id") REFERENCES "tenant_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
