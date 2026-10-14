-- SPEC 14: adjuntos de mensajes.
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER');
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "sha256" TEXT,
    "provider_media_id" TEXT,
    "storage_key" TEXT,
    "status" "AttachmentStatus" NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_attachments_message_id_key" ON "message_attachments"("message_id");
CREATE INDEX "message_attachments_tenant_id_idx" ON "message_attachments"("tenant_id");

ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
