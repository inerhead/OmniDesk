import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` no necesita conexión; las migraciones sí fallan si falta DATABASE_URL.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
