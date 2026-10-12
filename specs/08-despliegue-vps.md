# SPEC 08 — Despliegue en VPS con Docker bajo `/omnidesk`

> **Status:** Approved
> **Depends on:** SPEC 07
> **Date:** 2026-10-12
> **Objective:** OmniDesk se despliega manualmente con Docker Compose en un VPS propio, con dos entornos aislados servidos bajo la subruta `/omnidesk` de `dev.gastromesa.com` y `gastromesa.com` a través del Nginx existente, con la web y el API en el mismo origen, migraciones automáticas y backup diario de Postgres, y la PWA se instala en el celular desde esa URL.

## Por qué existe este spec

La arquitectura (§4.3, §14) preveía Railway con `app.<dominio>` y `api.<dominio>`. El equipo decidió otra topología:

- **Servidor:** un VPS propio con Docker Compose.
- **Entornos:** dos, `dev` y `prod`.
- **Rutas:** la app vive en una **subruta** de un dominio que ya sirve otro sitio: `https://dev.gastromesa.com/omnidesk` y `https://gastromesa.com/omnidesk`.
- **Proxy:** un Nginx existente termina TLS y reenvía `/omnidesk/*`, conservando el prefijo.

Servir la web y el API en el **mismo origen** (`<dominio>/omnidesk/api`) simplifica la cookie de sesión de SPEC 07, ya que no hay CORS entre orígenes. También evita el problema de la Public Suffix List con dominios de terceros.

La subruta afecta a todo lo que asumía la raíz `/`: el router, el `scope` del service worker, el manifest, la ruta de la cookie y la de Socket.IO. Por eso local también pasa a `/omnidesk`, para detectar esos fallos antes de desplegar.

## Alcance

**Dentro:**

- **Subruta configurable** `BASE_PATH=/omnidesk`, también en local:
  - **Web:**
    - Vite usa `base: '/omnidesk/'`.
    - React Router, `basename: '/omnidesk'`.
    - Manifest: `start_url` y `scope` en `/omnidesk/`.
    - Workbox: `navigateFallback: '/omnidesk/index.html'` y `navigateFallbackDenylist: [/^\/omnidesk\/api\//]`.
    - Íconos y `logo.svg` relativos a la base.
  - **API:**
    - Sigue sirviendo `/api/v1/*` internamente; el gateway quita el prefijo `/omnidesk`.
    - Conoce `PUBLIC_BASE_PATH=/omnidesk` para la ruta de la cookie (`Path=/omnidesk`), las URL de invitación y redirección (`APP_URL`) y el callback de OAuth.
  - **Socket.IO:** el cliente usa `path: '/omnidesk/api/realtime'`, y el servidor sigue en `/api/realtime`.
  - **Gateway local** (`infra/caddy/Caddyfile`):
    - `/omnidesk/api/*` → `uri strip_prefix /omnidesk` → `api:5001`.
    - `/omnidesk/*` → web (sin quitar el prefijo, porque Vite ya sirve bajo la base).
    - `/` → `301 /omnidesk/`.
- **Imágenes de producción:**
  - `apps/api/Dockerfile`, etapa `prod`:
    - `pnpm deploy --prod` del API.
    - `prisma generate`.
    - Usuario no root.
    - `CMD`: `prisma migrate deploy` y después `node dist/main.js`.
  - `infra/gateway/Dockerfile` (nuevo):
    - Etapa de build: `vite build` con `BASE_PATH` y `VITE_*`.
    - Etapa final: Caddy que sirve `dist` en `/omnidesk/*` con fallback SPA y enruta `/omnidesk/api/*` al API.
    - Cabeceras:
      - `index.html`, `sw.js` y `manifest.webmanifest`: `Cache-Control: no-cache`.
      - `/omnidesk/assets/*`: `public, max-age=31536000, immutable`.
      - `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
      - `Content-Security-Policy` con `default-src 'self'`, `connect-src 'self'` (WebSocket del mismo origen incluido) e `img-src 'self' data: https://lh3.googleusercontent.com` (avatares de Google).
- **Compose de producción** `infra/deploy/docker-compose.prod.yml`:
  - Servicios `postgres`, `api`, `gateway` y `backup`.
  - Solo `gateway` publica un puerto, en `127.0.0.1:${GATEWAY_HOST_PORT}`.
  - Postgres no publica puertos.
  - `restart: unless-stopped` y healthchecks (`pg_isready`, `GET /api/v1/health`).
- **Dos entornos en el mismo VPS** como proyectos Compose aislados:

  | Entorno | Proyecto | `.env` | `GATEWAY_HOST_PORT` | URL pública |
  | --- | --- | --- | --- | --- |
  | dev | `omnidesk-dev` | `/srv/omnidesk/.env.dev` | `8081` | `https://dev.gastromesa.com/omnidesk` |
  | prod | `omnidesk-prod` | `/srv/omnidesk/.env.prod` | `8082` | `https://gastromesa.com/omnidesk` |

  Redes, volúmenes (`pgdata`) y backups separados por proyecto.
- **Plantillas de entorno:** `infra/deploy/.env.dev.example` y `.env.prod.example`, con todas las variables y sin secretos reales. Ambas usan `NODE_ENV=production`, `DEMO_MODE=false` y `SESSION_COOKIE_SECURE=true`.
- **Nginx existente:** fragmento documentado en `infra/deploy/nginx-omnidesk.conf.example`:
  - `location = /omnidesk { return 301 /omnidesk/; }`
  - `location /omnidesk/ { proxy_pass http://127.0.0.1:<puerto>; }`, que conserva el prefijo.
  - Cabeceras `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `Upgrade` y `Connection` para el WebSocket.
  - `proxy_read_timeout 75s`.
- **Proxy de confianza en el API:** `TRUST_PROXY=2` (Nginx + Caddy), para que la IP real, el esquema `https` y la cookie `Secure` funcionen.
- **Backup diario:**
  - El servicio `backup` (imagen `postgres:18`) ejecuta `pg_dump -Fc` a las 03:00, hora del servidor.
  - Guarda en `/srv/omnidesk/backups/<env>/omnidesk-<env>-YYYYMMDD.dump` y conserva los 7 más recientes.
  - Restauración documentada con `pg_restore --clean`.
- **Despliegue manual:**
  - Script `infra/deploy/deploy.sh <dev|prod> <git-ref>`, que se ejecuta **en el VPS**:
    - `git fetch` y `checkout` del ref.
    - `docker compose -p omnidesk-<env> --env-file .env.<env> -f infra/deploy/docker-compose.prod.yml build`.
    - `up -d`.
    - Espera el healthcheck del API.
    - Imprime la versión desplegada.
  - Convención: `dev` se despliega desde `main` y `prod` desde una etiqueta `vX.Y.Z`.
- **Versión visible:** `APP_VERSION` (commit corto o etiqueta) se pasa al build y aparece en `/health` y en la página Estado.
- **Google OAuth** por entorno: el callback es `https://<dominio>/omnidesk/api/v1/auth/google/callback`.
- **Documentación:**
  - `docs/despliegue.md`: preparación del VPS, primer despliegue, actualización, rollback (desplegar el ref anterior) y restauración de un backup.
  - `docs/arquitectura.md` §4.3, §5 y §14: Railway → VPS con subruta.

**Fuera de alcance (para specs futuros):**

- CI/CD (GitHub Actions, registro de imágenes, deploy automático por SSH).
- Railway u otra plataforma gestionada.
- Integración real con n8n y WhatsApp (SPEC 09).
- Monitoreo y alertas (SPEC 11).
- Copias de backup fuera del VPS (S3 u otro).
- Varias instancias del API (requiere el adapter Redis de Socket.IO).
- Despliegue sin caída (blue/green).

## Modelo de datos

Este spec no introduce estructuras de datos de dominio. Cambia la configuración:

**Variables nuevas o cambiadas:**

```
# Comunes (API y build de la web)
BASE_PATH=/omnidesk                 # sin barra final; vacío = raíz (no se usa en ningún entorno)

# API
PUBLIC_BASE_PATH=/omnidesk          # ruta de la cookie y base de las URL públicas
APP_URL=https://dev.gastromesa.com/omnidesk
CORS_ORIGINS=https://dev.gastromesa.com
TRUST_PROXY=2
GOOGLE_CALLBACK_URL=https://dev.gastromesa.com/omnidesk/api/v1/auth/google/callback
APP_VERSION=                        # lo rellena deploy.sh

# Build de la web
VITE_API_URL=                       # vacío = mismo origen: <BASE_PATH>/api

# Compose de producción
GATEWAY_HOST_PORT=8081              # 8082 en prod
BACKUP_DIR=/srv/omnidesk/backups/dev
```

`env.ts` (API) y `env-schema.ts` (web) validan que `BASE_PATH` empiece por `/` y no termine en `/`.

**Rutas resultantes:**

| Pública | Interna (API) |
| --- | --- |
| `/omnidesk/` | — (SPA) |
| `/omnidesk/api/v1/*` | `/api/v1/*` |
| `/omnidesk/api/realtime` | `/api/realtime` |
| `/omnidesk/api/docs` | `/api/docs` (solo si `NODE_ENV≠production`) |

## Plan de implementación

1. **Subruta en el API.**
   - `PUBLIC_BASE_PATH` y `TRUST_PROXY` en `env.ts`.
   - Cookie con `Path=PUBLIC_BASE_PATH`.
   - URL de invitación y redirecciones con `APP_URL`.
   - Pruebas unitarias del armado de URL.
2. **Subruta en la web.**
   - `base`, `basename`, manifest, Workbox y los assets relativos.
   - `http-client.ts` usa `import.meta.env.BASE_URL + 'api'`.
   - Socket.IO con `path` bajo la base.
   - Prueba de `env-schema` con la base.
3. **Gateway local.**
   - `Caddyfile` con `/omnidesk/api/*` (sin el prefijo) y `/omnidesk/*`, más la redirección de `/`.
   - `.env.example`: `BASE_PATH=/omnidesk`, `APP_URL=http://localhost:8080/omnidesk` y `GOOGLE_CALLBACK_URL` ajustada.
   - README con la nueva URL `http://localhost:8080/omnidesk`.
   - El túnel `cloudflared` sigue funcionando.
4. **Imagen de producción del API.** Etapa `prod` en `apps/api/Dockerfile`. Verificación local con `docker build --target prod` y arranque contra el Postgres de compose.
5. **Imagen del gateway.** `infra/gateway/Dockerfile` + `infra/gateway/Caddyfile.prod` con las cabeceras de caché y seguridad. Verificación: `curl -I` de `index.html`, `sw.js` y un asset con hash.
6. **Compose de producción y plantillas.**
   - `docker-compose.prod.yml`.
   - `.env.dev.example` y `.env.prod.example`.
   - Healthchecks.
   - Ensayo en local con `-p omnidesk-dev` en el puerto 8081.
7. **Backup.** Servicio `backup` con `infra/deploy/backup.sh` (dump + rotación de 7). Ensayo forzando una ejecución (`docker compose run --rm backup now`) y restaurando en una base vacía.
8. **Script de despliegue.** `infra/deploy/deploy.sh` con validación de argumentos, espera del healthcheck y salida con código distinto de 0 si falla.
9. **Nginx y documentación.** `nginx-omnidesk.conf.example`, `docs/despliegue.md`, y actualización de `docs/arquitectura.md` (§4.3, §5, §14 y §17: se cierra el pendiente "momento del despliegue").
10. **Primer despliegue en dev** siguiendo `docs/despliegue.md` paso a paso. Lo que falte se corrige en la guía, no a mano en el servidor.
11. **Primer despliegue en prod** con la etiqueta `v0.1.0`.

## Criterios de aceptación

**Local con subruta**

- [ ] `http://localhost:8080/` redirige a `http://localhost:8080/omnidesk/`, y la app funciona igual que antes (login de desarrollo, tiempo real, envío).
- [ ] Recargar en `http://localhost:8080/omnidesk/conversations/<id>` abre esa conversación (fallback SPA).
- [ ] El build de producción (`--profile pwa`) registra un service worker con `scope` `/omnidesk/` y se instala en Chrome de escritorio.

**Imágenes y compose**

- [ ] `docker compose -p omnidesk-dev -f infra/deploy/docker-compose.prod.yml --env-file .env.dev up -d` levanta los 4 servicios sanos, y solo `127.0.0.1:8081` queda publicado (`docker compose ps`).
- [ ] El contenedor `api` de producción corre con un usuario distinto de root (`docker compose exec api id -u` ≠ 0).
- [ ] Arrancar el `api` con una migración pendiente la aplica antes de aceptar peticiones.
- [ ] `curl -I .../omnidesk/sw.js` devuelve `Cache-Control: no-cache`, y un `.../omnidesk/assets/*.js` devuelve `immutable`.
- [ ] `.../omnidesk/api/docs` responde `404` con `NODE_ENV=production`.

**Entornos públicos**

- [ ] `https://dev.gastromesa.com/omnidesk/api/v1/health` responde `{ api: ok, db: ok }` con la versión desplegada.
- [ ] El login con Google funciona en `https://dev.gastromesa.com/omnidesk`. La cookie tiene `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/omnidesk`.
- [ ] El badge muestra "En vivo" (WebSocket por `wss://dev.gastromesa.com/omnidesk/api/realtime` a través de Nginx).
- [ ] En un Android real, Chrome ofrece **Instalar app** en `https://dev.gastromesa.com/omnidesk` y la app se abre en modo standalone.
- [ ] En un iPhone real, "Añadir a pantalla de inicio" instala la app, y el login con Google se completa dentro de la PWA instalada.
- [ ] `https://gastromesa.com/omnidesk` (prod) funciona con su propia base de datos: un usuario creado en dev no existe en prod.
- [ ] El sitio existente en `https://gastromesa.com/` sigue respondiendo igual que antes.

**Operación**

- [ ] Tras 03:00, existe `/srv/omnidesk/backups/dev/omnidesk-dev-<fecha>.dump`, y nunca hay más de 7 archivos por entorno.
- [ ] Restaurar un dump en una base vacía siguiendo `docs/despliegue.md` deja los mismos conteos de `conversations` y `messages`.
- [ ] `infra/deploy/deploy.sh dev main` actualiza dev. `deploy.sh prod v0.1.0` despliega prod y muestra `v0.1.0` en la página Estado.
- [ ] Desplegar un ref anterior (rollback) deja la app funcionando con esa versión.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** VPS propio con Docker Compose. Lo decidió el equipo. Reemplaza a Railway en §4.3 y §14.
- **No:** Railway. Con un VPS y un dominio propios no aporta, y los dominios `*.up.railway.app` rompen la cookie entre `app` y `api` (Public Suffix List).
- **Sí:** subruta `/omnidesk` en `dev.gastromesa.com` y `gastromesa.com`. Lo decidió el equipo; el dominio ya sirve otro sitio en la raíz.
- **Sí:** web y API en el mismo origen (`/omnidesk/api`). Lo decidió el equipo: sin CORS entre orígenes, cookie de un solo origen e iOS standalone sin rarezas de cookies de terceros.
- **Sí:** `BASE_PATH=/omnidesk` también en local. Lo decidió el equipo. Los fallos de rutas, `scope` y cookie aparecen en local y no en el servidor.
- **Sí:** el gateway quita `/omnidesk` antes de llegar al API. El API conserva `/api/v1` y sus e2e no cambian.
- **Sí:** dos proyectos Compose en el mismo VPS (`omnidesk-dev`, `omnidesk-prod`). Lo decidió el equipo; están aislados por red, volumen y `.env`.
- **Sí:** Postgres en contenedor + `pg_dump` diario con 7 copias. Lo decidió el equipo. Las copias fuera del VPS quedan fuera de este spec.
- **Sí:** despliegue manual con `deploy.sh`, construyendo en el VPS. Lo decidió el equipo; no hace falta registro de imágenes ni CI.
- **Sí:** `DEMO_MODE=false` y `NODE_ENV=production` en dev y prod. `DEMO_MODE` está prohibido en producción (SPEC 02), y dev usa Google como prod.
- **Sí:** el Nginx existente termina TLS. Nuestro Caddy de producción escucha en HTTP en `127.0.0.1`. Lo decidió el equipo.
- **Sí:** CSP estricta en el gateway. La app solo habla con su propio origen.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El service worker antiguo (scope `/`) de una instalación local previa intercepta rutas | Cambiar la base implica reinstalar en local. Se documenta en el README. En dev y prod no hay instalaciones previas. |
| Nginx no reenvía el upgrade del WebSocket | El fragmento de ejemplo incluye `Upgrade`/`Connection`. El respaldo de polling de 15 s (SPEC 03) mantiene la app usable. Hay un criterio que lo verifica. |
| Ruta de la cookie mal configurada (sesión perdida al navegar) | `Path=/omnidesk`, derivada de `PUBLIC_BASE_PATH` y validada en `env.ts`, más el criterio con iPhone y Android reales. |
| El build en el VPS consume CPU y RAM del sitio existente | Se construye una imagen a la vez. Si molesta, construir en local y `docker save`/`load` (documentado como alternativa). |
| Backups en el mismo disco que la base | Riesgo aceptado en este spec. Las copias externas se anotan como evolución en `docs/despliegue.md`. |
| `prisma migrate deploy` falla a medias en prod | Backup manual antes de cada despliegue a prod (paso de la guía). Rollback = desplegar el ref anterior + restaurar si la migración no es compatible hacia atrás. |
| OAuth de Google rechaza el callback por una URI no registrada | Las dos URI de callback van en la guía, como paso previo al primer despliegue. |

## Lo que **no** entra en este spec

- CI/CD y registro de imágenes.
- Railway u otras plataformas.
- n8n y WhatsApp reales (SPEC 09).
- Métricas y alertas (SPEC 11).
- Backups fuera del VPS y despliegue sin caída.
- Varias instancias del API.

Cada uno llega en su propio spec.
