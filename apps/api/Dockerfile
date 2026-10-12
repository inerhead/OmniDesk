# syntax=docker/dockerfile:1
# Contexto de build: raíz del monorepo (docker compose lo configura).

FROM node:24-bookworm-slim AS base
# Prisma necesita OpenSSL para su motor de migraciones.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Etapa de desarrollo: dependencias dentro de la imagen; el código fuente llega por bind mount.
# La etapa de producción llega con el spec de despliegue.
FROM base AS dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter "@omnidesk/api..."
EXPOSE 5001
# Las migraciones corren antes que el API: sin esta guarda, Prisma fallaría con un mensaje que no nombra la variable.
CMD ["sh", "-c", ": \"${DATABASE_URL:?falta DATABASE_URL en .env}\" && pnpm --filter @omnidesk/api db:deploy && pnpm exec turbo run dev --filter=@omnidesk/api..."]
