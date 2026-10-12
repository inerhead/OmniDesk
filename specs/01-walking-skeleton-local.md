# SPEC 01 — Walking skeleton local: API y PWA instalable desacopladas

> **Status:** Approved
> **Depends on:** —
> **Date:** 2026-10-12
> **Objective:** Con un solo `docker compose up`, una PWA Vite + React instalable, separada del API, muestra el estado de salud que el API NestJS obtiene de PostgreSQL, sobre un monorepo que ya trae contratos compartidos, capas hexagonales, CORS, logs con `x-request-id` y Swagger.

## Por qué existe este spec

`docs/arquitectura.md` (v0.3) define un MVP en 8 incrementos. Este es el incremento 0.

No entrega funcionalidad de negocio. Fija la estructura, los patrones y el entorno local sobre los que se construye todo lo demás. Hay dos propiedades que deben existir desde el primer commit, porque introducirlas después obligaría a rehacer piezas:

1. **Web y API separados.**
   - La PWA es una SPA estática que habla con el API solo por HTTP y con los contratos de `@omnidesk/contracts`.
   - Cada app se construye y despliega por separado.
   - El API no sirve la web y la web no tiene servidor propio.
2. **Instalable en móviles.**
   - Manifest, íconos y service worker con app shell.
   - Una URL HTTPS para probarla en un celular real.

El módulo `health` es deliberadamente trivial: sirve de **plantilla de referencia** de un módulo hexagonal en el API y de un feature en la web.

## Alcance

**Dentro:**

- **Repositorio y monorepo.**
  - git inicializado con `.gitignore`, `.nvmrc` y `.editorconfig`.
  - pnpm + Turborepo con:
    - `apps/api` y `apps/web`.
    - `packages/contracts`, `packages/tsconfig` y `packages/eslint-config`.
  - Tareas raíz: `dev`, `build`, `lint`, `typecheck`, `test` y `format`. Prettier sin hooks de git.
- **`@omnidesk/contracts`.**
  - Esquema zod `HealthResponseSchema` y su tipo.
  - Compilado con tsup (ESM + CJS + `.d.ts`).
- **API NestJS.**
  - Prefijo `api` y versionado URI (`/api/v1/...`).
  - Validación de entorno con zod.
  - Logs JSON con `nestjs-pino` y `x-request-id`.
  - CORS con lista blanca (`CORS_ORIGINS`).
  - Swagger en `/api/docs` vía `nestjs-zod`.
- **Prisma** contra PostgreSQL, con una migración baseline sin modelos de dominio.
- **Módulo `health` hexagonal** (`domain`, `application`, `infrastructure`). Expone `GET /api/v1/health`: `200` si la DB responde, `503` si no.
- **Web Vite + React SPA** (TypeScript, React Router, TanStack Query, Tailwind CSS, shadcn/ui).
  - Página `/` que consulta el health **desde el navegador** y muestra el estado.
  - Validación de `VITE_API_URL` con zod en el build y al arrancar.
- **PWA con `vite-plugin-pwa`.**
  - Manifest y service worker Workbox (`generateSW`) que precarga el app shell y nunca cachea `/api/*`.
  - Aviso "Nueva versión disponible".
  - Botón "Instalar app" en Android y escritorio, e instrucciones para iOS.
  - Banner "Sin conexión".
  - Íconos generados desde `public/logo.svg` con `@vite-pwa/assets-generator`.
- **Reglas ESLint de límites entre capas** en `apps/api` (tabla de `docs/arquitectura.md` §6).
- **Pruebas Vitest** en `contracts`, `api` (unitarias + e2e con supertest) y `web`.
- **Docker Compose.**
  - Servicios siempre activos: `postgres`, `api`, `web` (Vite dev con HMR) y `caddy`, que es el gateway de mismo origen en `http://localhost:8080`.
  - Profile `pwa`: añade `web-preview`, con el build de producción servido por `vite preview`.
  - Profile `tunnel`: añade `cloudflared`, que da una URL HTTPS pública hacia `caddy`.
- `.env.example` y un `README.md` con los comandos, incluida la guía "Probar en el celular".

**Fuera de alcance (para specs futuros):**

- Despliegue en Railway, imágenes de producción y hosting estático de la web (incremento 5).
- CI con GitHub Actions y hooks pre-commit.
- Autenticación, tenants y modelos de dominio (incremento 1).
- Socket.IO, Outbox, Inbox (incrementos 2–3).
- Notificaciones Web Push, caché offline de datos y sincronización en segundo plano (incremento 7 o posteriores).
- Certificados HTTPS locales (mkcert o CA interna de Caddy).
- Contenedores de n8n o Redis.

## Modelo de datos

No hay entidades de dominio. Las estructuras nuevas son técnicas.

**Contrato compartido** (`packages/contracts/src/health.ts`):

```ts
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({ database: z.enum(['up', 'down']) }),
  version: z.string(),   // versión de apps/api/package.json
  timestamp: z.string(), // ISO 8601
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
```

**Dominio y puerto del API** (`apps/api/src/modules/health/`):

```ts
// domain/health-report.ts — TS puro
export type ComponentState = 'up' | 'down';
export interface HealthReport {
  status: 'ok' | 'error';
  checks: { database: ComponentState };
  checkedAt: Date;
}

// application/ports/database-health.port.ts
export interface DatabaseHealthPort { ping(): Promise<boolean>; }
export const DATABASE_HEALTH_PORT = Symbol('DATABASE_HEALTH_PORT');
```

**Modelo de vista de la web** (`apps/web/src/features/health/model/to-status-view.ts`):

```ts
export type StatusView =
  | { kind: 'ok';          label: 'API: ok · DB: ok' }
  | { kind: 'db-down';     label: 'API: ok · DB: down' }
  | { kind: 'api-down';    label: 'API: no disponible' }
  | { kind: 'offline';     label: 'Sin conexión' };
```

**Manifest** (en `vite.config.ts`):

```ts
{
  name: 'OmniDesk', short_name: 'OmniDesk', lang: 'es',
  start_url: '/', scope: '/', display: 'standalone',
  theme_color: '#0f172a', background_color: '#ffffff',
  icons: [/* 192, 512, 512 maskable — generados */],
}
```

**Variables de entorno:**

| Variable | App | Validación | Default |
| --- | --- | --- | --- |
| `NODE_ENV` | api | `development` \| `test` \| `production` | `development` |
| `API_PORT` | api | entero | `5001` |
| `DATABASE_URL` | api | URL obligatoria | — |
| `LOG_LEVEL` | api | `fatal`…`trace` | `info` |
| `CORS_ORIGINS` | api | lista de URLs separadas por coma | `http://localhost:8080,http://localhost:5173` |
| `VITE_API_URL` | web (build) | vacía o URL | vacía = mismo origen (`/api/...`) |
| `WEB_UPSTREAM` | caddy | `host:puerto` | `web:5173` (con PWA: `web-preview:4173`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | — | `omnidesk` / `omnidesk` / `omnidesk` |
| `POSTGRES_HOST_PORT` | compose | entero | `5432` |

**Prisma:**

- `apps/api/prisma/schema.prisma` solo contiene `datasource` y `generator`.
- Migración baseline: `apps/api/prisma/migrations/00000000000000_init/`.

**Puertos locales:**

| Puerto | Servicio | Uso |
| --- | --- | --- |
| `8080` | Caddy | Punto de entrada |
| `5173` | Vite dev | Web en desarrollo |
| `4173` | Vite preview | Build de producción de la web |
| `5001` | API | Directo, para `curl` y Swagger |
| `5432` | Postgres | Base de datos |

**Convenciones:**

- Paquetes con scope `@omnidesk/*`.
- Identificadores de código en inglés; textos de la UI en español.
- API: archivos en kebab-case con sufijo de rol (`*.use-case.ts`, `*.port.ts`, `*.adapter.ts`, `*.controller.ts`).
- Web: `features/<feature>/{api,model,ui}`.

## Plan de implementación

1. **Raíz del monorepo.**
   - `git init`, `.gitignore` (`node_modules`, `dist`, `dev-dist`, `.turbo`, `.env`), `.nvmrc` (`24`), `.editorconfig`.
   - `package.json` raíz con `packageManager` (pnpm fijado) y los scripts `dev`/`build`/`lint`/`typecheck`/`test`/`format`.
   - `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `turbo.json`, `.prettierrc`.
   - Verificación: `pnpm install` y `pnpm turbo run build` terminan sin error.
2. **Configuraciones compartidas.**
   - `packages/tsconfig` con `base.json`, `nestjs.json` y `vite-react.json`.
   - `packages/eslint-config` con una configuración base (flat config), una `react` y una `nest` que incluye las reglas de límites de capas:
     - En `**/domain/**` se prohíben `@nestjs/*`, `@prisma/*`, `**/application/**` y `**/infrastructure/**`.
     - En `**/application/**` se prohíben `**/infrastructure/**` y `@prisma/*`.
3. **`packages/contracts`.**
   - `HealthResponseSchema` e `index.ts`, compilados con tsup (ESM + CJS + d.ts).
   - Script `dev` con `tsup --watch`.
   - Pruebas Vitest: acepta un payload válido y rechaza uno sin `checks`.
4. **Scaffold de `apps/api`.**
   - NestJS con prefijo global `api`, versionado URI (default `1`) y `trust proxy` activo (va detrás de Caddy).
   - `src/shared/config/env.ts`: esquema zod. Si una variable es inválida, el proceso termina con un mensaje que nombra la variable.
   - `nestjs-pino`: toma `x-request-id` o genera un UUID, lo devuelve en la respuesta y lo incluye en cada línea de log.
   - CORS con `origin` restringido a `CORS_ORIGINS`, `credentials: true` y `x-request-id` en `exposedHeaders`.
   - Vitest con `unplugin-swc`.
   - Prueba unitaria del parser de entorno, incluidos `CORS_ORIGINS` inválido y `DATABASE_URL` ausente.
5. **Prisma.**
   - `schema.prisma` sin modelos y migración baseline `00000000000000_init`.
   - `src/shared/infrastructure/prisma/prisma.service.ts`, con conexión al iniciar y cierre al apagar.
   - Scripts `db:migrate` (`prisma migrate dev`) y `db:deploy` (`prisma migrate deploy`).
6. **Módulo `health` (plantilla hexagonal).**
   - `domain/health-report.ts`: tipo y función pura `buildHealthReport(databaseUp, now)`.
   - `application/ports/database-health.port.ts` y `application/check-health.use-case.ts`.
   - `infrastructure/prisma-database-health.adapter.ts`: ejecuta `SELECT 1` con un timeout de 2 s y devuelve `false` si falla o excede el tiempo.
   - `infrastructure/http/health.controller.ts`: mapea `HealthReport` → `HealthResponse`; responde `200` si es `ok` y `503` si es `error`.
   - `health.module.ts` enlaza el puerto con el adaptador.
   - Pruebas unitarias del caso de uso con un puerto falso (arriba y abajo).
7. **e2e y Swagger del API.**
   - `apps/api/test/health.e2e-spec.ts` con supertest:
     - Camino `ok` contra la DB real.
     - Camino `down` sobrescribiendo `DATABASE_HEALTH_PORT`.
     - CORS: un origen permitido recibe `Access-Control-Allow-Origin`; `https://evil.example` no lo recibe.
   - DTO con `createZodDto(HealthResponseSchema)`, Swagger en `/api/docs` y JSON en `/api/docs-json`.
8. **Scaffold de `apps/web` (SPA).**
   - Vite + React + TypeScript, `@tailwindcss/vite`, shadcn/ui (`components.json`, componentes `Card`, `Badge`, `Button`).
   - `src/shared/config/env.ts`: valida `VITE_API_URL` con zod. `vite.config.ts` aplica la misma validación vía `loadEnv`, así que un valor inválido hace fallar el build.
   - `src/shared/api/http-client.ts`: `fetch` contra `${VITE_API_URL}/api/v1/...` con un timeout de 3 s y un `x-request-id` generado por petición.
   - `src/app/router.tsx` (React Router) y `src/app/providers.tsx` (TanStack Query).
   - `vite.config.ts`:
     - `server.host: true`.
     - `preview.allowedHosts` y `server.allowedHosts` con `localhost` y `.trycloudflare.com`.
9. **Feature `health` en la web.**
   - `features/health/api/fetch-health.ts`: valida la respuesta con `HealthResponseSchema`.
   - `features/health/model/to-status-view.ts`: función pura `(resultado, online) → StatusView`.
   - `features/health/ui/health-card.tsx`: renderiza el `StatusView` con un `Badge`.
   - `pages/home-page.tsx` usa `useQuery` con `refetchInterval` de 10 s.
   - Pruebas Vitest de `toStatusView` para los cuatro estados.
10. **PWA.**
    - `vite-plugin-pwa` con:
      - `registerType: 'prompt'` y el manifest del modelo de datos.
      - `workbox.navigateFallback: '/index.html'` y `navigateFallbackDenylist: [/^\/api\//]`.
      - Sin `runtimeCaching` para el API.
      - Service worker desactivado en `vite dev`.
    - `public/logo.svg` y `pwa-assets.config.ts` (preset `minimal-2023`). El script `generate-pwa-assets` crea los íconos 64/192/512, el maskable y el apple-touch.
    - `index.html` incluye `apple-touch-icon`, `theme-color`, `apple-mobile-web-app-status-bar-style` y `viewport-fit=cover`.
    - En `src/shared/pwa/`:
      - `update-prompt.tsx`: aviso "Nueva versión disponible" con botón "Actualizar".
      - `install-prompt.tsx`: botón "Instalar app" con `beforeinstallprompt`. En iOS Safari no instalado, muestra "Compartir → Añadir a pantalla de inicio". Se oculta si la app ya corre en `display-mode: standalone`.
      - `offline-banner.tsx`: banner "Sin conexión" según `navigator.onLine` y sus eventos.
11. **Docker Compose y gateway.**
    - `apps/api/Dockerfile` y `apps/web/Dockerfile` con etapa `dev`:
      - Base `node:24-bookworm-slim`, corepack con pnpm.
      - Contexto en la raíz; `pnpm install --frozen-lockfile` dentro de la imagen.
    - `infra/caddy/Caddyfile`: escucha en `:80`. `handle /api/*` → `api:5001`; el resto → `{$WEB_UPSTREAM:web:5173}`.
    - `docker-compose.yml`:
      - `postgres` (`postgres:18`): volumen en `/var/lib/postgresql` y healthcheck con `pg_isready`.
      - `api`: ejecuta `db:deploy` y luego `turbo run dev --filter=@omnidesk/api...`. Puerto `5001`.
      - `web`: ejecuta `turbo run dev --filter=@omnidesk/web...`. Puerto `5173`.
      - `caddy` (`caddy:2`): puerto `8080:80`.
      - `web-preview` (profile `pwa`): misma imagen que `web`; ejecuta build + `vite preview --port 4173`.
      - `cloudflared` (profile `tunnel`): `tunnel --no-autoupdate --url http://caddy:80`.
      - Bind mounts solo del código fuente: `apps/api/src`, `apps/api/prisma`, `apps/api/test`, `apps/web/src`, `apps/web/public`, `packages/contracts/src`.
    - `.env.example` con todas las variables.
12. **Documentación de arranque.**
    - `README.md` con requisitos, comandos y un enlace a `docs/arquitectura.md` y `specs/`.
    - Sección "Probar en el celular":
      1. `WEB_UPSTREAM=web-preview:4173 docker compose --profile pwa --profile tunnel up`.
      2. Copiar la URL `https://*.trycloudflare.com` de `docker compose logs cloudflared`.
      3. Abrirla en el celular e instalar (Android: "Instalar app"; iPhone: Compartir → "Añadir a pantalla de inicio").

## Criterios de aceptación

**Repositorio y API**

- [ ] `git status` funciona en la raíz, y `node_modules`, `.env`, `dist`, `dev-dist` y `.turbo` están ignorados.
- [ ] Con un clon limpio, `cp .env.example .env && docker compose up --build` levanta `postgres`, `api`, `web` y `caddy`, y los cuatro quedan en estado `running` sin reinicios.
- [ ] `curl -i http://localhost:5001/api/v1/health` responde `200` con `status: "ok"` y `checks.database: "up"`, y el cuerpo pasa `HealthResponseSchema.parse`.
- [ ] `curl -i http://localhost:8080/api/v1/health` (a través de Caddy) responde lo mismo.
- [ ] Con `docker compose stop postgres`, el health responde `503` con `checks.database: "down"` en menos de 3 s.
- [ ] `curl -I -H "Origin: http://localhost:5173" http://localhost:5001/api/v1/health` incluye `Access-Control-Allow-Origin: http://localhost:5173`.
- [ ] Con `Origin: https://evil.example`, la respuesta no incluye `Access-Control-Allow-Origin`.
- [ ] `http://localhost:5001/api/docs` muestra Swagger con `GET /api/v1/health` y los campos `status`, `checks`, `version` y `timestamp`.
- [ ] `curl -H "x-request-id: abc-123" .../api/v1/health` devuelve el header `x-request-id: abc-123`, y la línea de log JSON de esa petición contiene `abc-123`.
- [ ] Si se elimina `DATABASE_URL` del `.env`, el contenedor `api` termina con un mensaje que contiene `DATABASE_URL`.
- [ ] La tabla `_prisma_migrations` contiene exactamente la migración `00000000000000_init` aplicada.

**Separación web / API**

- [ ] `pnpm --filter @omnidesk/web build` genera `apps/web/dist/` con `index.html`, `manifest.webmanifest`, `sw.js` y los íconos, sin requerir el API ni la DB.
- [ ] `apps/web` no tiene dependencias de `apps/api`. Su único vínculo con el API es `@omnidesk/contracts` más la URL base.
- [ ] `apps/api` no sirve archivos de la web.
- [ ] Construir la web con `VITE_API_URL=no-es-url` hace fallar el build con un mensaje que contiene `VITE_API_URL`.
- [ ] En DevTools → Network, la llamada a `/api/v1/health` la hace el navegador y lleva un header `x-request-id`.

**Web**

- [ ] `http://localhost:8080` muestra:
  - "API: ok · DB: ok" con todo arriba.
  - "API: ok · DB: down" con Postgres detenido (se actualiza en ≤ 10 s sin recargar).
  - "API: no disponible" con el API detenido, sin pantalla en blanco.
- [ ] Editar `apps/web/src/pages/home-page.tsx` se refleja en el navegador vía HMR sin reconstruir la imagen.
- [ ] Editar un archivo en `apps/api/src` reinicia el API sin reconstruir la imagen.

**PWA** (con `WEB_UPSTREAM=web-preview:4173 docker compose --profile pwa up`)

- [ ] En Chrome de escritorio, `http://localhost:8080` → DevTools → Application → Manifest no muestra errores de instalabilidad, y el botón "Instalar app" instala la app y la abre en ventana propia sin barra de direcciones.
- [ ] Con la app instalada y DevTools en modo "Offline", recargar muestra el app shell con el banner "Sin conexión" y no la página de error del navegador.
- [ ] En DevTools → Application → Cache Storage no hay entradas bajo `/api/`.
- [ ] Tras cambiar un texto y reconstruir `web-preview`, la app abierta muestra "Nueva versión disponible", y al pulsar "Actualizar" carga la versión nueva.
- [ ] Con el profile `tunnel` activo, la URL `https://*.trycloudflare.com` cargada en un Android con Chrome permite "Instalar app". La app instalada abre en `standalone` y muestra "API: ok · DB: ok".
- [ ] La misma URL en un iPhone con Safari muestra las instrucciones de "Añadir a pantalla de inicio". Tras añadirla, abre a pantalla completa con el ícono de OmniDesk y muestra "API: ok · DB: ok".

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0 desde la raíz.
- [ ] El e2e del API pasa con Postgres de Compose arriba.
- [ ] Añadir `import { Injectable } from '@nestjs/common'` en `apps/api/src/modules/health/domain/health-report.ts` hace fallar `pnpm lint`.
- [ ] Importar `../infrastructure/...` desde `application/` también hace fallar `pnpm lint`.
- [ ] Las pruebas de `toStatusView` cubren los cuatro estados y pasan.

## Decisiones

- **Sí:** el incremento 0 va separado de identidad y tenancy. Specs pequeños y verificables.
- **Sí:** web y API como aplicaciones independientes dentro del mismo monorepo. Comparten contratos tipados sin publicar paquetes, y cada una se despliega por su cuenta.
- **No:** dos repositorios. Obligaría a versionar y publicar `@omnidesk/contracts` desde el día uno, con fricción y sin beneficio a esta escala.
- **Sí:** Vite + React SPA. Es un panel tras login: no necesita SSR ni SEO. Una SPA estática es la base más directa de una PWA y se sirve desde cualquier CDN.
- **No:** Next.js con `output: 'export'`. Las rutas dinámicas (`/conversations/[id]`) chocan con la exportación estática.
- **No:** Next.js con servidor. Añade un servidor Node que no aporta valor a un panel autenticado y acopla el despliegue de la web a un runtime.
- **Sí:** la web consulta el API desde el navegador. Es la topología real de producción y obliga a resolver CORS y `x-request-id` desde ahora.
- **Sí:** `vite-plugin-pwa` con `generateSW` y `registerType: 'prompt'`. Workbox está probado. El aviso de actualización evita recargar mientras un agente escribe.
- **No:** `autoUpdate`. Recargaría la app en medio de una respuesta del agente.
- **Sí:** el service worker no cachea nada de `/api/*`. Los datos de conversaciones deben ser siempre frescos; la caché offline de datos llega, si llega, en otro spec.
- **Sí:** service worker desactivado en `vite dev`. Evita servir código viejo durante el desarrollo; la PWA se verifica con el build (`web-preview`).
- **Sí:** íconos generados desde un único `logo.svg`. Una sola fuente de verdad para todos los tamaños, incluidos el maskable y el apple-touch.
- **Sí:** Caddy como gateway local de mismo origen. Una sola URL para escritorio y túnel, igual que un reverse proxy de producción.
- **Sí:** el gateway local sirve HTTP en `localhost:8080`, sin certificados locales. `localhost` ya es un contexto seguro para instalar la PWA en escritorio, y el HTTPS que exige el celular lo da el túnel. Se evita instalar una CA local en cada máquina.
- **No:** mkcert ni la CA interna de Caddy. Generan advertencias o pasos manuales en cada equipo y no resuelven el caso del celular.
- **Sí:** cloudflared en modo quick tunnel (profile `tunnel`). No requiere cuenta y da HTTPS público para probar en iOS y Android.
- **Sí:** el API mantiene CORS con lista blanca aunque en local se use mismo origen. En producción, web y API pueden vivir en `app.*` y `api.*`.
- **Sí:** TanStack Query para el estado del servidor en la web. Es el patrón que usarán las bandejas y el historial (reintentos, invalidación con eventos en tiempo real).
- **Sí:** pnpm + Turborepo, todo en Docker, dependencias dentro de la imagen y solo el código fuente montado.
- **Sí:** contracts compilado con tsup (dual ESM/CJS). Nest (CJS) no consume TypeScript sin compilar.
- **Sí:** solo git, sin CI ni Husky. Lo decidió el equipo.
- **Sí:** Vitest en todo, con `unplugin-swc` en el API.
- **Sí:** en `application/` se permite `@nestjs/common`, solo para DI. El puerto se inyecta con un token `Symbol`.
- **Sí:** el health devuelve `503` cuando la DB cae.
- **Sí:** migración baseline vacía. **No:** un `Tenant` mínimo ahora.
- **Sí:** Node 24 LTS y `postgres:18`.
- **Sí:** los Dockerfiles solo tienen etapa `dev`. Las imágenes de producción y el hosting estático de la web van con el spec de despliegue.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| iOS no muestra un prompt de instalación (`beforeinstallprompt` no existe en Safari) | La app detecta iOS sin modo `standalone` y muestra instrucciones manuales. Es un criterio de aceptación explícito. |
| La URL de cloudflared cambia en cada arranque, y la PWA instalada en el celular apunta a la URL anterior | Aceptado para pruebas locales: reinstalar tras reiniciar el túnel. Queda documentado en el README. La URL estable llega con el despliegue. |
| Vite bloquea hosts desconocidos (`allowedHosts`) al entrar por el túnel | Configurar `server.allowedHosts` y `preview.allowedHosts` con `.trycloudflare.com` (paso 8). |
| El HMR de Vite no conecta a través de Caddy | Caddy proxifica WebSocket de forma nativa. Si falla, fijar `server.hmr.clientPort: 8080`. |
| El service worker sirve una versión vieja durante pruebas | `registerType: 'prompt'` con botón "Actualizar"; en dev el SW está desactivado. El README explica cómo limpiar el SW desde DevTools. |
| El hot reload no detecta cambios en bind mounts de Docker Desktop en macOS | Activar polling con `CHOKIDAR_USEPOLLING=true` en `api` y `server.watch.usePolling` en Vite si se detecta el problema. |
| `nestjs-zod` incompatible con la versión de zod instalada | Fijar versiones compatibles. Alternativa: `@asteasolutions/zod-to-openapi`. |
| Prisma no genera una migración vacía sin modelos | Crear `migration.sql` a mano con un comentario SQL. |
| `postgres:18` usa otra ruta de datos | Montar el volumen en `/var/lib/postgresql`. |
| Puertos 8080, 5432, 5173 o 5001 ocupados | `POSTGRES_HOST_PORT` configurable. Los demás se documentan en el README. |

## Lo que **no** entra en este spec

- Despliegue en Railway, imágenes de producción y hosting estático de la web.
- CI (GitHub Actions) y hooks de git.
- Login, tenants, roles y cualquier entidad de dominio.
- Tiempo real (Socket.IO), Outbox, Inbox e integración con n8n.
- Notificaciones Web Push, caché offline de datos y sincronización en segundo plano.
- Certificados HTTPS locales.

Cada uno de estos llega en su propio spec, según el roadmap de `docs/arquitectura.md` §14.
