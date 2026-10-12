# OmniDesk

Plataforma SaaS multiempresa para supervisar conversaciones atendidas por IA y por agentes humanos, con historial unificado y una app web instalable (PWA).

- Arquitectura y roadmap: [`docs/arquitectura.md`](docs/arquitectura.md)
- Specs por incremento: [`specs/`](specs/)

## Requisitos

- Docker con Docker Compose v2.
- Opcional, para ejecutar lint, typecheck, tests y builds en el host: Node 24 (`.nvmrc`) y pnpm (versión fijada en `package.json` → `packageManager`; con `corepack enable` se usa automáticamente).

## Arranque rápido

```bash
cp .env.example .env
docker compose up --build
```

Abre <http://localhost:8080> (el gateway; usa siempre esta URL). La página muestra el estado del sistema:

| Mensaje              | Significado                    |
| -------------------- | ------------------------------ |
| `API: ok · DB: ok`   | Todo operativo                 |
| `API: ok · DB: down` | El API responde, PostgreSQL no |
| `API: no disponible` | El API no responde             |
| `Sin conexión`       | El dispositivo no tiene red    |

## Servicios y puertos

| Servicio      | URL en el host                        | Qué es                                                     |
| ------------- | ------------------------------------- | ---------------------------------------------------------- |
| `caddy`       | <http://localhost:8080>               | Gateway de mismo origen: `/api/*` → API, el resto → web    |
| `web`         | <http://localhost:5173>               | Vite dev sin proxy: ahí `/api` no llega al API. Usa 8080   |
| `api`         | <http://localhost:5001/api/v1/health> | API NestJS                                                 |
| Swagger       | <http://localhost:5001/api/docs>      | Documentación del API generada desde `@omnidesk/contracts` |
| `postgres`    | `localhost:5532`                      | PostgreSQL 18                                              |
| `web-preview` | <http://localhost:4173>               | Build de producción de la web (profile `pwa`)              |
| `cloudflared` | URL `https://*.trycloudflare.com`     | Túnel HTTPS hacia `caddy` (profile `tunnel`)               |

¿Algún puerto ya está ocupado en tu máquina? Cámbialo en `.env`: `GATEWAY_HOST_PORT`, `API_HOST_PORT` o `POSTGRES_HOST_PORT`. Si cambias el del gateway, añade su origen a `CORS_ORIGINS`.

## Comandos

```bash
# Stack completo
docker compose up --build          # levanta postgres, api, web y caddy
docker compose down                # detiene (los datos de Postgres se conservan)
docker compose down -v             # detiene y borra los datos de Postgres

# Calidad (desde la raíz, en el host)
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format

# Pruebas e2e del API (con el stack arriba)
docker compose exec api pnpm --filter @omnidesk/api test:e2e

# Migraciones (Prisma)
docker compose exec api pnpm --filter @omnidesk/api db:migrate   # crea y aplica una migración nueva
# Al arrancar, el contenedor `api` aplica las pendientes con `db:deploy`.
```

El código fuente se monta en los contenedores: los cambios en `apps/*/src` se recargan solos. Si cambias dependencias (`package.json`), reconstruye con `docker compose build`.

## Probar la PWA

El service worker está desactivado en `vite dev`. Para probar la instalación se usa el build de producción:

```bash
WEB_UPSTREAM=web-preview:4173 docker compose --profile pwa up --build
```

En Chrome de escritorio, abre <http://localhost:8080> y pulsa **Instalar app**: la app se abre en su propia ventana. `localhost` ya es un contexto seguro, así que no hacen falta certificados.

### Probar en el celular

Un celular solo instala una PWA desde HTTPS. El profile `tunnel` publica el gateway en una URL HTTPS pública y temporal (cloudflared, sin cuenta):

1. Levanta el stack con la PWA y el túnel:

   ```bash
   WEB_UPSTREAM=web-preview:4173 docker compose --profile pwa --profile tunnel up --build
   ```

2. Copia la URL `https://….trycloudflare.com` de los logs:

   ```bash
   docker compose logs cloudflared | grep trycloudflare.com
   ```

3. Ábrela en el celular e instala la app:
   - **Android (Chrome):** botón **Instalar app**.
   - **iPhone (Safari):** Compartir → **Añadir a pantalla de inicio**. La app muestra esta instrucción.

La URL del túnel cambia cada vez que se reinicia `cloudflared`. Si la cambias, reinstala la app en el celular.

### Limpiar el service worker

Si el navegador sigue mostrando una versión vieja: DevTools → Application → Service workers → **Unregister**, y luego Storage → **Clear site data**.

## Estructura

```text
apps/
  api/        NestJS: monolito modular, hexagonal por módulo (domain / application / infrastructure)
  web/        Vite + React SPA instalable (PWA)
packages/
  contracts/      esquemas zod compartidos entre API y web
  tsconfig/       configuraciones TypeScript base
  eslint-config/  reglas de lint, incluidos los límites entre capas del API
infra/caddy/  gateway local de mismo origen
docs/         arquitectura y roadmap
specs/        un spec por incremento
```

El módulo `apps/api/src/modules/health` es la plantilla de referencia de un módulo hexagonal: el dominio es TypeScript puro, la aplicación define puertos y la infraestructura implementa los adaptadores. `pnpm lint` falla si una capa importa lo que no debe.

## Problemas frecuentes

- **El hot reload no detecta cambios** (Docker Desktop en macOS): añade `CHOKIDAR_USEPOLLING=true` al `.env` y, si es la web, activa `server.watch.usePolling` en `apps/web/vite.config.ts`.
- **El contenedor `api` termina al arrancar**: revisa el mensaje. Nombra la variable de entorno que falta o es inválida.
- **pnpm rechaza una dependencia recién publicada**: pnpm exige que los paquetes tengan al menos 24 h de publicados. Fija la versión anterior.
