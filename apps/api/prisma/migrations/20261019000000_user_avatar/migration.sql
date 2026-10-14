-- SPEC 15: foto de perfil subida por el usuario. `avatar_url` sigue siendo la de Google.
ALTER TABLE "users" ADD COLUMN "avatar_key" TEXT;
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(3);
