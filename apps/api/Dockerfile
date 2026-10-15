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
FROM base AS dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/web/package.json apps/web/package.json
COPY tools/simulator/package.json tools/simulator/package.json
RUN pnpm install --frozen-lockfile --filter "@omnidesk/api..."
EXPOSE 5001
# Las migraciones corren antes que el API: sin esta guarda, Prisma fallaría con un mensaje que no nombra la variable.
CMD ["sh", "-c", ": \"${DATABASE_URL:?falta DATABASE_URL en .env}\" && pnpm --filter @omnidesk/api db:deploy && pnpm --filter @omnidesk/api db:app-role && pnpm exec turbo run dev --filter=@omnidesk/api..."]

# --- Producción (infra/deploy/docker-compose.prod.yml) ---

# Compila contracts + API y aísla el API con solo sus dependencias de producción.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/web/package.json apps/web/package.json
COPY tools/simulator/package.json tools/simulator/package.json
RUN pnpm install --frozen-lockfile --filter "@omnidesk/api..."
# `build` = `prisma generate` + `nest build`: el cliente generado queda compilado en dist/.
RUN pnpm exec turbo run build --filter=@omnidesk/api...
RUN pnpm --filter @omnidesk/api deploy --prod --legacy /out

FROM base AS prod
# Commit corto o etiqueta (lo pasa deploy.sh); se ve en /health y en la página Estado.
ARG APP_VERSION=
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules/ node_modules/
COPY --from=build --chown=node:node /out/prisma/ prisma/
COPY --from=build --chown=node:node /out/prisma.config.ts ./
COPY --from=build --chown=node:node /repo/apps/api/dist/ dist/
COPY --from=build --chown=node:node /repo/apps/api/scripts/ensure-app-role.mjs scripts/
# Usuario no root (uid 1000 de la imagen de Node).
USER node
EXPOSE 5001
# Las migraciones pendientes se aplican antes de aceptar peticiones; si fallan, el API no arranca.
# Después se asegura la contraseña del rol de aplicación (SPEC 12, DATABASE_APP_PASSWORD).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node scripts/ensure-app-role.mjs && exec node dist/main.js"]
