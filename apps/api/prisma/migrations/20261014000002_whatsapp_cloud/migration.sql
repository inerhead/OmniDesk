ALTER TYPE "ChannelProvider" ADD VALUE 'WHATSAPP_CLOUD';
ALTER TABLE "channels"
 ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "whatsapp_access_token_enc" BYTEA,
 ADD COLUMN "whatsapp_app_secret_enc" BYTEA,
 ADD COLUMN "whatsapp_verify_token_hash" TEXT;
