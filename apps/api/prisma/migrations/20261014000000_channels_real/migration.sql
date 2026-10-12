-- SPEC 09: proveedor por canal, webhook de n8n y secretos HMAC cifrados.

-- AlterEnum
-- El valor nuevo no se puede usar en la misma transacción: el canal demo migra en la siguiente migración.
ALTER TYPE "ChannelProvider" ADD VALUE 'SIMULATED' BEFORE 'N8N';

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "credentials_rotated_at" TIMESTAMPTZ(3),
ADD COLUMN     "hmac_secret_enc" BYTEA,
ADD COLUMN     "hmac_secret_prev_enc" BYTEA,
ADD COLUMN     "hmac_secret_prev_until" TIMESTAMPTZ(3),
ADD COLUMN     "phone_number" TEXT,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "webhook_url" TEXT;

-- AlterTable
ALTER TABLE "integration_credentials" ADD COLUMN     "expires_at" TIMESTAMPTZ(3);
