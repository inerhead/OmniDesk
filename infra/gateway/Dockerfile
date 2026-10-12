# syntax=docker/dockerfile:1
# Gateway de producción: build de la web (PWA) servido por Caddy + proxy al API.
# Contexto de build: raíz del monorepo (infra/deploy/docker-compose.prod.yml lo configura).

FROM node:24-bookworm-slim AS build
ENV TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/api/package.json apps/api/package.json
COPY tools/simulator/package.json tools/simulator/package.json
RUN pnpm install --frozen-lockfile --filter "@omnidesk/web..."
# Se fijan en el build (base de Vite, manifest, scope del service worker).
ARG BASE_PATH=/omnidesk
ARG VITE_API_URL=
ENV BASE_PATH=${BASE_PATH} VITE_API_URL=${VITE_API_URL} NODE_ENV=production
RUN pnpm exec turbo run build --filter=@omnidesk/web...

FROM caddy:2
ARG BASE_PATH=/omnidesk
# El Caddyfile lee BASE_PATH ({$BASE_PATH}) al arrancar; debe coincidir con el del build.
ENV BASE_PATH=${BASE_PATH}
COPY infra/gateway/Caddyfile.prod /etc/caddy/Caddyfile
# Los archivos quedan en /srv<BASE_PATH>/: la ruta pública coincide con la del disco.
COPY --from=build /repo/apps/web/dist/ /srv${BASE_PATH}/
EXPOSE 80
