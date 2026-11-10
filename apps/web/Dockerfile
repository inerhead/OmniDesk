# syntax=docker/dockerfile:1
# Contexto de build: raíz del monorepo (docker compose lo configura).

FROM node:26-bookworm-slim AS base
ENV TURBO_TELEMETRY_DISABLED=1
# Node 26 ya no trae corepack (SPEC 31).
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /repo

# Etapa de desarrollo: dependencias dentro de la imagen; el código fuente llega por bind mount.
# El hosting estático de producción llega con el spec de despliegue.
FROM base AS dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/api/package.json apps/api/package.json
COPY tools/simulator/package.json tools/simulator/package.json
RUN pnpm install --frozen-lockfile --filter "@omnidesk/web..."
EXPOSE 5173 4173
CMD ["pnpm", "exec", "turbo", "run", "dev", "--filter=@omnidesk/web..."]
