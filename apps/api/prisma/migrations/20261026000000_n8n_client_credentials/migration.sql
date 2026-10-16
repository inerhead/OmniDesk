-- SPEC 22: credenciales de cliente para las llamadas a n8n; sustituyen a la firma HMAC saliente.
ALTER TABLE "channels" ADD COLUMN "n8n_client_id" TEXT,
ADD COLUMN "n8n_client_secret_enc" BYTEA;

-- Ningún canal tiene aún credenciales de cliente: nunca se llama a n8n sin autenticar.
UPDATE "channels" SET "ai_enabled" = false WHERE "ai_enabled";
