-- SPEC 22: secreto de cliente para las llamadas a n8n (`X-Client-Id` es el id del canal); sustituye
-- a la firma HMAC saliente.
ALTER TABLE "channels" ADD COLUMN "n8n_client_secret_enc" BYTEA;

-- Ningún canal tiene aún secreto de cliente: nunca se llama a n8n sin autenticar.
UPDATE "channels" SET "ai_enabled" = false WHERE "ai_enabled";
