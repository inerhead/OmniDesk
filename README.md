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

Abre <http://localhost:8080/omnidesk> (el gateway; usa siempre esta URL). La app vive bajo la subruta `/omnidesk`, igual que en el VPS; `http://localhost:8080/` redirige ahí. La página muestra el estado del sistema:

| Mensaje              | Significado                    |
| -------------------- | ------------------------------ |
| `API: ok · DB: ok`   | Todo operativo                 |
| `API: ok · DB: down` | El API responde, PostgreSQL no |
| `API: no disponible` | El API no responde             |
| `Sin conexión`       | El dispositivo no tiene red    |

## Servicios y puertos

| Servicio      | URL en el host                        | Qué es                                                                                 |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `caddy`       | <http://localhost:8080/omnidesk>      | Gateway de mismo origen: `/omnidesk/api/*` → API (sin el prefijo), `/omnidesk/*` → web |
| `web`         | <http://localhost:5173/omnidesk/>     | Vite dev sin proxy: ahí `/api` no llega al API. Usa 8080                               |
| `api`         | <http://localhost:5001/api/v1/health> | API NestJS                                                                             |
| Swagger       | <http://localhost:5001/api/docs>      | Documentación del API generada desde `@omnidesk/contracts`                             |
| `postgres`    | `localhost:5532`                      | PostgreSQL 18                                                                          |
| `web-preview` | <http://localhost:4173/omnidesk/>     | Build de producción de la web (profile `pwa`)                                          |
| `cloudflared` | URL `https://*.trycloudflare.com`     | Túnel HTTPS hacia `caddy` (profile `tunnel`)                                           |

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

## Datos de ejemplo

Con `DEMO_MODE=true` (el valor de `.env.example`), el API crea al arrancar un tenant demo, el canal **WhatsApp Demo** y su credencial (`DEMO_CHANNEL_API_KEY`). Además, cada miembro demo tiene un usuario para el **login de desarrollo** (ver [Iniciar sesión](#iniciar-sesión)). `DEMO_MODE=true` está prohibido con `NODE_ENV=production`.

El simulador envía conversaciones por los mismos endpoints de integración que usará n8n:

```bash
pnpm simulate          # crea 5 conversaciones de ejemplo; repetirlo no duplica nada
pnpm simulate --live   # un mensaje nuevo cada 4 s (cliente + IA) hasta Ctrl+C
```

El simulador corre en el host (Node 24 + pnpm) y llama a `http://localhost:${GATEWAY_HOST_PORT}/omnidesk`. Para otra URL, define `SIMULATOR_API_URL` (con la subruta).

## Iniciar sesión

La web exige sesión (SPEC 07). Sin ella, cualquier ruta redirige a `/login?next=<ruta>`. La sesión es una cookie `omnidesk_session` (`HttpOnly`, `SameSite=Lax`; `Secure` con `SESSION_COOKIE_SECURE=true`) con un token opaco. En Postgres (`sessions`) solo se guarda su sha256. La sesión dura 30 días desde el último uso y Socket.IO usa la misma cookie.

### Login de desarrollo

Con `DEMO_MODE=true`, `/login` muestra **Entrar como Sup. Demo / Laura / Mateo**. Crea una sesión real para ese miembro demo, sin Google (`POST /api/v1/auth/dev-login`). Sustituye al antiguo selector **Actuar como** y a la cabecera `X-Demo-Member-Id`, que ya no existen. Sin `DEMO_MODE`, el endpoint responde `404`.

### Login con Google (local)

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crea un proyecto y configura la **pantalla de consentimiento** (tipo _Externo_, en modo _Testing_, y añade tu cuenta como usuario de prueba).
2. Crea una credencial **ID de cliente de OAuth → Aplicación web** con:
   - **Orígenes autorizados de JavaScript:** `http://localhost:8080`
   - **URI de redirección autorizados:** `http://localhost:8080/omnidesk/api/v1/auth/google/callback`

   (Si usas otro `GATEWAY_HOST_PORT`, cambia el puerto en las dos.)

3. En `.env`:

   ```bash
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_CALLBACK_URL=http://localhost:8080/omnidesk/api/v1/auth/google/callback
   APP_URL=http://localhost:8080/omnidesk
   ```

4. `docker compose up -d api` recrea el API. `/login` muestra **Entrar con Google**.

El primer login sin empresas lleva a `/onboarding` (**Crea tu empresa**): quien la crea queda como OWNER. `next` solo acepta rutas internas; `next=https://evil.com` se ignora. En producción `GOOGLE_CLIENT_ID` y `SESSION_COOKIE_SECURE=true` son obligatorias.

### Empresas, invitaciones y miembros

- **Cambiar de empresa:** menú de usuario → **Empresa**. La bandeja se vacía y vuelve a cargar con la empresa nueva, y el socket se une a su room.
- **Invitar:** menú de usuario → **Miembros** (OWNER y ADMIN) → **Invitar**. El diálogo genera un enlace `/invite/<token>` para **Copiar** y compartir. No se envía ningún email. El enlace:
  - vale 7 días;
  - sirve una sola vez;
  - solo lo acepta quien entra con ese email de Google.

  Un OWNER invita ADMIN y AGENT; un ADMIN, solo AGENT.

- **Roles y bajas:** en **Miembros**, el OWNER cambia roles. OWNER y ADMIN quitan miembros: un ADMIN, solo agentes. Siempre queda al menos un OWNER (`409 LAST_OWNER`). Quitar a alguien hace tres cosas:
  - cierra su sesión en esa empresa;
  - devuelve sus conversaciones abiertas a la IA;
  - conserva su nombre en el historial.

### Ver el tiempo real

Con la bandeja abierta en <http://localhost:8080/omnidesk/conversations>, lanza `pnpm simulate --live`: cada mensaje nuevo aparece en la lista y en el chat abierto en ≤ 1 s, sin recargar. El punto de conexión (abajo en el rail; en móvil, en la barra inferior) está verde, con el tooltip **En vivo**, mientras el socket (`/omnidesk/api/realtime`) está conectado. Si estás leyendo más arriba en el historial, el chat no salta: aparece **1 mensaje nuevo** y, al pulsarlo, baja al final.

Para ver el respaldo, detén el API con `docker compose stop api`: el punto pasa a ámbar (**Reconectando…**) y la lista se refresca como máximo cada 15 s. Al levantarlo de nuevo, vuelve a verde (**En vivo**) y aparecen los mensajes que llegaron mientras tanto.

### Asignar una conversación y suspender la IA

Los miembros demo son **Sup. Demo** (OWNER, ve las 4 bandejas), **Laura** y **Mateo** (agentes, sin la pestaña "Todas"). Para cambiar de persona, cierra sesión desde el menú de usuario y entra con otro botón de "Entrar como…", o usa otra ventana privada.

1. Entra como Sup. Demo y lanza `pnpm simulate --live`.
2. Abre una conversación de la pestaña **IA** y elige **Asignar a… → Laura**.
3. La conversación sale de "IA" y aparece en **Mías** de Laura (entra como Laura en una ventana privada). El historial muestra "Sup. Demo asignó la conversación a Laura".
4. Los siguientes mensajes del cliente en esa conversación ya no reciben respuesta de la IA: el simulador respeta `aiAllowed` y, si una respuesta ya iba en camino, el API la rechaza con `409 CONTROL_CHANGED`.
5. Laura puede **Liberar a IA**, **Cerrar** o **Reabrir**. Si el cliente escribe en una conversación cerrada, se reabre sola y vuelve a la IA.

Si dos pestañas pulsan **Tomar** casi a la vez, una gana y la otra muestra "La conversación cambió. Se actualizó con el estado actual".

### Responder desde la PWA y ver los ticks

Solo escribe el **agente asignado** (un supervisor primero se asigna la conversación).

1. Como Sup. Demo, lanza `pnpm simulate` y abre una conversación de la pestaña **IA**: en lugar del composer verás **Tomar conversación para responder**. Las respuestas de IA del simulador ya muestran ✓✓ (entregado).
2. Entra como **Laura** (en una ventana privada), abre una conversación de la pestaña **IA** y pulsa **Tomar conversación para responder**. Aparece el composer.
3. Escribe y pulsa Enter (Shift+Enter inserta un salto de línea). La burbuja nace con el reloj, pasa a ✓ (enviado), ✓✓ a los ≈ 1,5 s (entregado) y ✓✓ azul a los ≈ 4 s (leído), sin recargar. En la ventana de Sup. Demo (pestaña **Todas**) se ven el mensaje y sus ticks.
4. Si la conversación está asignada a Mateo, Sup. Demo ve "Asignada a Mateo" y no el composer.

El proveedor es simulado (`MESSAGING_PROVIDER=simulated`). Para probar el reintento, falla a propósito todos los envíos:

```bash
# en .env
SIMULATED_PROVIDER_FAILURE_RATE=1     # número entre 0 y 1; por defecto 0
docker compose up -d api              # recrea el API con la nueva variable
```

Al enviar un mensaje, el API reintenta con esperas de 1, 2, 4, 8 y 16 s (≈ 31 s) y lo deja en rojo con **No enviado · Reintentar**. Vuelve a poner `SIMULATED_PROVIDER_FAILURE_RATE=0`, recrea el API y pulsa **Reintentar**: el mensaje pasa a ✓.

Las pruebas e2e del API usan una base aparte (`<base>_e2e`), así que no tocan estos datos.

### Interfaz: layout, tema y búsqueda

- **Layout.** En escritorio (≥ 768 px) hay un rail a la izquierda con **Conversaciones** y **Estado** y, abajo, el punto de conexión, **Instalar app** y el menú de usuario (empresa, tema, miembros y cerrar sesión). Luego van la lista y el chat. En ≥ 1280 px se suma el **panel de contacto** como tercera columna; se pliega con el botón de la cabecera del chat y el navegador recuerda si estaba abierto (`omnidesk:contact-panel`). Por debajo de 1280 px, el mismo botón lo abre como hoja lateral (se cierra con Esc o tocando fuera). En móvil, el rail pasa a una barra inferior que se oculta al abrir un chat.
- **Tema.** El menú de usuario (y la esquina de las pantallas de login) ofrece **Claro**, **Oscuro** y **Sistema** (el valor por defecto). La elección se guarda por dispositivo en `localStorage` (`omnidesk:theme`) y un script inline de `index.html` la aplica antes del primer render, sin parpadeo. Con **Sistema**, el tema sigue al sistema operativo sin recargar.
- **Búsqueda.** El buscador de la lista filtra por nombre del contacto o por teléfono dentro de la bandeja activa. Se aplica en el servidor (`GET /api/v1/conversations?q=`) tras 300 ms sin teclear, y el término queda en la URL (`/conversations?inbox=all&q=juan`). Si el término tiene 3 dígitos o más, también busca en el teléfono, ignorando espacios, `+`, `-` y paréntesis: `300 123` encuentra `+573001234567`.
- **Chat.** El historial se separa por días (**Hoy**, **Ayer**, "lunes, 5 de octubre"). Los mensajes seguidos del mismo emisor con menos de 5 min entre sí comparten un solo encabezado. Los colores identifican al emisor: cliente en gris a la izquierda, IA en índigo claro con icono de bot y agente en el color de marca.
- **Tipografía.** Inter va empaquetada con la app (`@fontsource-variable/inter`) y el service worker la precachea: no hay peticiones a dominios externos y funciona sin conexión.

## Probar la PWA

El service worker está desactivado en `vite dev`. Para probar la instalación se usa el build de producción:

```bash
WEB_UPSTREAM=web-preview:4173 docker compose --profile pwa up --build
```

En Chrome de escritorio, abre <http://localhost:8080/omnidesk> y pulsa **Instalar app**: la app se abre en su propia ventana. `localhost` ya es un contexto seguro, así que no hacen falta certificados.

### Probar en el celular

Un celular solo instala una PWA desde HTTPS. El profile `tunnel` publica el gateway en una URL HTTPS pública y temporal (cloudflared, sin cuenta):

1. Levanta el stack con la PWA y el túnel:

   ```bash
   WEB_UPSTREAM=web-preview:4173 docker compose --profile pwa --profile tunnel up --build
   ```

2. Copia la URL `https://….trycloudflare.com` de los logs (la app está en `<URL>/omnidesk`):

   ```bash
   docker compose logs cloudflared | grep trycloudflare.com
   ```

3. Ábrela en el celular e instala la app:
   - **Android (Chrome):** botón **Instalar app**.
   - **iPhone (Safari):** Compartir → **Añadir a pantalla de inicio**. La app muestra esta instrucción.

La URL del túnel cambia cada vez que se reinicia `cloudflared`. Si la cambias, reinstala la app en el celular.

### Limpiar el service worker

Si el navegador sigue mostrando una versión vieja: DevTools → Application → Service workers → **Unregister**, y luego Storage → **Clear site data**.

**Si instalaste la PWA antes de la subruta** (scope `/`), su service worker puede seguir interceptando `http://localhost:8080/`. Desinstala la app, quita ese service worker como arriba y vuelve a instalar desde `http://localhost:8080/omnidesk`.

## Despliegue

dev y prod corren en un VPS con Docker Compose, en <https://dev.gastromesa.com/omnidesk> y <https://gastromesa.com/omnidesk>. Para desplegar se ejecuta `infra/deploy/deploy.sh <dev|prod> <git-ref>` en el VPS. La guía completa, con la preparación, el primer despliegue, el rollback y los backups, está en [`docs/despliegue.md`](docs/despliegue.md).

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
