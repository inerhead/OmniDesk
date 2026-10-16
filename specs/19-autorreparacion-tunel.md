# SPEC 19 — Autorreparación del túnel y de los servicios de prod

> **Status:** Implemented
> **Depends on:** SPEC 08, SPEC 11
> **Date:** 2026-10-15
> **Objective:** Un contenedor `autoheal` reinicia solo, en menos de 2 minutos, el túnel `cloudflared` (en prod y en local), el gateway y el API (en prod) cuando su healthcheck falla, y el API pasa a un healthcheck de liveness que no depende de la base.

## Por qué existe este spec

El 2026-10-16, de 01:12 a 02:18 UTC, `https://channel.gastromesa.com/omnidesk/` respondió con el error 1033 de Cloudflare. El túnel `omnidesk-prod-cloudflared` perdió sus cuatro conexiones al suspenderse el Mac que aloja prod, y no volvió a conectar. El contenedor seguía como "Up": Docker no tenía forma de saber que no servía.

Hoy:

- `cloudflared` no tiene healthcheck y usa la imagen `cloudflare/cloudflared:latest`.
- Docker por sí solo no reinicia un contenedor `unhealthy`: `restart: unless-stopped` solo actúa si el proceso termina.
- El healthcheck del API llama a `/api/v1/health`, que responde `503` con Postgres caído. Reiniciar el API no arregla la base.

Este spec es la "capa 2" de las tres que salieron del incidente:

1. Que el Mac no se suspenda (`pmset`, ajuste manual del host).
2. **Que los servicios se reparen solos: este spec.**
3. Que alguien se entere cuando algo cae (monitor externo, otro spec).

## Alcance

**Dentro:**

- **Healthcheck de `cloudflared`** en `infra/deploy/docker-compose.prod.yml` y en `docker-compose.yml`:
  - `command` añade `--metrics 127.0.0.1:20241` antes de `run`. El puerto queda dentro de la red compartida (`service:gateway` en prod, `service:caddy` en local) y no se publica.
  - `healthcheck.test`: `['CMD', 'cloudflared', 'tunnel', '--metrics', '127.0.0.1:20241', 'ready']`. Sale con error si el túnel no tiene ninguna conexión activa con Cloudflare.
  - `interval: 30s`, `timeout: 5s`, `retries: 3`, `start_period: 60s`.
- **Versión fija de `cloudflared`:** `cloudflare/cloudflared:2026.8.3` (la que corre hoy) en los dos compose, en lugar de `:latest`.
- **Liveness del API:**
  - Nuevo `GET /api/v1/health/live`. Responde `200 { "status": "ok" }` si el proceso atiende peticiones, sin consultar Postgres, MinIO ni el Outbox.
  - Va sin sesión, igual que `/api/v1/health`.
  - `/api/v1/health` no cambia: sigue respondiendo `503` sin base, y es el que deben usar los monitores externos.
  - El healthcheck del contenedor `api` en `docker-compose.prod.yml` pasa a llamar a `/api/v1/health/live`, con los mismos tiempos de hoy (`interval: 10s`, `timeout: 5s`, `retries: 5`, `start_period: 60s`).
- **Contenedor `autoheal`** (`willfarrell/autoheal:1.2.0`):
  - En `docker-compose.prod.yml` (prod y el entorno dev del VPS) y en `docker-compose.yml` (local).
  - Monta `/var/run/docker.sock:/var/run/docker.sock:ro`.
  - Variables: `AUTOHEAL_CONTAINER_LABEL=autoheal`, `AUTOHEAL_INTERVAL=10` y `AUTOHEAL_START_PERIOD=0`.
  - `restart: unless-stopped`.
  - Solo reinicia los contenedores con la etiqueta `autoheal: 'true'`. Los demás no los toca.
- **Etiqueta `autoheal: 'true'`:**
  - **Prod:** en `cloudflared`, `gateway` y `api`.
  - **Local:** solo en `cloudflared`. En local, `api` y `caddy` siguen sin healthcheck: el API corre en modo watch y un healthcheck lo reiniciaría mientras compila.
- **Documentación** en `docs/despliegue.md`:
  - Una sección "Autorreparación (SPEC 19)": qué se reinicia, en cuánto tiempo, cómo ver los reinicios (`docker logs <proyecto>-autoheal`) y cómo comprobar el túnel (`docker inspect --format '{{.State.Health.Status}}' <proyecto>-cloudflared`).
  - La nota de la capa 1: en un Mac, `sudo pmset -c sleep 0 disksleep 0` y dejarlo con el cargador.
  - Una fila nueva en "Problemas frecuentes" para el error 1033.

**Fuera:**

- Avisos cuando algo cae o se reinicia (webhook de autoheal, UptimeRobot, health checks de Cloudflare): capa 3, otro spec.
- Cambiar los ajustes de energía del Mac. Es un paso manual, que solo se documenta.
- Autoheal para `postgres`, `minio` o `backup`.
- Healthchecks para `api` y `caddy` en el compose local.
- Un segundo conector `cloudflared` de respaldo.
- Mover prod al VPS.
- Límite de reinicios o backoff: autoheal no lo tiene, y se acepta (ver Riesgos).

## Modelo de datos

Este spec no introduce estructuras de datos ni migraciones. Solo añade un contrato y configuración de Compose.

**Contrato (`packages/contracts/src/health.ts`):**

```ts
/** `GET /api/v1/health/live` (SPEC 19): el proceso responde; no mira la base. */
export const HealthLiveResponseSchema = z.object({ status: z.literal('ok') });
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;
```

**Compose (prod), en forma:**

```yaml
cloudflared:
  image: cloudflare/cloudflared:2026.8.3
  labels:
    autoheal: 'true'
  command: tunnel --protocol … --no-autoupdate --metrics 127.0.0.1:20241 run --token …
  healthcheck:
    test: ['CMD', 'cloudflared', 'tunnel', '--metrics', '127.0.0.1:20241', 'ready']
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 60s

autoheal:
  container_name: ${COMPOSE_PROJECT_NAME}-autoheal
  image: willfarrell/autoheal:1.2.0
  restart: unless-stopped
  environment:
    AUTOHEAL_CONTAINER_LABEL: autoheal
    AUTOHEAL_INTERVAL: 10
    AUTOHEAL_START_PERIOD: 0
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

- **Tiempo hasta el reinicio del túnel:** 3 fallos × 30 s, más hasta 10 s de autoheal: unos 100 s.
- **Tiempo hasta el reinicio del API:** 5 fallos × 10 s, más hasta 10 s de autoheal: unos 60 s.
- **Tiempo hasta el reinicio del gateway:** 3 fallos × 30 s, más hasta 10 s de autoheal: unos 100 s.
- En local, el contenedor se llama `omnidesk-autoheal`, como el resto de nombres fijos de `docker-compose.yml`.

## Plan de implementación

1. **Liveness del API.** `HealthLiveResponseSchema` en contratos. `GET /api/v1/health/live` en `health.controller.ts`, sin dependencias de la base. Prueba unitaria: responde `200` aunque el caso de uso de salud falle. E2E: `200 { status: 'ok' }`.
2. **Healthcheck del API en prod.** El healthcheck de `api` en `docker-compose.prod.yml` llama a `/api/v1/health/live`. Comprobación: `docker compose -f infra/deploy/docker-compose.prod.yml config` es válido.
3. **Túnel en local.** En `docker-compose.yml`: imagen `2026.8.3`, `--metrics`, healthcheck y etiqueta en `cloudflared`. Comprobación: `docker compose up -d cloudflared` y, en menos de 90 s, `docker inspect` dice `healthy`.
4. **Autoheal en local.** Servicio `autoheal` en `docker-compose.yml`. Comprobación: el contenedor arranca y su log muestra que vigila la etiqueta `autoheal`.
5. **Simulación en local.**
   1. `docker network disconnect <red> omnidesk-caddy`. `cloudflared` pierde la red porque comparte la de caddy.
   2. En menos de 2 min, `cloudflared` pasa a `unhealthy` y autoheal lo reinicia: se ve en `docker logs omnidesk-autoheal`.
   3. `docker network connect <red> omnidesk-caddy`.
   4. En menos de 2 min, `cloudflared` queda `healthy` y `https://dev-channel.gastromesa.com/omnidesk/api/v1/health` responde `200`.
   5. El resultado se anota en la verificación de este spec.
6. **Prod.** En `docker-compose.prod.yml`: imagen `2026.8.3`, `--metrics`, healthcheck y etiqueta en `cloudflared`, etiqueta en `gateway` y `api`, y servicio `autoheal`. Se despliega con el procedimiento de `docs/despliegue.md`. Comprobación: `cloudflared`, `gateway` y `api` quedan `healthy`, `autoheal` corre, y `https://channel.gastromesa.com/omnidesk/` responde `200`. En prod no se simula ninguna caída.
7. **Documentación.** Sección "Autorreparación (SPEC 19)" y fila del error 1033 en `docs/despliegue.md`, y sección "Verificación de implementación" en este spec.

## Criterios de aceptación

- [x] `GET /api/v1/health/live` responde `200 { "status": "ok" }` sin sesión.
- [x] Con el caso de uso de salud fallando (base caída), `/api/v1/health/live` sigue respondiendo `200` y `/api/v1/health` responde `503`.
- [x] En `docker-compose.prod.yml`, el healthcheck de `api` llama a `/api/v1/health/live`.
- [x] `cloudflared` usa la imagen `cloudflare/cloudflared:2026.8.3` en los dos compose, y ninguno usa `:latest` para él.
- [x] Con el túnel conectado, `docker inspect --format '{{.State.Health.Status}}'` de `cloudflared` dice `healthy` en local y en prod.
- [x] El puerto `20241` no está publicado en el host (`docker port` de `cloudflared` y de su red compartida no lo listan).
- [ ] En la simulación local, tras cortar la red, `cloudflared` se reinicia solo en menos de 2 minutos, y el log de `omnidesk-autoheal` lo registra.
- [x] Tras reconectar la red, `dev-channel.gastromesa.com/omnidesk/api/v1/health` vuelve a responder `200` en menos de 2 minutos, sin intervención manual.
- [x] Autoheal no reinicia contenedores sin la etiqueta: durante la simulación, `omnidesk-api`, `omnidesk-postgres` y `omnidesk-minio` conservan su `StartedAt`.
- [x] En prod, `autoheal` corre, y `cloudflared`, `gateway` y `api` están `healthy` con la etiqueta `autoheal=true`.
- [x] Tras el despliegue, `https://channel.gastromesa.com/omnidesk/` responde `200`.
- [x] `docs/despliegue.md` explica qué se reinicia, en cuánto tiempo, cómo verlo, el ajuste de `pmset` y el error 1033.
- [ ] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: prod y local** (elegido por el usuario). El mismo comportamiento en los dos, y la caída se puede simular en local sin tocar prod.
- **Sí: contenedor `autoheal`** (elegido por el usuario). Viaja con el compose al VPS. Se descartó un script del host con launchd, que habría que instalar en cada máquina.
- **Sí: unos 1,5 minutos hasta el reinicio** (elegido por el usuario): 30 s × 3 fallos. Se descartaron unos 30 s, que reiniciarían el túnel por cualquier microcorte de red.
- **Sí: fijar `cloudflared` a `2026.8.3`** (elegido por el usuario), como MinIO. Un `:latest` puede traer un cambio de comportamiento en un reinicio.
- **Sí: autoheal también para `api` y `gateway` en prod** (elegido por el usuario).
- **Sí: liveness separada para el API** (elegido por el usuario). Sin ella, con Postgres caído, autoheal reiniciaría el API cada minuto sin arreglar nada. `/api/v1/health` (readiness, con la base) se queda para los monitores externos de la capa 3. Se descartaron aceptar los reinicios y dejar el API sin autoheal.
- **Sí: en local, solo `cloudflared`** (elegido por el usuario). El API en modo watch se reiniciaría mientras compila.
- **Sí: simular la caída solo en local** (elegido por el usuario). En prod solo se comprueba que todo queda `healthy`.
- **No: avisos en este spec** (elegido por el usuario). Van con la capa 3.
- **Sí: `cloudflared tunnel ready`.** El subcomando consulta `/ready` del servidor de métricas, que falla sin conexiones activas. La imagen de `cloudflared` no trae `curl` ni `wget`. Se comprobó en la versión `2026.8.3` del contenedor de dev.
- **Sí: `willfarrell/autoheal:1.2.0`**, la última etiqueta versionada (2021). `latest` se reconstruye a menudo y no es reproducible.
- **Sí: filtrar por etiqueta.** Autoheal no toca `postgres`, `minio` ni `backup`: reiniciar la base o el almacenamiento no es algo que deba decidir un vigilante automático.
- **No: un segundo conector `cloudflared`.** En la misma máquina se habría colgado por la misma causa.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| `docker.sock` da a `autoheal` control total de Docker en el host. | Imagen fija y pequeña, sin puertos y sin red publicada. Solo actúa sobre la etiqueta `autoheal`. El `:ro` no limita la API de Docker: se documenta así, sin venderlo como protección. |
| Un servicio que falla siempre (p. ej. el API con una migración rota) se reinicia sin fin, porque autoheal no tiene backoff. | `start_period: 60s` cubre las migraciones normales. Una migración rota ya deja el API caído hoy, y el bucle se ve en `docker logs <proyecto>-autoheal`. La capa 3 lo avisará. |
| Reiniciar el gateway deja a `cloudflared` sin red, porque comparte la del gateway (`network_mode: service:gateway`). | `cloudflared` pasa a `unhealthy` y autoheal también lo reinicia: unos 100 s más. Se documenta. |
| `willfarrell/autoheal:1.2.0` no funciona con la versión de Docker del host. | Se comprueba en el paso 4, en local. Si falla, se fija `latest` por digest (`@sha256:…`) y se anota en las decisiones. |
| El túnel se reinicia en bucle si Cloudflare está caído de verdad. | Reiniciar es inocuo: vuelve a conectar cuando Cloudflare responde. Cada intento es un contenedor nuevo, sin estado. |
| `cloudflared tunnel ready` cambia en una versión futura. | La imagen queda fija en `2026.8.3`. Cambiarla es un cambio explícito, que se prueba en local. |

## Qué **no** entra en este spec

- Avisos de caída o de reinicio (capa 3).
- Ajustar la energía del Mac: solo se documenta.
- Autoheal para `postgres`, `minio` o `backup`.
- Healthchecks de `api` y `caddy` en local.
- Un conector `cloudflared` de respaldo.
- Mover prod al VPS.

Cada uno de esos, si llega, va en su propio spec.

## Verificación de implementación

2026-10-15, rama `spec-19-autorreparacion-tunel`.

Automatizado, en verde:

- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en todo el monorepo: 400 unitarias del API (una nueva: `health.controller.spec.ts`), 164 de la web y 117 de contratos.
- `pnpm --filter @omnidesk/api test:e2e`: 243 pasaron, 1 se saltó (MinIO) y 1 falló. `health.e2e-spec.ts` aporta 2 pruebas nuevas (`/health/live` con la base arriba y abajo). El fallo es `assignment.e2e-spec.ts` → "Mateo nunca encuentra conversaciones asignadas a Laura", intermitente y anterior a este spec: la búsqueda extrae los dígitos de `q` para buscar por teléfono, y el token hexadecimal del test (p. ej. `5f1684e2` → `516842`) a veces coincide con un teléfono aleatorio de otra conversación.
- `docker compose config` valida los dos compose (prod con `.env.prod.example`).

Local, a mano:

- `omnidesk-cloudflared` (`2026.8.3`) queda `healthy` unos 9 s después de arrancar. `docker port` solo lista el `8088` de caddy: el `20241` no se publica.
- `omnidesk-autoheal` (`1.2.0`) llega al socket de Docker 29.7.2 (API 1.55), y el filtro `autoheal=true` devuelve solo `omnidesk-cloudflared`. La 1.2.0 no escribe nada en el log al arrancar; solo registra cada reinicio.

**Simulación** (paso 5), en UTC:

| Hora | Evento |
| --- | --- |
| 02:36:12 | `docker network disconnect omnidesk_default omnidesk-caddy` |
| 02:38:50 | `cloudflared` da por perdidas sus 4 conexiones (158 s tras el corte) y `ready` pasa a `503 readyConnections: 0` |
| 02:38:54, 02:39:24, 02:39:54 | Tres healthchecks fallidos |
| 02:39:58 | autoheal: "found to be unhealthy - Restarting container" (68 s tras perder las conexiones, 226 s tras el corte) |
| 02:40:17 | `docker network connect` |
| 02:40:30 | `dev-channel…/api/v1/health` → `200` y `cloudflared` `healthy` (13 s) |

`omnidesk-api`, `omnidesk-postgres` y `omnidesk-minio` conservaron su `StartedAt`.

**Criterio pendiente: reinicio en menos de 2 minutos desde el corte.** No se cumple medido desde el corte: fueron unos 4 minutos. Desde que el túnel se queda sin conexiones fueron 68 s, el tiempo que controla este spec. Los otros 2,6 minutos son lo que tarda `cloudflared` en darse cuenta del corte de red, y eso no lo cambian ni el healthcheck ni autoheal. En el incidente del 2026-10-16, el túnel ya estaba sin conexiones al despertar el host: con este spec se habría reiniciado en unos 70 s. Queda para que el usuario decida si se da por bueno o se reformula el criterio.

**Paso 6 (prod), desplegado** el 2026-10-16 a las 02:46 UTC desde el commit `875b078`, con `APP_VERSION=875b078 docker compose -p omnidesk-prod --env-file .env.prod -f infra/deploy/docker-compose.prod.yml up -d --build api gateway cloudflared autoheal`. Prod corre en el Mac, no en el VPS: no se usó `deploy.sh`, que exige una etiqueta `vX.Y.Z` y `/srv/omnidesk`.

- `omnidesk-prod-api`, `-gateway` y `-cloudflared` (`2026.8.3`) quedaron `healthy` con `autoheal=true`. `omnidesk-prod-autoheal` (`1.2.0`) corre. `postgres` y `minio` no llevan la etiqueta.
- `cloudflared` no publica ningún puerto. El gateway solo publica `127.0.0.1:8082`.
- `https://channel.gastromesa.com/omnidesk/`, `/api/v1/health` y `/api/v1/health/live` responden `200`. `/health` informa `"version":"875b078"` (antes `dev`).
- En prod no se simuló ninguna caída.
